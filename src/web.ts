import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MatchType, Store } from "./db.js";
import { deliver } from "./delivery.js";
import { testPattern } from "./matcher.js";
import { CALLBACK_PATH, isAllowed, OidcLogin, oidcEnabled, readOidcSettings } from "./oidc.js";
import { SECRET_KEYS, sendToTarget, TARGET_TYPES, validateTarget, type TargetConfig, type TargetSecrets, type TargetType } from "./targets.js";

const SESSION_TTL = 12 * 3600 * 1000;
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
export const VERSION: string = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")) as { version?: string }).version ?? "unknown";
  } catch { return "unknown"; }
})();

interface RouteBody {
  name?: string; matchType?: MatchType; pattern?: string; order?: number;
  gotifyUrl?: string | null; gotifyToken?: string; gotifyPriority?: number; enabled?: boolean;
  targetType?: TargetType; target?: TargetConfig; secrets?: TargetSecrets;
}
interface SettingsBody {
  gotifyUrl?: string; smtpStarttls?: boolean; smtpAuth?: boolean;
  publicUrl?: string; oidcIssuer?: string; oidcClientId?: string; oidcClientSecret?: string; oidcScopes?: string; oidcAllowed?: string;
  localLoginDisabled?: boolean;
}

export function createWeb(store: Store, opts: { onSmtpSettingsChanged?: () => Promise<void> } = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const sessions = new Map<string, number>();
  const failures = new Map<string, { n: number; until: number }>();
  const oidc = new OidcLogin(store);
  const oidcSettings = () => readOidcSettings(store);
  /** Local password login can only be switched off once an OIDC login has worked; MAILBEACON_FORCE_LOCAL_LOGIN=1 is the escape hatch. */
  const localLoginEnabled = () => process.env.MAILBEACON_FORCE_LOCAL_LOGIN === "1"
    || !(store.getSetting("local_login_disabled") === "1" && store.getSetting("oidc_last_success") && oidcEnabled(oidcSettings()));
  const redirectUri = (req: FastifyRequest) => (oidcSettings().publicUrl || `${req.protocol}://${req.headers.host}`) + CALLBACK_PATH;

  const cookie = (req: FastifyRequest) => /(?:^|;\s*)mb_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
  const authed = (req: FastifyRequest) => {
    const t = cookie(req);
    const exp = t ? sessions.get(t) : undefined;
    return !!exp && exp > Date.now();
  };
  const startSession = (reply: FastifyReply) => {
    const t = crypto.randomBytes(32).toString("hex");
    sessions.set(t, Date.now() + SESSION_TTL);
    reply.header("Set-Cookie", `mb_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`);
  };

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("X-Frame-Options", "DENY")
      .header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'");
    if (!req.url.startsWith("/api/")) return;
    // CSRF: state-changing API calls must carry a custom header (not settable cross-site without CORS)
    if (req.method !== "GET" && req.headers["x-mailbeacon"] !== "1") return reply.code(403).send({ error: "missing X-MailBeacon header" });
    const open = ["/api/status", "/api/setup", "/api/login", "/api/health", "/api/oidc/login", CALLBACK_PATH];
    if (!open.includes(req.url.split("?")[0]) && !authed(req)) return reply.code(401).send({ error: "unauthorised" });
  });

  app.get("/api/health", async () => ({ ok: true, version: VERSION }));
  app.get("/api/status", async (req) => ({
    setupDone: store.hasAdmin(), authed: authed(req), oidc: oidcEnabled(oidcSettings()), localLogin: localLoginEnabled(),
  }));

  app.get("/api/oidc/login", async (req, reply) => {
    const s = oidcSettings();
    if (!oidcEnabled(s)) return reply.code(404).send({ error: "OIDC is not configured" });
    try {
      const [id, url] = await oidc.begin(s, redirectUri(req));
      reply.header("Set-Cookie", `mb_oidc=${id}; HttpOnly; SameSite=Lax; Path=/api/oidc; Max-Age=600`);
      return reply.redirect(url);
    } catch (e) {
      store.log("error", `OIDC discovery failed: ${(e as Error).message}`);
      return reply.redirect("/?login_error=" + encodeURIComponent("Could not reach the identity provider"));
    }
  });
  app.get(CALLBACK_PATH, async (req, reply) => {
    const s = oidcSettings();
    const id = /(?:^|;\s*)mb_oidc=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1];
    reply.header("Set-Cookie", "mb_oidc=; Path=/api/oidc; Max-Age=0");
    const fail = (msg: string) => reply.redirect("/?login_error=" + encodeURIComponent(msg));
    if (!oidcEnabled(s)) return fail("OIDC is not configured");
    let claims: Record<string, unknown>;
    try {
      claims = await oidc.finish(s, id, req.url.split("?")[1] ?? "");
    } catch (e) {
      store.log("warn", `OIDC login failed: ${(e as Error).message}`);
      return fail("Single sign-on failed");
    }
    const who = String(claims.email ?? claims.preferred_username ?? claims.sub);
    if (!isAllowed(claims, s.allowed)) {
      store.log("warn", `OIDC login refused for ${who}: not in the allowed list`);
      return fail("Your account is not allowed to use MailBeacon");
    }
    store.setSetting("oidc_last_success", new Date().toISOString());
    store.log("info", `OIDC login by ${who}`);
    startSession(reply);
    return reply.redirect("/");
  });

  app.post("/api/setup", async (req, reply) => {
    if (store.hasAdmin()) return reply.code(409).send({ error: "already set up" });
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
    store.setAdminPassword(password);
    store.log("info", "admin password set");
    startSession(reply);
    return { ok: true };
  });

  app.post("/api/login", async (req, reply) => {
    if (!localLoginEnabled()) return reply.code(403).send({ error: "password login is disabled, use single sign-on" });
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return reply.code(429).send({ error: "too many attempts, wait a minute" });
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || !store.checkAdmin(password)) {
      const n = (f?.n ?? 0) + 1;
      failures.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
      store.log("warn", `failed admin login from ${ip}`);
      return reply.code(401).send({ error: "wrong password" });
    }
    failures.delete(ip);
    startSession(reply);
    return { ok: true };
  });
  app.post("/api/logout", async (req, reply) => {
    const t = cookie(req); if (t) sessions.delete(t);
    reply.header("Set-Cookie", "mb_session=; Path=/; Max-Age=0");
    return { ok: true };
  });
  app.post("/api/password", async (req, reply) => {
    const { current, password } = (req.body ?? {}) as { current?: string; password?: string };
    if (!current || !store.checkAdmin(current)) return reply.code(401).send({ error: "wrong current password" });
    if (!password || password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
    store.setAdminPassword(password);
    return { ok: true };
  });

  // settings
  app.get("/api/settings", async (req) => ({
    gotifyUrl: store.gotifyUrl,
    smtpStarttls: store.getSetting("smtp_starttls") === "1",
    smtpAuth: store.getSetting("smtp_auth") === "1",
    smtpUsers: store.listSmtpUsers(),
    ...(() => {
      const o = oidcSettings();
      return {
        publicUrl: o.publicUrl, oidcIssuer: o.issuer, oidcClientId: o.clientId, oidcClientSecretSet: !!o.clientSecret,
        oidcScopes: o.scopes, oidcAllowed: o.allowed.join(", "), oidcFromEnv: o.fromEnv,
        oidcRedirectUri: redirectUri(req), oidcLastSuccess: store.getSetting("oidc_last_success") ?? null,
        localLoginDisabled: store.getSetting("local_login_disabled") === "1", localLoginEnabled: localLoginEnabled(),
      };
    })(),
  }));
  app.put("/api/settings", async (req, reply) => {
    const b = (req.body ?? {}) as SettingsBody;
    const url = (v: string | undefined, what: string) => (v && !/^https?:\/\//.test(v) ? `${what} must start with http:// or https://` : null);
    const err = url(b.publicUrl, "Public URL") || url(b.oidcIssuer, "OIDC issuer URL");
    if (err) return reply.code(400).send({ error: err });
    const text: [keyof SettingsBody, string][] = [["publicUrl", "public_url"], ["oidcIssuer", "oidc_issuer"], ["oidcClientId", "oidc_client_id"], ["oidcScopes", "oidc_scopes"], ["oidcAllowed", "oidc_allowed"]];
    let oidcChanged = false;
    for (const [f, k] of text) {
      const v = b[f];
      if (typeof v !== "string") continue;
      if ((store.getSetting(k) ?? "") !== v.trim()) oidcChanged = true;
      if (v.trim()) store.setSetting(k, v.trim()); else store.deleteSetting(k);
    }
    if (typeof b.oidcClientSecret === "string" && b.oidcClientSecret) { store.setSecretSetting("oidc_client_secret", b.oidcClientSecret); oidcChanged = true; }
    if (oidcChanged) oidc.reset();
    if (b.localLoginDisabled !== undefined) {
      if (b.localLoginDisabled && !(oidcEnabled(oidcSettings()) && store.getSetting("oidc_last_success")))
        return reply.code(400).send({ error: "log in with single sign-on successfully at least once before disabling password login" });
      store.setSetting("local_login_disabled", b.localLoginDisabled ? "1" : "0");
    }
    if (b.gotifyUrl !== undefined) {
      if (b.gotifyUrl && !/^https?:\/\//.test(b.gotifyUrl)) return reply.code(400).send({ error: "Gotify URL must start with http:// or https://" });
      store.setSetting("gotify_url", b.gotifyUrl);
    }
    let smtpChanged = false;
    for (const [k, v] of [["smtp_starttls", b.smtpStarttls], ["smtp_auth", b.smtpAuth]] as const) {
      if (v === undefined) continue;
      const nv = v ? "1" : "0";
      if (store.getSetting(k) !== nv) { store.setSetting(k, nv); smtpChanged = true; }
    }
    if (smtpChanged && opts.onSmtpSettingsChanged) await opts.onSmtpSettingsChanged();
    return { ok: true };
  });
  app.post("/api/smtp-users", async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) return reply.code(400).send({ error: "username and password required" });
    store.setSmtpUser(username, password);
    return { ok: true };
  });
  app.delete("/api/smtp-users/:u", async (req) => {
    store.deleteSmtpUser((req.params as { u: string }).u);
    return { ok: true };
  });

  // routes (tokens never leave the server in full)
  const mask = (t: string) => (t.length > 4 ? "••••" + t.slice(-4) : "••••");
  const maskSecrets = (s: TargetSecrets) => Object.fromEntries(Object.entries(s).filter(([, v]) => v).map(([k, v]) => [k, mask(String(v))]));
  app.get("/api/routes", async () => {
    const last = store.lastDeliveries();
    return store.listRoutes().map((r) => ({ ...r, gotifyToken: r.targetType === "gotify" ? mask(r.gotifyToken) : "", secrets: maskSecrets(r.secrets), lastDelivery: last.get(r.id) ?? null }));
  });
  /** Dry-run a pattern against a sample address or subject (no route needs to exist). */
  app.post("/api/routes/match-test", async (req, reply) => {
    const b = (req.body ?? {}) as { matchType?: MatchType; pattern?: string; sample?: string };
    const types: MatchType[] = ["recipient", "sender", "subject", "catchall"];
    if (!b.matchType || !types.includes(b.matchType)) return reply.code(400).send({ error: "matchType must be recipient, sender, subject or catchall" });
    if (typeof b.sample !== "string") return reply.code(400).send({ error: "sample is required" });
    return testPattern(b.matchType, String(b.pattern ?? "").slice(0, 1000), b.sample.slice(0, 1000));
  });
  /** Set the evaluation order: body { ids: [3, 1, 2] } renumbers them 10, 20, 30. */
  app.post("/api/routes/reorder", async (req, reply) => {
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) return reply.code(400).send({ error: "ids must be an array of route ids" });
    store.reorderRoutes(ids as number[]);
    return { ok: true };
  });
  /** Quick toggle without resending the whole route. */
  app.patch("/api/routes/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!store.getRoute(id)) return reply.code(404).send({ error: "not found" });
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") return reply.code(400).send({ error: "enabled must be true or false" });
    store.setRouteEnabled(id, enabled);
    return { ok: true };
  });
  /** Keep only known secret keys; a blank value keeps the stored one. */
  const mergeSecrets = (incoming: TargetSecrets | undefined, existing: TargetSecrets = {}) => {
    const out: TargetSecrets = {};
    for (const k of SECRET_KEYS) { const v = incoming?.[k]; if (typeof v === "string" && v) out[k] = v; else if (existing[k] && v !== null) out[k] = existing[k]; }
    return out;
  };

  const validate = (b: RouteBody, existing?: { gotifyToken: string; secrets: TargetSecrets }) => {
    const tt = b.targetType ?? "gotify";
    if (!TARGET_TYPES.includes(tt)) return "targetType must be gotify, ntfy, pushover or apprise";
    const types: MatchType[] = ["recipient", "sender", "subject", "catchall"];
    if (!b.name) return "name is required";
    if (!b.matchType || !types.includes(b.matchType)) return "matchType must be recipient, sender, subject or catchall";
    if (b.matchType !== "catchall" && !b.pattern) return "pattern is required";
    if (b.matchType === "sender" || b.matchType === "subject") { try { new RegExp(b.pattern!); } catch { return "pattern is not a valid regex"; } }
    if (tt === "gotify" && !b.gotifyToken && !existing?.gotifyToken) return "gotifyToken is required";
    if (tt !== "gotify") { const e = validateTarget(tt, b.target ?? {}, mergeSecrets(b.secrets, existing?.secrets)); if (e) return e; }
    if (b.gotifyUrl && !/^https?:\/\//.test(b.gotifyUrl)) return "gotifyUrl must start with http:// or https://";
    return null;
  };
  const save = (b: RouteBody, id?: number) => store.saveRoute({
    id, name: b.name!, matchType: b.matchType!, pattern: b.matchType === "catchall" ? "" : b.pattern!,
    order: Number(b.order ?? 100), gotifyUrl: b.gotifyUrl || null, gotifyToken: b.gotifyToken!,
    gotifyPriority: Math.max(0, Math.min(10, Number(b.gotifyPriority ?? 5))), enabled: b.enabled !== false,
    targetType: b.targetType ?? "gotify", target: b.target ?? {}, secrets: b.secrets ?? {},
  });
  app.post("/api/routes", async (req, reply) => {
    const b = (req.body ?? {}) as RouteBody;
    const e = validate(b); if (e) return reply.code(400).send({ error: e });
    b.secrets = mergeSecrets(b.secrets); b.gotifyToken ??= "";
    return { id: save(b) };
  });
  app.put("/api/routes/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = store.getRoute(id); if (!existing) return reply.code(404).send({ error: "not found" });
    const b = (req.body ?? {}) as RouteBody;
    const e = validate(b, existing); if (e) return reply.code(400).send({ error: e });
    if (!b.gotifyToken) b.gotifyToken = existing.gotifyToken;
    b.secrets = mergeSecrets(b.secrets, existing.secrets);
    save(b, id);
    return { ok: true };
  });
  app.delete("/api/routes/:id", async (req) => {
    store.deleteRoute(Number((req.params as { id: string }).id));
    return { ok: true };
  });
  app.post("/api/routes/:id/test", async (req, reply) => {
    const r = store.getRoute(Number((req.params as { id: string }).id));
    if (!r) return reply.code(404).send({ error: "not found" });
    try {
      await sendToTarget(r, store.gotifyUrl, { title: "MailBeacon test", message: `Test notification for route **${r.name}**.`, contentType: "text/markdown" });
      store.log("info", `test sent for route "${r.name}"`);
      return { ok: true };
    } catch (e) {
      store.log("error", `test failed for route "${r.name}": ${(e as Error).message}`);
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // messages & logs
  app.get("/api/messages", async () => store.recentMessages(100));
  app.post("/api/messages/:id/retry", async (req) => ({ ok: await deliver(store, Number((req.params as { id: string }).id)) }));
  app.get("/api/logs", async () => store.recentLogs(200));

  // static UI
  const files: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/style.css": "style.css", "/logo.svg": "logo.svg", "/logo-header.svg": "logo-header.svg", "/favicon.svg": "favicon.svg", "/favicon.ico": "favicon.ico", "/apple-touch-icon.png": "apple-touch-icon.png", "/site.webmanifest": "site.webmanifest", "/android-chrome-192x192.png": "android-chrome-192x192.png", "/android-chrome-512x512.png": "android-chrome-512x512.png" };
  const types: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", ico: "image/x-icon", png: "image/png", webmanifest: "application/manifest+json" };
  for (const [url, file] of Object.entries(files)) {
    app.get(url, async (_req, reply) => {
      reply.type(types[file.split(".").pop()!]);
      return fs.readFileSync(path.join(publicDir, file));
    });
  }
  return app;
}
