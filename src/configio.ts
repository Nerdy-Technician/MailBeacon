import crypto from "node:crypto";
import type { Role, Route, Store } from "./db.js";
import { ROLES } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";
import type { TargetSecrets } from "./targets.js";
import { TARGET_TYPES } from "./targets.js";
import { validateOptions, type RouteOptions } from "./format.js";

/** Non-secret settings that travel with an export. Per-instance state (last SSO login, alert state, digests) stays behind. */
const SETTINGS = ["gotify_url", "smtp_starttls", "smtp_auth", "public_url", "oidc_issuer", "oidc_client_id", "oidc_scopes", "oidc_allowed",
  "oidc_groups_claim", "oidc_admin_groups", "oidc_editor_groups", "oidc_viewer_groups", "oidc_default_role", "local_login_disabled", "timezone",
  "attachment_limits", "alerts", "gravatar", "limit_max_connections", "limit_max_connections_per_ip", "limit_messages_per_minute_per_ip", "limit_max_recipients"];

export interface ExportedRoute {
  ref: number; name: string; owner: string | null; matchType: Route["matchType"]; pattern: string; order: number; enabled: boolean;
  targetType: Route["targetType"]; gotifyUrl: string | null; gotifyPriority: number; target: Route["target"]; options: RouteOptions;
}
export interface ExportedDestination { ref: number; name: string; owner: string | null; type: string; config: Record<string, unknown>; enabled: boolean }
export interface ConfigExport {
  format: "mailbeacon-config"; version: 1; appVersion: string; exportedAt: string; secrets: "excluded" | "encrypted";
  settings: Record<string, string>;
  users: { username: string; displayName: string; email: string | null; role: Role; sso: boolean }[];
  smtpUsers: string[];
  destinations: ExportedDestination[];
  routes: ExportedRoute[];
  encrypted?: { kdf: "scrypt"; n: number; salt: string; data: string };
}
interface SecretBundle { routes: Record<number, { gotifyToken: string; secrets: TargetSecrets }>; destinations: Record<number, TargetSecrets>; settings: Record<string, string> }

const N = 1 << 15;
const kdf = (pass: string, salt: Buffer, n = N) => crypto.scryptSync(pass, salt, 32, { N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 });

export function exportConfig(store: Store, appVersion: string, opts: { passphrase?: string } = {}): ConfigExport {
  const users = store.listUsers();
  const uname = (id: number | null | undefined) => (id ? users.find((u) => u.id === id)?.username ?? null : null);
  const settings: Record<string, string> = {};
  for (const k of SETTINGS) { const v = store.getSetting(k); if (v !== undefined) settings[k] = v; }
  const routes = store.listRoutes(), dests = store.listDestinations();
  const out: ConfigExport = {
    format: "mailbeacon-config", version: 1, appVersion, exportedAt: new Date().toISOString(), secrets: opts.passphrase ? "encrypted" : "excluded",
    settings,
    users: users.map((u) => ({ username: u.username, displayName: u.displayName, email: u.email, role: u.role, sso: !!u.oidcSub })),
    smtpUsers: store.listSmtpUsers(),
    destinations: dests.map((d) => ({ ref: d.id, name: d.name, owner: uname(d.ownerId), type: d.type, config: { ...d.config }, enabled: d.enabled })),
    routes: routes.map((r) => ({ ref: r.id, name: r.name, owner: uname(r.ownerId), matchType: r.matchType, pattern: r.pattern, order: r.order, enabled: r.enabled,
      targetType: r.targetType, gotifyUrl: r.gotifyUrl, gotifyPriority: r.gotifyPriority, target: r.target, options: r.options ?? {} })),
  };
  if (opts.passphrase) {
    const bundle: SecretBundle = { routes: {}, destinations: {}, settings: {} };
    for (const r of routes) bundle.routes[r.id] = { gotifyToken: r.gotifyToken, secrets: r.secrets };
    for (const d of dests) bundle.destinations[d.id] = d.secrets;
    const cs = store.getSecretSetting("oidc_client_secret"); if (cs) bundle.settings.oidc_client_secret = cs;
    const salt = crypto.randomBytes(16);
    out.encrypted = { kdf: "scrypt", n: N, salt: salt.toString("base64"), data: encrypt(JSON.stringify(bundle), kdf(opts.passphrase, salt)) };
  }
  return out;
}

export interface ImportSummary {
  dryRun: boolean; mode: "merge" | "replace"; secretsRestored: boolean;
  created: { users: number; destinations: number; routes: number }; removed: { destinations: number; routes: number };
  settings: number; warnings: string[];
}

/** Validates everything before writing anything; the write runs in one transaction. */
export function importConfig(store: Store, raw: unknown, opts: { passphrase?: string; mode?: "merge" | "replace"; dryRun?: boolean; importerId: number }): ImportSummary {
  const c = raw as ConfigExport;
  if (!c || c.format !== "mailbeacon-config" || c.version !== 1) throw new Error("not a MailBeacon config export (format/version)");
  if (!Array.isArray(c.routes) || !Array.isArray(c.destinations) || !Array.isArray(c.users)) throw new Error("export is missing routes, destinations or users");
  const mode = opts.mode ?? "merge";
  const warnings: string[] = [];
  let bundle: SecretBundle | null = null;
  if (c.encrypted) {
    if (!opts.passphrase) warnings.push("export has encrypted secrets but no passphrase was given: secrets are not restored");
    else {
      try { bundle = JSON.parse(decrypt(c.encrypted.data, kdf(opts.passphrase, Buffer.from(c.encrypted.salt, "base64"), c.encrypted.n))) as SecretBundle; }
      catch { throw new Error("wrong passphrase (or the export was modified)"); }
    }
  }
  for (const d of c.destinations) if (!TARGET_TYPES.includes(d.type as never) || !d.name) throw new Error(`destination "${d.name}" has an unknown type`);
  for (const r of c.routes) {
    if (!r.name || !["recipient", "sender", "subject", "catchall"].includes(r.matchType)) throw new Error(`route "${r.name}" is invalid`);
    const e = validateOptions(r.options); if (e) throw new Error(`route "${r.name}": ${e}`);
  }
  for (const u of c.users) if (!ROLES.includes(u.role) || !/^[\w.@-]{1,64}$/.test(u.username)) throw new Error(`user "${u.username}" is invalid`);
  const sum: ImportSummary = { dryRun: !!opts.dryRun, mode, secretsRestored: !!bundle, created: { users: 0, destinations: 0, routes: 0 }, removed: { destinations: 0, routes: 0 }, settings: 0, warnings };

  const run = () => {
    if (mode === "replace") {
      sum.removed.routes = store.listRoutes().length; sum.removed.destinations = store.listDestinations().length;
      if (!opts.dryRun) { for (const r of store.listRoutes()) store.deleteRoute(r.id); for (const d of store.listDestinations()) store.deleteDestination(d.id); }
    }
    const seen = new Set<string>();
    const userId = (name: string | null): number => {
      if (!name) return opts.importerId;
      const u = store.getUserByName(name);
      if (u) return u.id;
      const src = c.users.find((x) => x.username === name);
      if (opts.dryRun) { if (!seen.has(name)) { seen.add(name); sum.created.users++; } return opts.importerId; }
      sum.created.users++;
      warnings.push(`user "${name}" created without a password: they can log in with SSO, or an admin sets a password`);
      return store.createUser({ username: name, displayName: src?.displayName, email: src?.email, role: src?.role ?? "viewer" });
    };
    for (const u of c.users) if (!store.getUserByName(u.username)) userId(u.username);
    const destMap = new Map<number, number>();
    for (const d of c.destinations) {
      const secrets = bundle?.destinations[d.ref] ?? {};
      const missing = !bundle && d.type !== "webhook";
      if (missing) warnings.push(`destination "${d.name}" imported disabled: its secrets were not in the export`);
      sum.created.destinations++;
      if (!opts.dryRun) destMap.set(d.ref, store.saveDestination({ ownerId: userId(d.owner), name: d.name, type: d.type as never, config: d.config as never, secrets, enabled: d.enabled && !missing }));
    }
    for (const r of c.routes) {
      const sec = bundle?.routes[r.ref];
      const needsSecret = r.targetType !== "none" && !sec;
      if (needsSecret) warnings.push(`route "${r.name}" imported disabled: its target secrets were not in the export`);
      const options = { ...r.options, destinationIds: (r.options.destinationIds ?? []).map((x) => destMap.get(x) ?? -1).filter((x) => x > 0) };
      if (opts.dryRun) options.destinationIds = r.options.destinationIds ?? [];
      sum.created.routes++;
      if (!opts.dryRun) store.saveRoute({ name: r.name, matchType: r.matchType, pattern: r.pattern, order: r.order, gotifyUrl: r.gotifyUrl, gotifyToken: sec?.gotifyToken ?? "",
        gotifyPriority: r.gotifyPriority, enabled: r.enabled && !needsSecret, targetType: r.targetType, target: r.target, secrets: sec?.secrets ?? {}, ownerId: userId(r.owner), options });
    }
    for (const [k, v] of Object.entries(c.settings ?? {})) {
      if (!SETTINGS.includes(k) || typeof v !== "string") continue;
      sum.settings++;
      if (opts.dryRun) continue;
      if (k === "alerts") {
        try { const a = JSON.parse(v) as { destinationId?: number | null }; if (a.destinationId) a.destinationId = destMap.get(a.destinationId) ?? null; store.setSetting(k, JSON.stringify(a)); } catch { /* skip */ }
      } else if (k === "local_login_disabled") continue; // never lock yourself out by importing
      else store.setSetting(k, v);
    }
    if (bundle?.settings.oidc_client_secret && !opts.dryRun) store.setSecretSetting("oidc_client_secret", bundle.settings.oidc_client_secret);
    if (c.smtpUsers?.length) warnings.push(`${c.smtpUsers.length} SMTP user(s) not imported (passwords are never exported): ${c.smtpUsers.join(", ")}`);
  };
  if (opts.dryRun) run(); else store.db.transaction(run)();
  return sum;
}
