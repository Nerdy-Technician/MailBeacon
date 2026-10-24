import net from "node:net";
import sharp from "sharp";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { ROLES, type AvatarSource, type UserPrefs, type MatchType, type MessageQuery, type MessageStatus, type Role, type Route, type Store, type User } from "./db.js";
import { deliver, destToTarget, flushHeld, health, isDryRun, timezone } from "./delivery.js";
import { actor, can, isAdmin, ownerScope, owns, PERMS, readRoleMapping, roleFromClaims, SCOPES, type Perm, type Principal } from "./auth.js";
import { alertHistory, readAlertSettings, sendAlert, writeAlertSettings, type AlertSettings } from "./alerts.js";
import { exportConfig, importConfig } from "./configio.js";
import { extractValues, pickPriority, renderTemplate, TEMPLATE_VARS, validateOptions, VAR_NAME, type RouteOptions } from "./format.js";
import { simpleParser } from "mailparser";
import { ROUTE_TEMPLATES } from "./routeTemplates.js";
import { RateLimiter } from "./limits.js";
import { readAttachmentLimits, writeAttachmentLimits, type AttachmentLimits } from "./limits.js";
import { TARGET_FIELDS } from "./targets.js";
import { matchRoute, previewRoute, testPattern } from "./matcher.js";
import { readLimits, writeLimits, type Limits } from "./limits.js";
import { renderMetrics } from "./metrics.js";
import { countPurge, CSV_MAX_ROWS, cutoff, getRetention, messagesCsv, MAX_RETENTION_DAYS, setRetention, statsReport, STATS_RANGES, validateRetention } from "./insights.js";
import { createHealthz, type HealthzOpts } from "./healthz.js";
import { openApiSpec } from "./openapi.js";
import { lastSelfTest, runSelfTest } from "./selftest.js";
import { ingest, ingestParsed } from "./smtp.js";
import { CALLBACK_PATH, isAllowed, OidcLogin, oidcEnabled, readOidcSettings } from "./oidc.js";
import { SECRET_KEYS, sendToTarget, TARGET_TYPES, validateTarget, type TargetConfig, type TargetSecrets, type TargetType, type TargetRoute } from "./targets.js";

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
  targetType?: TargetType | "none"; target?: TargetConfig; secrets?: TargetSecrets;
  options?: RouteOptions; ownerId?: number | null;
}
declare module "fastify" { interface FastifyRequest { principal?: Principal } }
interface SettingsBody {
  gotifyUrl?: string; smtpStarttls?: boolean; smtpAuth?: boolean;
  publicUrl?: string; oidcIssuer?: string; oidcClientId?: string; oidcClientSecret?: string; oidcScopes?: string; oidcAllowed?: string;
  localLoginDisabled?: boolean; limits?: Partial<Limits>;
  oidcGroupsClaim?: string; oidcAdminGroups?: string; oidcEditorGroups?: string; oidcViewerGroups?: string; oidcDefaultRole?: string;
  timezone?: string; attachments?: Partial<AttachmentLimits>; gravatar?: boolean;
  appName?: string; defaultTheme?: string;
}
export const LOGO_MAX_BYTES = 1024 * 1024;
const THEMES = ["dark", "light", "system"];
const DEFAULT_APP_NAME = "MailBeacon";
const ADDR = /^[^\s@<>,]+@[^\s@<>,]+$/;
const STATUSES: MessageStatus[] = ["pending", "delivered", "failed", "dead", "held", "suppressed"];
const USERNAME = /^[\w.@-]{1,64}$/;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** Stored avatars are re-encoded to a square WebP of this size. */
export const AVATAR_SIZE = 256;
const AVATAR_MAX_PIXELS = 40_000_000; // refuses decompression bombs (e.g. 1x1 MB PNG that expands to gigabytes)
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const AVATAR_SOURCES: AvatarSource[] = ["oidc", "gravatar", "upload", "initials"];
/** Identify an image by its magic bytes; SVG and anything else is refused (SVG can carry script). */
export function sniffImage(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6))) return "image/gif";
  return null;
}
/**
 * Decode, auto-rotate, crop to a centred square and re-encode as WebP. Metadata (EXIF, GPS) is dropped.
 * Animated images keep only their first frame. Throws on anything libvips can't decode.
 */
export async function processAvatar(data: Buffer): Promise<Buffer> {
  return sharp(data, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "error", animated: false })
    .rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer();
}
/** Connects to an SMTP listener, reads the banner and EHLO reply, then QUITs. Never sends mail. */
export function probeSmtp(host: string, port: number): Promise<{ ok: boolean; ms: number; banner?: string; starttls?: boolean; auth?: boolean; size?: number | null; error?: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now(); let buf = ""; let stage = 0; let banner = "";
    const sock = net.connect({ host, port });
    const done = (r: Omit<Awaited<ReturnType<typeof probeSmtp>>, "ms">) => { sock.destroy(); resolve({ ...r, ms: Date.now() - t0 }); };
    sock.setTimeout(5000, () => done({ ok: false, error: "no answer within 5 seconds" }));
    sock.on("error", (e) => done({ ok: false, error: e.message }));
    sock.on("data", (c) => {
      buf += c.toString("utf8");
      if (!/(^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buf)) return; // wait for the last line of a reply
      const reply = buf; buf = "";
      if (stage === 0) {
        if (!reply.startsWith("220")) return done({ ok: false, error: `unexpected greeting: ${reply.slice(0, 80)}` });
        banner = reply.trim().slice(4, 120); stage = 1; sock.write("EHLO mailbeacon-selftest\r\n");
      } else if (stage === 1) {
        const ext = reply.toUpperCase();
        const size = /250[- ]SIZE (\d+)/.exec(ext);
        sock.write("QUIT\r\n");
        done({ ok: reply.startsWith("250"), banner, starttls: ext.includes("STARTTLS"), auth: /250[- ]AUTH/.test(ext), size: size ? Number(size[1]) : null });
      }
    });
  });
}
const validTz = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
const pictureClaim = (c: Record<string, unknown>) => (typeof c.picture === "string" && /^https?:\/\/[^\s"'<>]{1,2000}$/.test(c.picture) ? c.picture : null);
export const gravatarUrl = (email: string) => `https://gravatar.com/avatar/${crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}?s=96&d=404`;
const gravatarOn = (store: Store) => process.env.MAILBEACON_GRAVATAR !== "0" && store.getSetting("gravatar") !== "0";

export function createWeb(store: Store, opts: { onSmtpSettingsChanged?: () => Promise<void>; smtpPort?: number; smtpListening?: () => boolean; healthz?: HealthzOpts } = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  app.addContentTypeParser(AVATAR_TYPES, { parseAs: "buffer", bodyLimit: AVATAR_MAX_BYTES + 1024 }, (_req, body, done) => done(null, body));
  const sessions = new Map<string, { userId: number; exp: number }>();
  const failures = new Map<string, { n: number; until: number }>();
  const oidc = new OidcLogin(store);
  const oidcSettings = () => readOidcSettings(store);
  /** Local password login can only be switched off once an OIDC login has worked; MAILBEACON_FORCE_LOCAL_LOGIN=1 is the escape hatch. */
  const localLoginEnabled = () => process.env.MAILBEACON_FORCE_LOCAL_LOGIN === "1"
    || !(store.getSetting("local_login_disabled") === "1" && store.getSetting("oidc_last_success") && oidcEnabled(oidcSettings()));
  const redirectUri = (req: FastifyRequest) => (oidcSettings().publicUrl || `${req.protocol}://${req.headers.host}`) + CALLBACK_PATH;

  const cookie = (req: FastifyRequest) => /(?:^|;\s*)mb_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
  const headerKey = (req: FastifyRequest) => /^Bearer (mbk_\S+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
  /** ?key= is only accepted on the webhook URL (for apps that can't set headers), and only for send-only keys (checked in resolve). */
  const queryKey = (req: FastifyRequest) => (req.method === "POST" && /^\/api\/webhook\/\d+\?/.test(req.url) ? /[?&]key=(mbk_[\w-]+)/.exec(req.url)?.[1] : undefined);
  const bearer = (req: FastifyRequest) => headerKey(req) ?? queryKey(req);
  /** Session cookie or API key → principal. Disabled or deleted users get nothing. */
  const resolve = (req: FastifyRequest): Principal | undefined => {
    // An explicit API key wins over a session cookie, so the key's (narrower) scopes apply and it's the one audited.
    const k = bearer(req);
    if (k) {
      const key = store.verifyApiKey(k);
      const user = key ? store.getUser(key.userId) : undefined;
      const viaQuery = !headerKey(req);
      if (viaQuery && key && !(key.scopes.length === 1 && key.scopes[0] === "messages:send")) return undefined;
      if (key && user && !user.disabled) return { user, via: "key", scopes: key.scopes, keyId: key.id, keyName: key.name };
      return undefined;
    }
    const t = cookie(req);
    const s = t ? sessions.get(t) : undefined;
    if (s && s.exp > Date.now()) {
      const user = store.getUser(s.userId);
      if (user && !user.disabled) return { user, via: "session" };
    }
    return undefined;
  };
  const authed = (req: FastifyRequest) => !!resolve(req);
  /** Effective avatar: the chosen source, else OIDC picture if the IdP sent one, else Gravatar; null = show initials. */
  const avatarInfo = (u: User) => {
    const available: AvatarSource[] = [...(u.pictureUrl ? ["oidc" as const] : []), ...(gravatarOn(store) && u.email ? ["gravatar" as const] : []), ...(u.hasAvatar ? ["upload" as const] : []), "initials"];
    const chosen = u.avatarSource ?? (u.pictureUrl ? "oidc" : "gravatar");
    const source = available.includes(chosen) ? chosen : "initials";
    const url = source === "upload" ? `/api/users/${u.id}/avatar` : source === "oidc" ? u.pictureUrl : source === "gravatar" ? gravatarUrl(u.email!) : null;
    const words = (u.displayName || u.username).split(/[\s._@-]+/).filter(Boolean);
    const initials = (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)).toUpperCase();
    return { source, chosen: u.avatarSource, url, initials, available };
  };
  const audit = (req: FastifyRequest, action: string, target: string | null = null, detail: string | null = null) => store.audit(actor(req.principal), action, target, detail, req.ip);
  const startSession = (reply: FastifyReply, user: User) => {
    const t = crypto.randomBytes(32).toString("hex");
    sessions.set(t, { userId: user.id, exp: Date.now() + SESSION_TTL });
    store.touchLogin(user.id);
    reply.header("Set-Cookie", `mb_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`);
  };

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("X-Frame-Options", "DENY")
      .header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:");
    if (!req.url.startsWith("/api/")) return;
    // CSRF: state-changing calls made with the session cookie must carry a custom header (not settable cross-site without CORS).
    // API-key calls without a cookie can't be forged by a browser, so they don't need it.
    const keyOnly = !!bearer(req) && !cookie(req);
    if (req.method !== "GET" && !keyOnly && req.headers["x-mailbeacon"] !== "1") return reply.code(403).send({ error: "missing X-MailBeacon header" });
    req.principal = resolve(req);
    if (bearer(req) && !req.principal) return reply.code(401).send({ error: "invalid or expired API key" });
  });
  /** Permission check per route, from the PERMS table (unlisted /api routes need admin). */
  app.addHook("preHandler", async (req, reply) => {
    const url = req.routeOptions.url ?? "";
    if (!url.startsWith("/api/")) return;
    const need = PERMS[`${req.method} ${url}`] ?? "admin";
    if (need === "public") return;
    if (!req.principal) return reply.code(401).send({ error: "unauthorised" });
    if (need === "authed") return;
    if (!can(req.principal, need as Perm)) return reply.code(403).send({ error: req.principal.via === "key" ? `this API key lacks the "${need}" scope (or your role doesn't allow it)` : `your role (${req.principal.user.role}) can't do this` });
  });

  app.get("/api/health", async () => ({ ok: true, version: VERSION }));
  // /healthz: no auth. Anonymous callers get statuses and counts only; admins (session or key) also get per-destination results.
  const healthz = createHealthz(store, opts.smtpListening ?? (() => true), opts.healthz);
  app.get("/healthz", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const p = resolve(req);
    const r = await healthz.check({ core: q.core === "1" || q.core === "true", detailed: isAdmin(p) });
    reply.header("Cache-Control", "no-store");
    return reply.code(r.ok ? 200 : 503).send({ ...r.body, version: VERSION });
  });

  // Swagger UI at /docs (spec at /docs/json). The spec holds no secrets; calls still need a session.
  app.register(swagger, { mode: "static", specification: { document: openApiSpec(VERSION) as never } });
  app.register(swaggerUi, { routePrefix: "/docs", uiConfig: { docExpansion: "list", deepLinking: false, persistAuthorization: false }, staticCSP: false });

  /** Prometheus metrics: open unless MAILBEACON_METRICS_TOKEN is set, then a Bearer token or a UI session is required. */
  app.get("/metrics", async (req, reply) => {
    const tok = process.env.MAILBEACON_METRICS_TOKEN;
    if (tok) {
      const given = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1] ?? "";
      const a = crypto.createHash("sha256").update(given).digest(), b = crypto.createHash("sha256").update(tok).digest();
      if (!crypto.timingSafeEqual(a, b) && !authed(req)) return reply.code(401).header("WWW-Authenticate", "Bearer").send("unauthorised\n");
    }
    const st = lastSelfTest();
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return renderMetrics({ queue: store.statusCounts(), routes: store.listRoutes().length, selfTestOk: st ? st.ok : null, dryRun: isDryRun(), version: VERSION,
      destinations: store.listDestinations().length, users: store.listUsers().length, targetFailures: [...health.entries()].map(([k, h]) => [k, h.failures] as [string, number]) });
  });
  const me = (p: Principal) => ({ id: p.user.id, username: p.user.username, displayName: p.user.displayName, email: p.user.email, role: p.user.role,
    hasPassword: p.user.hasPassword, sso: !!p.user.oidcSub, via: p.via, avatar: avatarInfo(p.user), prefs: p.user.prefs, perms: (["routes:read", "routes:write", "destinations:read", "destinations:write", "messages:read", "messages:write", "test:send", "messages:send", "account", "admin"] as Perm[]).filter((x) => can(p, x)) });
  app.get("/api/status", async (req) => ({
    setupDone: store.hasAdmin(), needsSetup: store.listUsers().length === 0, wizardDone: store.getSetting("setup_wizard_done") === "1", authed: !!req.principal, oidc: oidcEnabled(oidcSettings()), localLogin: localLoginEnabled(),
    user: req.principal ? me(req.principal) : null, ...branding(),
  }));
  app.get("/api/me", async (req) => me(req.principal!));

  // ---------- white-label ----------
  const logoTag = () => { const l = store.getSetting("brand_logo"); return l ? crypto.createHash("sha256").update(l).digest("base64url").slice(0, 16) : null; };
  const branding = () => { const t = logoTag(); return { appName: store.getSetting("app_name") || DEFAULT_APP_NAME, logoUrl: t ? `/api/branding/logo?v=${t}` : null, defaultTheme: store.getSetting("default_theme") || "dark" }; };
  app.get("/api/branding/logo", async (req, reply) => {
    const l = store.getSetting("brand_logo"); if (!l) return reply.code(404).send({ error: "no custom logo" });
    const etag = `"${logoTag()}"`;
    reply.header("Cache-Control", "public, no-cache").header("ETag", etag).header("Content-Security-Policy", "sandbox");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type("image/png").send(Buffer.from(l, "base64"));
  });
  app.post("/api/branding/logo", { bodyLimit: LOGO_MAX_BYTES + 1024 }, async (req, reply) => {
    const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const data = req.body as Buffer;
    if (!AVATAR_TYPES.includes(type)) return reply.code(415).send({ error: "logo must be PNG, JPEG, WebP or GIF (SVG is not accepted)" });
    if (!Buffer.isBuffer(data) || !data.length) return reply.code(400).send({ error: "empty upload" });
    if (data.length > LOGO_MAX_BYTES) return reply.code(413).send({ error: "logo must be at most 1 MB" });
    if (sniffImage(data) !== type) return reply.code(415).send({ error: "file content does not match its type (only real PNG, JPEG, WebP or GIF images)" });
    let out: Buffer;
    try { out = await sharp(data, { limitInputPixels: AVATAR_MAX_PIXELS, animated: false }).rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).png().toBuffer(); }
    catch { return reply.code(422).send({ error: "the image could not be read (damaged, or larger than 40 megapixels)" }); }
    store.setSetting("brand_logo", out.toString("base64"));
    audit(req, "branding.logo.uploaded", "settings", `${type} ${Math.ceil(data.length / 1024)} KB -> png ${Math.ceil(out.length / 1024)} KB`);
    return { ok: true, ...branding() };
  });
  app.delete("/api/branding/logo", async (req) => { store.deleteSetting("brand_logo"); audit(req, "branding.logo.removed", "settings"); return { ok: true, ...branding() }; });

  // ---------- profile: avatar and preferences ----------
  app.put("/api/me", async (req, reply) => {
    const u = req.principal!.user;
    const b = (req.body ?? {}) as { displayName?: string; email?: string | null; avatarSource?: AvatarSource | null; prefs?: UserPrefs };
    if (typeof b.email === "string") b.email = b.email.trim();
    if (b.displayName !== undefined && (typeof b.displayName !== "string" || !b.displayName.trim() || b.displayName.length > 100)) return reply.code(400).send({ error: "display name must be 1-100 characters" });
    if (b.email && (typeof b.email !== "string" || !ADDR.test(b.email))) return reply.code(400).send({ error: "email is not valid" });
    if (b.avatarSource !== undefined && b.avatarSource !== null && !AVATAR_SOURCES.includes(b.avatarSource)) return reply.code(400).send({ error: `avatarSource must be one of ${AVATAR_SOURCES.join(", ")}` });
    if (b.avatarSource === "upload" && !u.hasAvatar) return reply.code(400).send({ error: "upload a picture first" });
    if (b.avatarSource === "oidc" && !u.pictureUrl) return reply.code(400).send({ error: "your identity provider has not sent a picture" });
    if (b.prefs !== undefined) {
      const pr = b.prefs ?? {};
      if (pr.theme !== undefined && !["dark", "light", "system"].includes(pr.theme)) return reply.code(400).send({ error: "theme must be dark, light or system" });
      if (pr.timezone !== undefined && pr.timezone !== "" && !validTz(pr.timezone)) return reply.code(400).send({ error: "unknown time zone" });
      store.setPrefs(u.id, { ...u.prefs, ...(pr.theme !== undefined ? { theme: pr.theme } : {}), ...(pr.timezone !== undefined ? { timezone: pr.timezone || undefined } : {}) });
    }
    store.updateUser(u.id, { displayName: b.displayName?.trim(), email: b.email === undefined ? undefined : b.email || null });
    if (b.avatarSource !== undefined) store.setAvatarSource(u.id, b.avatarSource);
    const what = [b.displayName !== undefined ? "display name" : "", b.email !== undefined ? "email" : "", b.avatarSource !== undefined ? `avatar ${b.avatarSource ?? "auto"}` : "", b.prefs !== undefined ? "preferences" : ""].filter(Boolean).join(", ");
    if (what) audit(req, "profile.updated", `user:${u.username}`, what);
    return me({ ...req.principal!, user: store.getUser(u.id)! });
  });
  app.post("/api/me/avatar", { bodyLimit: AVATAR_MAX_BYTES + 1024 }, async (req, reply) => {
    const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const data = req.body as Buffer;
    if (!AVATAR_TYPES.includes(type)) return reply.code(415).send({ error: "picture must be PNG, JPEG, WebP or GIF" });
    if (!Buffer.isBuffer(data) || !data.length) return reply.code(400).send({ error: "empty upload" });
    if (data.length > AVATAR_MAX_BYTES) return reply.code(413).send({ error: `picture must be at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB` });
    if (sniffImage(data) !== type) return reply.code(415).send({ error: "file content does not match its type (only real PNG, JPEG, WebP or GIF images)" });
    let out: Buffer;
    try { out = await processAvatar(data); } catch { return reply.code(422).send({ error: "the picture could not be read (damaged, or larger than 40 megapixels)" }); }
    const u = req.principal!.user;
    store.setAvatar(u.id, { type: "image/webp", data: out });
    store.setAvatarSource(u.id, "upload");
    audit(req, "profile.avatar.uploaded", `user:${u.username}`, `${type} ${Math.ceil(data.length / 1024)} KB -> webp ${AVATAR_SIZE}px ${Math.ceil(out.length / 1024)} KB`);
    return me({ ...req.principal!, user: store.getUser(u.id)! });
  });
  app.delete("/api/me/avatar", async (req) => {
    const u = req.principal!.user;
    store.setAvatar(u.id, null);
    if (u.avatarSource === "upload") store.setAvatarSource(u.id, null);
    audit(req, "profile.avatar.removed", `user:${u.username}`);
    return me({ ...req.principal!, user: store.getUser(u.id)! });
  });
  app.get("/api/users/:id/avatar", async (req, reply) => {
    const a = store.getAvatar(Number((req.params as { id: string }).id));
    if (!a) return reply.code(404).send({ error: "no picture" });
    // no-cache + ETag: a new upload shows straight away, unchanged pictures cost a 304
    const etag = `"${crypto.createHash("sha256").update(a.data).digest("base64url").slice(0, 22)}"`;
    reply.header("Cache-Control", "private, no-cache").header("ETag", etag).header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "sandbox");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type(a.type).send(a.data);
  });

  // ---------- dashboard ----------
  app.get("/api/stats", async (req, reply) => {
    const range = (req.query as { range?: string }).range ?? "24h";
    if (!["24h", "7d"].includes(range)) return reply.code(400).send({ error: "range must be 24h or 7d" });
    const scope = ownerScope(req.principal);
    const step = range === "24h" ? 3600000 : 86400000, n = range === "24h" ? 24 : 7;
    const now = Date.now();
    const end = range === "24h" ? Math.ceil(now / step) * step : (() => { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d.getTime(); })();
    const start = end - n * step;
    const where = scope === undefined ? "" : " AND owner_id=" + Number(scope);
    const rows = store.db.prepare(`SELECT received_at AS at, status FROM messages WHERE received_at >= ?${where}`).all(new Date(start).toISOString()) as { at: string; status: string }[];
    const buckets = Array.from({ length: n }, (_, i) => ({ start: new Date(start + i * step).toISOString(), delivered: 0, failed: 0 }));
    for (const r of rows) {
      const i = Math.floor((Date.parse(r.at) - start) / step);
      if (i < 0 || i >= n) continue;
      if (r.status === "delivered") buckets[i].delivered++; else if (r.status === "failed" || r.status === "dead") buckets[i].failed++;
    }
    const recent = store.queryMessages({ ownerId: scope, limit: 8, offset: 0 }).items.map((m) => ({ id: m.id, receivedAt: m.receivedAt, subject: m.subject, sender: m.sender, status: m.status, route: m.routeId ? store.getRoute(m.routeId)?.name ?? null : null }));
    const dead = store.queryMessages({ ownerId: scope, status: "dead", limit: 5, offset: 0 });
    const dests = store.listDestinations(scope).map((d) => ({ id: d.id, name: d.name, type: d.type, enabled: d.enabled, health: health.get(`dest:${d.id}`) ?? null }));
    const routes = visibleRoutes(req.principal).map((r) => ({ id: r.id, name: r.name, type: r.targetType, enabled: r.enabled, health: health.get(`route:${r.id}`) ?? null })).filter((r) => r.type !== "none");
    const st = isAdmin(req.principal) ? lastSelfTest() : null;
    return { range, counts: store.statusCounts(scope), buckets, recent, deadLetters: { total: dead.total, items: dead.items.map((m) => ({ id: m.id, receivedAt: m.receivedAt, subject: m.subject, lastError: m.lastError })) },
      destinations: dests, routes, routeCount: visibleRoutes(req.principal).length, selfTest: st ? { ok: st.ok, at: st.at, failed: st.checks.filter((c) => !c.ok).length } : null, dryRun: isDryRun() };
  });

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
      store.audit(who, "login.sso.refused", null, "not in the allowed list", req.ip);
      return fail("Your account is not allowed to use MailBeacon");
    }
    const mapping = readRoleMapping(store);
    const role = roleFromClaims(claims, mapping);
    if (!role) {
      store.log("warn", `OIDC login refused for ${who}: no group maps to a MailBeacon role`);
      store.audit(who, "login.sso.refused", null, `no mapped group in claim "${mapping.claim}"`, req.ip);
      return fail("Your account is not in a MailBeacon group");
    }
    const user = provisionSsoUser(claims, role);
    if (!user || user.disabled) {
      store.audit(who, "login.sso.refused", user ? `user:${user.username}` : null, "account disabled", req.ip);
      return fail("Your MailBeacon account is disabled");
    }
    store.setSetting("oidc_last_success", new Date().toISOString());
    store.log("info", `OIDC login by ${who} as ${user.role}`);
    store.audit(user.username, "login.sso", `user:${user.username}`, `role ${user.role}`, req.ip);
    startSession(reply, user);
    return reply.redirect("/");
  });

  /** SSO users are keyed by the IdP subject; the role follows the groups claim on every login (never demoting the last admin). */
  const provisionSsoUser = (claims: Record<string, unknown>, role: Role): User | undefined => {
    const sub = String(claims.sub ?? "");
    if (!sub) return undefined;
    const email = typeof claims.email === "string" ? claims.email : null;
    const display = String(claims.name ?? claims.preferred_username ?? email ?? sub).slice(0, 100);
    const existing = store.getUserBySub(sub);
    if (existing) {
      let newRole = role;
      if (existing.role === "admin" && role !== "admin" && !existing.disabled && store.countAdmins() <= 1) {
        newRole = "admin";
        store.log("warn", `SSO groups would demote ${existing.username}, the last admin: kept as admin`);
      }
      if (newRole !== existing.role) store.audit("system", "user.role.sso", `user:${existing.username}`, `${existing.role} -> ${newRole} from groups claim`);
      store.updateUser(existing.id, { role: newRole, email: existing.email ?? email });
      store.setPictureUrl(existing.id, pictureClaim(claims));
      return store.getUser(existing.id);
    }
    let base = String(claims.preferred_username ?? (email ? email.split("@")[0] : "") ?? "").replace(/[^\w.@-]/g, "").slice(0, 48) || "sso-user";
    if (store.getUserByName(base)) { let i = 2; while (store.getUserByName(`${base}-${i}`)) i++; base = `${base}-${i}`; }
    const id = store.createUser({ username: base, displayName: display, email, role, oidcSub: sub });
    store.setPictureUrl(id, pictureClaim(claims));
    store.audit("system", "user.created.sso", `user:${base}`, `role ${role}`);
    return store.getUser(id);
  };

  app.post("/api/setup", async (req, reply) => {
    // Locked for good once any user exists: the wizard's later steps use the normal, authenticated admin API.
    if (store.hasAdmin() || store.listUsers().length > 0) return reply.code(409).send({ error: "already set up" });
    const { password, username } = (req.body ?? {}) as { password?: string; username?: string };
    const name = (username ?? "admin").trim() || "admin";
    if (!USERNAME.test(name)) return reply.code(400).send({ error: "username may use letters, digits, . @ - and _ (up to 64)" });
    if (!password || password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
    const id = store.createUser({ username: name, displayName: name, role: "admin", password });
    store.log("info", `first admin user "${name}" created`);
    store.audit(name, "setup", `user:${name}`, "first admin created", req.ip);
    startSession(reply, store.getUser(id)!);
    return { ok: true };
  });

  // Settings "Test" buttons (admin). Neither sends mail or a notification.
  app.post("/api/smtp/test", async (req, reply) => {
    if (!opts.smtpPort) return reply.code(400).send({ error: "SMTP port unknown" });
    const r = await probeSmtp("127.0.0.1", opts.smtpPort);
    audit(req, "smtp.tested", null, r.ok ? "ok" : r.error ?? "failed");
    return r;
  });
  app.post("/api/oidc/test", async (req, reply) => {
    const b = (req.body ?? {}) as { issuer?: string };
    const issuer = String(b.issuer || oidcSettings().issuer || "").trim();
    if (!/^https?:\/\/[^\s]+$/.test(issuer)) return reply.code(400).send({ error: "issuer must be an http:// or https:// URL" });
    const url = issuer.replace(/\/+$/, "") + "/.well-known/openid-configuration";
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: "follow", headers: { Accept: "application/json" } });
      if (!res.ok) return { ok: false, error: `discovery document answered HTTP ${res.status}`, url };
      const d = (await res.json()) as Record<string, unknown>;
      const missing = ["authorization_endpoint", "token_endpoint", "jwks_uri"].filter((k) => typeof d[k] !== "string");
      const same = String(d.issuer ?? "").replace(/\/+$/, "") === issuer.replace(/\/+$/, "");
      const ok = same && !missing.length;
      audit(req, "oidc.tested", null, ok ? "ok" : "problem");
      return { ok, url, ms: Date.now() - t0, issuer: String(d.issuer ?? ""), issuerMatches: same, missing,
        error: ok ? undefined : !same ? `the document's issuer (${String(d.issuer ?? "none")}) differs from the one entered` : `missing ${missing.join(", ")}` };
    } catch (e) { return { ok: false, url, error: (e as Error).name === "TimeoutError" ? "no answer within 6 seconds" : (e as Error).message }; }
  });

  app.post("/api/setup/complete", async (req) => {
    // admin only: not in PERMS, so the preHandler requires the admin permission
    const b = (req.body ?? {}) as { skipped?: unknown };
    const skipped = Array.isArray(b.skipped) ? b.skipped.filter((x): x is string => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 20)) : [];
    store.setSetting("setup_wizard_done", "1");
    audit(req, "setup.wizard.completed", "settings", skipped.length ? `skipped: ${skipped.join(", ")}` : "all steps");
    return { ok: true };
  });

  app.post("/api/login", async (req, reply) => {
    if (!localLoginEnabled()) return reply.code(403).send({ error: "password login is disabled, use single sign-on" });
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return reply.code(429).send({ error: "too many attempts, wait a minute" });
    const { password, username } = (req.body ?? {}) as { password?: string; username?: string };
    const name = String(username ?? "admin").trim() || "admin"; // 0.2.0 clients send only a password
    const user = password ? store.checkLogin(name, password) : undefined;
    if (!user) {
      const n = (f?.n ?? 0) + 1;
      failures.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
      store.log("warn", `failed login for "${name.slice(0, 64)}" from ${ip}`);
      store.audit(name.slice(0, 64), "login.failed", null, null, ip);
      return reply.code(401).send({ error: "wrong username or password" });
    }
    failures.delete(ip);
    store.audit(user.username, "login", `user:${user.username}`, null, ip);
    startSession(reply, user);
    return { ok: true };
  });
  app.post("/api/logout", async (req, reply) => {
    const t = cookie(req); if (t) sessions.delete(t);
    if (req.principal) audit(req, "logout");
    reply.header("Set-Cookie", "mb_session=; Path=/; Max-Age=0");
    return { ok: true };
  });
  app.post("/api/password", async (req, reply) => {
    const { current, password } = (req.body ?? {}) as { current?: string; password?: string };
    const u = req.principal!.user;
    if (!u.hasPassword) return reply.code(400).send({ error: "this account signs in with SSO and has no password" });
    if (!current || !store.checkLogin(u.username, current)) return reply.code(401).send({ error: "wrong current password" });
    if (!password || password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
    store.setUserPassword(u.id, password);
    audit(req, "password.changed", `user:${u.username}`);
    return { ok: true };
  });

  // settings
  app.get("/api/settings", async (req) => ({
    gotifyUrl: store.gotifyUrl,
    smtpPort: opts.smtpPort ?? null, smtpStarttls: store.getSetting("smtp_starttls") === "1",
    smtpAuth: store.getSetting("smtp_auth") === "1",
    limits: readLimits(store), dryRun: isDryRun(),
    smtpUsers: store.listSmtpUsers(),
    ...(() => {
      const o = oidcSettings();
      return {
        publicUrl: o.publicUrl, oidcIssuer: o.issuer, oidcClientId: o.clientId, oidcClientSecretSet: !!o.clientSecret,
        oidcScopes: o.scopes, oidcAllowed: o.allowed.join(", "), oidcFromEnv: o.fromEnv,
        oidcRedirectUri: redirectUri(req), oidcLastSuccess: store.getSetting("oidc_last_success") ?? null,
        localLoginDisabled: store.getSetting("local_login_disabled") === "1", localLoginEnabled: localLoginEnabled(),
        ...(() => { const m = readRoleMapping(store); return { oidcGroupsClaim: m.claim, oidcAdminGroups: m.admin.join(", "), oidcEditorGroups: m.editor.join(", "), oidcViewerGroups: m.viewer.join(", "), oidcDefaultRole: m.defaultRole, oidcLegacyAllAdmin: !m.admin.length && !m.editor.length && !m.viewer.length && m.defaultRole === "admin" }; })(),
      };
    })(),
    ...branding(), timezone: timezone(store), attachments: readAttachmentLimits(store), gravatar: gravatarOn(store), gravatarLocked: process.env.MAILBEACON_GRAVATAR === "0",
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
    const changed: string[] = [];
    const mapKeys: [keyof SettingsBody, string][] = [["oidcGroupsClaim", "oidc_groups_claim"], ["oidcAdminGroups", "oidc_admin_groups"], ["oidcEditorGroups", "oidc_editor_groups"], ["oidcViewerGroups", "oidc_viewer_groups"], ["oidcDefaultRole", "oidc_default_role"]];
    if (b.oidcDefaultRole !== undefined && !["", "none", ...ROLES].includes(String(b.oidcDefaultRole))) return reply.code(400).send({ error: "default role must be none, viewer, editor or admin" });
    if (b.oidcGroupsClaim !== undefined && !/^[\w.:-]{0,100}$/.test(String(b.oidcGroupsClaim))) return reply.code(400).send({ error: "groups claim may only contain letters, digits and . : - _" });
    for (const [f, k] of mapKeys) {
      const v = b[f]; if (typeof v !== "string") continue;
      if ((store.getSetting(k) ?? "") !== v.trim()) changed.push(k);
      if (v.trim()) store.setSetting(k, v.trim()); else store.deleteSetting(k);
    }
    if (b.gravatar !== undefined) {
      if (typeof b.gravatar !== "boolean") return reply.code(400).send({ error: "gravatar must be true or false" });
      store.setSetting("gravatar", b.gravatar ? "1" : "0"); changed.push("gravatar");
    }
    if (b.appName !== undefined) {
      // eslint-disable-next-line no-control-regex -- private placeholder/control characters are stripped on purpose
      const n = String(b.appName).replace(/[\u0000-\u001f<>]/g, "").trim();
      if (n.length > 40) return reply.code(400).send({ error: "app name must be at most 40 characters" });
      if (!n || n === DEFAULT_APP_NAME) store.deleteSetting("app_name"); else store.setSetting("app_name", n);
      changed.push("app_name");
    }
    if (b.defaultTheme !== undefined) {
      if (!THEMES.includes(String(b.defaultTheme))) return reply.code(400).send({ error: "default theme must be dark, light or system" });
      store.setSetting("default_theme", String(b.defaultTheme)); changed.push("default_theme");
    }
    if (b.timezone !== undefined) {
      try { new Intl.DateTimeFormat("en-GB", { timeZone: b.timezone }); } catch { return reply.code(400).send({ error: "unknown timezone (use an IANA name such as Europe/London)" }); }
      store.setSetting("timezone", b.timezone); changed.push("timezone");
    }
    if (b.attachments !== undefined) {
      const ae = writeAttachmentLimits(store, b.attachments ?? {}); if (ae) return reply.code(400).send({ error: ae });
      changed.push("attachment_limits");
    }
    if (oidcChanged) changed.push("oidc");
    if (typeof b.oidcClientSecret === "string" && b.oidcClientSecret) changed.push("oidc_client_secret (value not logged)");
    if (b.localLoginDisabled !== undefined) {
      if (b.localLoginDisabled && !(oidcEnabled(oidcSettings()) && store.getSetting("oidc_last_success")))
        return reply.code(400).send({ error: "log in with single sign-on successfully at least once before disabling password login" });
      store.setSetting("local_login_disabled", b.localLoginDisabled ? "1" : "0");
    }
    if (b.gotifyUrl !== undefined) {
      if (b.gotifyUrl && !/^https?:\/\//.test(b.gotifyUrl)) return reply.code(400).send({ error: "Gotify URL must start with http:// or https://" });
      store.setSetting("gotify_url", b.gotifyUrl);
    }
    if (b.limits !== undefined) {
      if (typeof b.limits !== "object" || b.limits === null) return reply.code(400).send({ error: "limits must be an object" });
      const le = writeLimits(store, b.limits);
      if (le) return reply.code(400).send({ error: le });
    }
    // SMTP AUTH stays optional (off by default) but is only allowed together with STARTTLS
    const wantAuth = b.smtpAuth ?? store.getSetting("smtp_auth") === "1";
    const wantTls = b.smtpStarttls ?? store.getSetting("smtp_starttls") === "1";
    if (wantAuth && !wantTls) return reply.code(400).send({ error: "SMTP AUTH needs STARTTLS: turn on STARTTLS too, so passwords are never sent in clear text" });
    let smtpChanged = false;
    for (const [k, v] of [["smtp_starttls", b.smtpStarttls], ["smtp_auth", b.smtpAuth]] as const) {
      if (v === undefined) continue;
      const nv = v ? "1" : "0";
      if (store.getSetting(k) !== nv) { store.setSetting(k, nv); smtpChanged = true; }
    }
    if (smtpChanged) changed.push("smtp");
    if (b.gotifyUrl !== undefined) changed.push("gotify_url");
    if (b.limits !== undefined) changed.push("limits");
    if (b.localLoginDisabled !== undefined) changed.push("local_login_disabled");
    audit(req, "settings.updated", "settings", [...new Set(changed)].join(", ") || "no changes");
    if (smtpChanged && opts.onSmtpSettingsChanged) await opts.onSmtpSettingsChanged();
    return { ok: true };
  });
  app.post("/api/smtp-users", async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) return reply.code(400).send({ error: "username and password required" });
    if (!USERNAME.test(username)) return reply.code(400).send({ error: "username may use letters, digits, . @ - and _" });
    store.setSmtpUser(username, password);
    audit(req, "smtp-user.saved", `smtp-user:${username}`);
    return { ok: true };
  });
  app.delete("/api/smtp-users/:u", async (req) => {
    store.deleteSmtpUser((req.params as { u: string }).u);
    audit(req, "smtp-user.deleted", `smtp-user:${(req.params as { u: string }).u}`);
    return { ok: true };
  });

  // routes (tokens never leave the server in full)
  const mask = (t: string) => (t.length > 4 ? "••••" + t.slice(-4) : "••••");
  const maskSecrets = (s: TargetSecrets) => Object.fromEntries(Object.entries(s).filter(([, v]) => v).map(([k, v]) => [k, mask(String(v))]));
  const userName = (id: number | null | undefined) => (id ? store.getUser(id)?.username ?? null : null);
  const visibleRoutes = (p: Principal | undefined) => store.listRoutes().filter((r) => owns(p, r.ownerId));
  /** Routes the caller can see, else 404 (never reveal other users' routes). */
  const ownRoute = (req: FastifyRequest, reply: FastifyReply): Route | undefined => {
    const r = store.getRoute(Number((req.params as { id: string }).id));
    if (!r || !owns(req.principal, r.ownerId)) { void reply.code(404).send({ error: "not found" }); return undefined; }
    return r;
  };
  app.get("/api/routes", async (req) => {
    const last = store.lastDeliveries();
    return visibleRoutes(req.principal).map((r) => ({ ...r, gotifyToken: r.targetType === "gotify" ? mask(r.gotifyToken) : "", secrets: maskSecrets(r.secrets),
      lastDelivery: last.get(r.id) ?? null, owner: userName(r.ownerId), health: health.get(`route:${r.id}`) ?? null }));
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
    audit(req, "routes.reordered", null, (ids as number[]).join(","));
    return { ok: true };
  });
  /** Quick toggle without resending the whole route. */
  app.patch("/api/routes/:id", async (req, reply) => {
    const r = ownRoute(req, reply); if (!r) return reply;
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") return reply.code(400).send({ error: "enabled must be true or false" });
    store.setRouteEnabled(r.id, enabled);
    audit(req, enabled ? "route.enabled" : "route.disabled", `route:${r.id}`, r.name);
    return { ok: true };
  });
  /** Keep only known secret keys; a blank value keeps the stored one. */
  const mergeSecrets = (incoming: TargetSecrets | undefined, existing: TargetSecrets = {}) => {
    const out: TargetSecrets = {};
    for (const k of SECRET_KEYS) { const v = incoming?.[k]; if (typeof v === "string" && v) out[k] = v; else if (existing[k] && v !== null) out[k] = existing[k]; }
    return out;
  };

  const validate = (b: RouteBody, p: Principal | undefined, existing?: { gotifyToken: string; secrets: TargetSecrets }) => {
    const tt = b.targetType ?? "gotify";
    if (tt !== "none" && !TARGET_TYPES.includes(tt)) return `targetType must be none or one of ${TARGET_TYPES.join(", ")}`;
    const oe = validateOptions(b.options); if (oe) return oe;
    for (const id of b.options?.destinationIds ?? []) {
      const d = store.getDestination(id);
      if (!d || !owns(p, d.ownerId)) return `destination #${id} not found`;
    }
    if (tt === "none" && !b.options?.destinationIds?.length) return "pick at least one destination, or an inline target";
    if (!isAdmin(p) && b.matchType === "catchall") return "only admins can create catch-all routes";
    if (b.ownerId !== undefined && b.ownerId !== null && !isAdmin(p)) return "only admins can change a route's owner";
    if (b.ownerId && !store.getUser(b.ownerId)) return "ownerId is not a user";
    const types: MatchType[] = ["recipient", "sender", "subject", "catchall"];
    if (!b.name) return "name is required";
    if (!b.matchType || !types.includes(b.matchType)) return "matchType must be recipient, sender, subject or catchall";
    if (b.matchType !== "catchall" && !b.pattern) return "pattern is required";
    if (b.matchType === "sender" || b.matchType === "subject") { try { new RegExp(b.pattern!); } catch { return "pattern is not a valid regex"; } }
    if (tt === "gotify" && !b.gotifyToken && !existing?.gotifyToken) return "gotifyToken is required";
    if (tt !== "gotify" && tt !== "none") { const e = validateTarget(tt, b.target ?? {}, mergeSecrets(b.secrets, existing?.secrets)); if (e) return e; }
    if (b.gotifyUrl && !/^https?:\/\//.test(b.gotifyUrl)) return "gotifyUrl must start with http:// or https://";
    return null;
  };
  const save = (b: RouteBody, id?: number) => store.saveRoute({
    id, name: b.name!, matchType: b.matchType!, pattern: b.matchType === "catchall" ? "" : b.pattern!,
    order: Number(b.order ?? 100), gotifyUrl: b.gotifyUrl || null, gotifyToken: b.gotifyToken!,
    gotifyPriority: Math.max(0, Math.min(10, Number(b.gotifyPriority ?? 5))), enabled: b.enabled !== false,
    targetType: b.targetType ?? "gotify", target: b.target ?? {}, secrets: b.secrets ?? {},
    options: b.options ?? {}, ...(b.ownerId !== undefined ? { ownerId: b.ownerId } : {}),
  });
  app.post("/api/routes", async (req, reply) => {
    const b = (req.body ?? {}) as RouteBody;
    const e = validate(b, req.principal); if (e) return reply.code(400).send({ error: e });
    b.secrets = mergeSecrets(b.secrets); b.gotifyToken ??= "";
    if (b.ownerId === undefined || b.ownerId === null) b.ownerId = req.principal!.user.id;
    if (!isAdmin(req.principal)) b.order = Math.max(100, Number(b.order ?? 100)); // non-admin routes never jump ahead of the admin's
    const id = save(b);
    audit(req, "route.created", `route:${id}`, `${b.name} (${b.matchType}${b.pattern ? " " + b.pattern : ""})`);
    return { id };
  });
  app.put("/api/routes/:id", async (req, reply) => {
    const existing = ownRoute(req, reply); if (!existing) return reply;
    const id = existing.id;
    const b = (req.body ?? {}) as RouteBody;
    if (b.options === undefined) b.options = existing.options;
    const e = validate(b, req.principal, existing); if (e) return reply.code(400).send({ error: e });
    if (!b.gotifyToken) b.gotifyToken = existing.gotifyToken;
    b.secrets = mergeSecrets(b.secrets, existing.secrets);
    if (!isAdmin(req.principal)) b.order = Math.max(100, Number(b.order ?? existing.order));
    save(b, id);
    audit(req, "route.updated", `route:${id}`, b.name ?? null);
    return { ok: true };
  });
  app.delete("/api/routes/:id", async (req, reply) => {
    const r = ownRoute(req, reply); if (!r) return reply;
    store.deleteRoute(r.id);
    audit(req, "route.deleted", `route:${r.id}`, r.name);
    return { ok: true };
  });
  app.post("/api/routes/:id/test", async (req, reply) => {
    const r = ownRoute(req, reply); if (!r) return reply;
    audit(req, "route.tested", `route:${r.id}`, r.name);
    if (r.targetType === "none") return reply.code(400).send({ error: "this route only uses saved destinations: test them on the Destinations page" });
    if (isDryRun()) { store.log("info", `test for route "${r.name}" skipped: dry-run mode`); return { ok: true, dryRun: true }; }
    try {
      await sendToTarget(r as TargetRoute, store.gotifyUrl, { title: "MailBeacon test", message: `Test notification for route **${r.name}**.`, contentType: "text/markdown" });
      store.log("info", `test sent for route "${r.name}"`);
      return { ok: true };
    } catch (e) {
      store.log("error", `test failed for route "${r.name}": ${(e as Error).message}`);
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // test email & route preview
  const envelope = (b: { from?: unknown; to?: unknown; subject?: unknown; body?: unknown }) => {
    const from = String(b.from ?? "").trim();
    const to = String(b.to ?? "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (from && !ADDR.test(from)) return { error: "from must be an email address" };
    if (!to.length || !to.every((a) => ADDR.test(a))) return { error: "to must be one or more email addresses" };
    if (to.length > 20) return { error: "at most 20 recipients" };
    return { from, to, subject: String(b.subject ?? "").slice(0, 500), body: String(b.body ?? "").slice(0, 20000) };
  };
  app.post("/api/routes/preview", async (req, reply) => {
    const e = envelope((req.body ?? {}) as Record<string, unknown>);
    if ("error" in e) return reply.code(400).send({ error: e.error });
    const pv = previewRoute(store.listRoutes(), { sender: e.from, recipients: e.to, subject: e.subject });
    if (isAdmin(req.principal)) return pv;
    // other users' routes still take part in routing, but their names stay private
    const mine = new Set(visibleRoutes(req.principal).map((r) => r.id));
    const other = "(another user's route)";
    const route = pv.route && !mine.has(pv.route.id) ? { id: 0, name: other } : pv.route;
    return { ...pv, route, reason: route && route.name === other ? `delivered by ${other}` : pv.reason,
      trace: pv.trace.filter((t) => mine.has(t.id) || t.note === "first match wins").map((t) => (mine.has(t.id) ? t : { ...t, id: 0, name: other })) };
  });
  app.post("/api/test-email", async (req, reply) => {
    const e = envelope((req.body ?? {}) as Record<string, unknown>);
    if ("error" in e) return reply.code(400).send({ error: e.error });
    const hdr = (v: string) => v.replace(/[\r\n]+/g, " ");
    const raw = [`From: ${e.from || "mailbeacon-test@localhost"}`, `To: ${e.to.join(", ")}`, `Subject: ${hdr(e.subject || "MailBeacon test email")}`,
      "X-MailBeacon-Test: 1", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", e.body || "Test email sent from the MailBeacon web UI."].join("\r\n");
    if (!isAdmin(req.principal)) {
      const pv = previewRoute(store.listRoutes(), { sender: e.from, recipients: e.to, subject: e.subject });
      const rid = (pv.route as { id?: number } | null)?.id;
      if (rid !== undefined && !owns(req.principal, store.getRoute(rid)?.ownerId)) return reply.code(403).send({ error: "that message would go to another user's route" });
    }
    audit(req, "test-email.sent", null, `to ${e.to.join(", ")}`);
    const r = await ingest(store, e.from, e.to, Buffer.from(raw), `test email (web UI, ${req.principal!.user.username})`);
    if (!r.ok) return reply.code(422).send({ ok: false, error: r.error });
    return { ok: true, id: r.id, route: r.route, dryRun: isDryRun() };
  });

  // self-test
  app.get("/api/selftest", async () => lastSelfTest() ?? { at: null, ok: null, dryRun: isDryRun(), checks: [] });
  app.post("/api/selftest", async () => runSelfTest(store));

  // messages, dead letters & logs
  /** History filters shared by the list and the CSV export. Returns an error string or the query. */
  const historyFilter = (req: FastifyRequest): string | MessageQuery => {
    const q = req.query as Record<string, string | undefined>;
    if (q.status && !STATUSES.includes(q.status as MessageStatus)) return `status must be one of ${STATUSES.join(", ")}`;
    const date = (v: string | undefined, name: string, endOfDay: boolean): string | undefined | Error => {
      if (!v) return undefined;
      const day = /^\d{4}-\d{2}-\d{2}$/.test(v);
      const t = Date.parse(day ? v + "T00:00:00Z" : v);
      if (Number.isNaN(t)) return new Error(`${name} must be a date (YYYY-MM-DD) or an ISO timestamp`);
      return new Date(t + (day && endOfDay ? 86400000 : 0)).toISOString();
    };
    const from = date(q.from, "from", false), to = date(q.to, "to", true);
    if (from instanceof Error) return from.message;
    if (to instanceof Error) return to.message;
    if (q.destination && !/^(dest|route):\d+$/.test(q.destination)) return "destination must look like dest:<id> or route:<id>";
    if (q.destination?.startsWith("dest:")) { const d = store.getDestination(Number(q.destination.slice(5))); if (!d || !owns(req.principal, d.ownerId)) return "no such destination"; }
    if (q.destination?.startsWith("route:") || q.routeId) { const r = store.getRoute(Number(q.destination?.slice(6) ?? q.routeId)); if (!r || !owns(req.principal, r.ownerId)) return "no such route"; }
    return { status: q.status as MessageStatus | undefined, q: q.q?.slice(0, 200) || undefined, sender: q.sender?.slice(0, 200) || undefined, routeId: Number(q.routeId) || undefined,
      destination: q.destination || undefined, from, to, ownerId: ownerScope(req.principal) };
  };
  app.get("/api/messages", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const f = historyFilter(req);
    if (typeof f === "string") return reply.code(400).send({ error: f });
    // stays a plain array (as in 0.1.0); the total for paging is in X-Total-Count
    const page = store.queryMessages({ ...f, limit: Number(q.limit) || 100, offset: Number(q.offset) || 0 });
    reply.header("X-Total-Count", String(page.total)).header("Access-Control-Expose-Headers", "X-Total-Count");
    return page.items;
  });
  app.get("/api/messages/export.csv", async (req, reply) => {
    const f = historyFilter(req);
    if (typeof f === "string") return reply.code(400).send({ error: f });
    const page = store.queryMessages({ ...f, limit: Infinity, offset: 0 });
    const rows = page.items.slice(0, CSV_MAX_ROWS);
    audit(req, "messages.exported", null, `${rows.length} of ${page.total} message(s) as CSV`);
    reply.header("Content-Disposition", `attachment; filename="mailbeacon-history-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header("X-Total-Count", String(page.total)).header("X-Truncated", page.total > rows.length ? "1" : "0").header("Cache-Control", "no-store");
    return reply.type("text/csv; charset=utf-8").send(messagesCsv(store, rows));
  });
  // Stats page: real stored history only, scoped like History
  app.get("/api/stats/report", async (req, reply) => {
    const days = Number((req.query as { days?: string }).days ?? 30);
    if (!(STATS_RANGES as readonly number[]).includes(days)) return reply.code(400).send({ error: `days must be one of ${STATS_RANGES.join(", ")}` });
    return statsReport(store, days, ownerScope(req.principal));
  });
  // history filter choices (only what the caller may see)
  app.get("/api/messages/filters", async (req) => {
    const scope = ownerScope(req.principal);
    return {
      routes: visibleRoutes(req.principal).map((r) => ({ id: r.id, name: r.name, inline: r.targetType !== "none" ? r.targetType : null })),
      destinations: store.listDestinations(scope).map((d) => ({ key: `dest:${d.id}`, name: d.name, type: d.type })),
    };
  });

  // retention (admin)
  app.get("/api/retention", async () => ({ ...getRetention(store), maxDays: MAX_RETENTION_DAYS }));
  app.put("/api/retention", async (req, reply) => {
    const b = (req.body ?? {}) as { historyDays?: number; attachmentDays?: number };
    const err = validateRetention(b); if (err) return reply.code(400).send({ error: err });
    setRetention(store, b);
    const r = getRetention(store);
    audit(req, "retention.updated", "settings", `history ${r.historyDays || "forever"} d, attachments ${r.attachmentDays || "forever"} d`);
    return r;
  });
  app.post("/api/retention/purge", async (req, reply) => {
    const b = (req.body ?? {}) as { olderThanDays?: number; what?: string; dryRun?: boolean; confirm?: boolean };
    if (!Number.isInteger(b.olderThanDays) || b.olderThanDays! < 0 || b.olderThanDays! > MAX_RETENTION_DAYS) return reply.code(400).send({ error: `olderThanDays must be a whole number from 0 to ${MAX_RETENTION_DAYS}` });
    if (b.what !== "history" && b.what !== "attachments") return reply.code(400).send({ error: 'what must be "history" or "attachments"' });
    const before = cutoff(b.olderThanDays!);
    const attachmentsOnly = b.what === "attachments";
    const would = countPurge(store, before, attachmentsOnly);
    if (b.dryRun !== false) return { dryRun: true, before, ...would };
    if (b.confirm !== true) return reply.code(400).send({ error: "set confirm: true to delete" });
    const done = store.purgeBefore(before, attachmentsOnly);
    store.log("warn", `manual purge by ${actor(req.principal)}: ${done.messages} message(s), ${done.attachments} attachment(s) older than ${b.olderThanDays} day(s)`);
    audit(req, "retention.purged", null, `${b.what} older than ${b.olderThanDays} day(s): ${done.messages} messages, ${done.attachments} attachments`);
    return { dryRun: false, before, ...done };
  });
  const ownMessage = (req: FastifyRequest, reply: FastifyReply) => {
    const m = store.getMessage(Number((req.params as { id: string }).id));
    if (!m || !owns(req.principal, m.ownerId)) { void reply.code(404).send({ error: "not found" }); return undefined; }
    return m;
  };
  app.get("/api/messages/:id", async (req, reply) => {
    const m = ownMessage(req, reply); if (!m) return reply;
    return { ...m, routeName: m.routeId ? store.getRoute(m.routeId)?.name ?? null : null, owner: userName(m.ownerId), events: store.messageEvents(m.id), attachments: store.attachments(m.id) };
  });
  app.get("/api/messages/:id/attachments/:aid", async (req, reply) => {
    const m = ownMessage(req, reply); if (!m) return reply;
    const a = store.getAttachment(m.id, Number((req.params as { aid: string }).aid));
    if (!a) return reply.code(404).send({ error: "not found" });
    // always a download, never rendered inline (attachments come from arbitrary senders)
    reply.header("Content-Disposition", `attachment; filename="${a.filename.replace(/[^\w. -]/g, "_")}"`).header("Content-Security-Policy", "sandbox");
    return reply.type("application/octet-stream").send(a.content);
  });
  app.delete("/api/messages/:id", async (req, reply) => {
    const m = ownMessage(req, reply); if (!m) return reply;
    const id = m.id;
    store.deleteMessage(id);
    store.log("info", `message ${id} discarded`);
    audit(req, "message.discarded", `message:${id}`, m.subject);
    return { ok: true };
  });
  app.post("/api/messages/:id/retry", async (req, reply) => {
    const m = ownMessage(req, reply); if (!m) return reply;
    const id = m.id;
    audit(req, "message.retried", `message:${id}`, m.status);
    if (m.status === "dead") { store.requeueMessage(id); store.addEvent(id, "requeued", "dead letter retried from the web UI"); }
    else store.addEvent(id, "retry", "manual retry");
    return { ok: await deliver(store, id) };
  });
  app.get("/api/dead-letters", async (req) => store.queryMessages({ status: "dead", limit: 500, ownerId: ownerScope(req.principal) }));
  app.post("/api/dead-letters/retry", async (req) => {
    const dead = store.queryMessages({ status: "dead", limit: 500, ownerId: ownerScope(req.principal) }).items;
    audit(req, "dead-letters.retried", null, `${dead.length} message(s)`);
    for (const m of dead) { store.requeueMessage(m.id); store.addEvent(m.id, "requeued", "all dead letters retried"); }
    store.log("info", `${dead.length} dead letters requeued`);
    return { requeued: dead.length };
  });
  app.get("/api/logs", async () => store.recentLogs(200));

  // ---------- users ----------
  const pubUser = (u: User) => ({ ...u, apiKeys: store.listApiKeys(u.id).length, avatar: avatarInfo(u) });
  app.get("/api/users", async () => store.listUsers().map(pubUser));
  app.post("/api/users", async (req, reply) => {
    const b = (req.body ?? {}) as { username?: string; displayName?: string; email?: string; role?: Role; password?: string };
    const name = String(b.username ?? "").trim();
    if (!USERNAME.test(name)) return reply.code(400).send({ error: "username may use letters, digits, . @ - and _ (up to 64)" });
    if (store.getUserByName(name)) return reply.code(409).send({ error: "a user with that name exists" });
    if (!b.role || !ROLES.includes(b.role)) return reply.code(400).send({ error: "role must be admin, editor or viewer" });
    if (b.password !== undefined && b.password !== "" && b.password.length < 8) return reply.code(400).send({ error: "password must be at least 8 characters" });
    if (b.email && !ADDR.test(b.email)) return reply.code(400).send({ error: "email is not valid" });
    const id = store.createUser({ username: name, displayName: b.displayName?.slice(0, 100) || name, email: b.email || null, role: b.role, password: b.password || undefined });
    audit(req, "user.created", `user:${name}`, `role ${b.role}${b.password ? ", local password" : ", SSO/no password"}`);
    return { id };
  });
  const lastAdminGuard = (u: User, next: { role?: Role; disabled?: boolean; deleting?: boolean }) =>
    u.role === "admin" && !u.disabled && (next.deleting || next.disabled || (next.role && next.role !== "admin")) && store.countAdmins() <= 1;
  app.put("/api/users/:id", async (req, reply) => {
    const u = store.getUser(Number((req.params as { id: string }).id)); if (!u) return reply.code(404).send({ error: "not found" });
    const b = (req.body ?? {}) as { displayName?: string; email?: string | null; role?: Role; disabled?: boolean };
    if (b.role !== undefined && !ROLES.includes(b.role)) return reply.code(400).send({ error: "role must be admin, editor or viewer" });
    if (b.disabled !== undefined && typeof b.disabled !== "boolean") return reply.code(400).send({ error: "disabled must be true or false" });
    if (b.email && !ADDR.test(b.email)) return reply.code(400).send({ error: "email is not valid" });
    if (lastAdminGuard(u, b)) return reply.code(400).send({ error: "this is the last enabled admin: make someone else admin first" });
    store.updateUser(u.id, { displayName: b.displayName?.slice(0, 100), email: b.email === undefined ? undefined : b.email || null, role: b.role, disabled: b.disabled });
    if (b.disabled) for (const [t, sess] of sessions) if (sess.userId === u.id) sessions.delete(t);
    const what = [b.role && b.role !== u.role ? `role ${u.role} -> ${b.role}` : "", b.disabled !== undefined && b.disabled !== u.disabled ? (b.disabled ? "disabled" : "enabled") : "", b.displayName !== undefined || b.email !== undefined ? "profile" : ""].filter(Boolean).join(", ");
    audit(req, "user.updated", `user:${u.username}`, what || "no changes");
    return { ok: true };
  });
  app.post("/api/users/:id/password", async (req, reply) => {
    const u = store.getUser(Number((req.params as { id: string }).id)); if (!u) return reply.code(404).send({ error: "not found" });
    const { password } = (req.body ?? {}) as { password?: string | null };
    if (password !== null && (!password || password.length < 8)) return reply.code(400).send({ error: "password must be at least 8 characters (or null to remove it)" });
    if (password === null && !u.oidcSub) return reply.code(400).send({ error: "removing the password would lock out a user who has never used SSO" });
    store.setUserPassword(u.id, password);
    audit(req, password ? "user.password.reset" : "user.password.removed", `user:${u.username}`);
    return { ok: true };
  });
  app.delete("/api/users/:id", async (req, reply) => {
    const u = store.getUser(Number((req.params as { id: string }).id)); if (!u) return reply.code(404).send({ error: "not found" });
    if (u.id === req.principal!.user.id) return reply.code(400).send({ error: "you can't delete yourself" });
    if (lastAdminGuard(u, { deleting: true })) return reply.code(400).send({ error: "this is the last enabled admin" });
    // their routes, destinations and history move to the admin who deleted them, so mail keeps flowing
    const to = req.principal!.user.id;
    store.db.transaction(() => {
      store.db.prepare("UPDATE routes SET owner_id=? WHERE owner_id=?").run(to, u.id);
      store.db.prepare("UPDATE destinations SET owner_id=? WHERE owner_id=?").run(to, u.id);
      store.db.prepare("UPDATE messages SET owner_id=? WHERE owner_id=?").run(to, u.id);
      store.deleteUser(u.id);
    })();
    for (const [t, sess] of sessions) if (sess.userId === u.id) sessions.delete(t);
    audit(req, "user.deleted", `user:${u.username}`, `routes and destinations moved to ${req.principal!.user.username}`);
    return { ok: true };
  });

  // ---------- API keys (shown once; only a hash is stored) ----------
  app.get("/api/keys", async (req) => {
    const all = isAdmin(req.principal) && (req.query as { all?: string }).all === "1";
    return store.listApiKeys(all ? undefined : req.principal!.user.id).map((k) => ({ ...k, owner: userName(k.userId) }));
  });
  app.post("/api/keys", async (req, reply) => {
    const b = (req.body ?? {}) as { name?: string; scopes?: string[]; expiresInDays?: number | null };
    const name = String(b.name ?? "").trim().slice(0, 100);
    if (!name) return reply.code(400).send({ error: "name is required" });
    if (!Array.isArray(b.scopes) || !b.scopes.length || !b.scopes.every((x) => (SCOPES as string[]).includes(x))) return reply.code(400).send({ error: `scopes must be a list from: ${SCOPES.join(", ")}` });
    const denied = b.scopes.filter((x) => !can({ ...req.principal!, via: "session" }, x as Perm));
    if (denied.length) return reply.code(403).send({ error: `your role can't grant: ${denied.join(", ")}` });
    if (store.listApiKeys(req.principal!.user.id).length >= 50) return reply.code(400).send({ error: "at most 50 keys per user" });
    const days = b.expiresInDays === undefined || b.expiresInDays === null ? null : Number(b.expiresInDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) return reply.code(400).send({ error: "expiresInDays must be 1-3650, or null for no expiry" });
    const { id, key } = store.createApiKey(req.principal!.user.id, name, [...new Set(b.scopes)], days ? new Date(Date.now() + days * 86400000).toISOString() : null);
    audit(req, "apikey.created", `apikey:${id}`, `${name}: ${b.scopes.join(" ")}${days ? `, expires in ${days}d` : ""}`);
    return { id, key, note: "Copy this key now: it is shown only once." };
  });
  app.delete("/api/keys/:id", async (req, reply) => {
    const k = store.getApiKey(Number((req.params as { id: string }).id));
    if (!k || (k.userId !== req.principal!.user.id && !isAdmin(req.principal))) return reply.code(404).send({ error: "not found" });
    store.deleteApiKey(k.id);
    audit(req, "apikey.revoked", `apikey:${k.id}`, `${k.name} (owner ${userName(k.userId)})`);
    return { ok: true };
  });

  // ---------- audit log ----------
  app.get("/api/audit", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const page = store.queryAudit({ actor: q.actor?.slice(0, 100) || undefined, action: q.action?.slice(0, 100) || undefined, q: q.q?.slice(0, 200) || undefined, limit: Number(q.limit) || 100, offset: Number(q.offset) || 0 });
    reply.header("X-Total-Count", String(page.total));
    return page;
  });

  // ---------- destinations ----------
  const ownDest = (req: FastifyRequest, reply: FastifyReply) => {
    const d = store.getDestination(Number((req.params as { id: string }).id));
    if (!d || !owns(req.principal, d.ownerId)) { void reply.code(404).send({ error: "not found" }); return undefined; }
    return d;
  };
  const pubDest = (d: ReturnType<Store["listDestinations"]>[number]) => ({ ...d, secrets: maskSecrets(d.secrets), owner: userName(d.ownerId), health: health.get(`dest:${d.id}`) ?? null,
    usedBy: store.listRoutes().filter((r) => r.options?.destinationIds?.includes(d.id)).map((r) => ({ id: r.id, name: r.name })) });
  app.get("/api/destination-types", async () => TARGET_FIELDS);
  app.get("/api/destinations", async (req) => store.listDestinations(ownerScope(req.principal)).map(pubDest));
  interface DestBody { name?: string; type?: TargetType; config?: TargetConfig; secrets?: TargetSecrets; enabled?: boolean; ownerId?: number }
  const saveDest = (req: FastifyRequest, reply: FastifyReply, existing?: ReturnType<Store["getDestination"]>) => {
    const b = (req.body ?? {}) as DestBody;
    const type = b.type ?? existing?.type;
    if (!type || !TARGET_TYPES.includes(type)) return reply.code(400).send({ error: `type must be one of ${TARGET_TYPES.join(", ")}` });
    const name = String(b.name ?? existing?.name ?? "").trim().slice(0, 100);
    if (!name) return reply.code(400).send({ error: "name is required" });
    // only keys the type defines are stored; blank secret = keep
    const defs = TARGET_FIELDS[type].fields;
    const config: Record<string, unknown> = {};
    for (const f of defs.filter((x) => !x.secret)) {
      const v = (b.config as Record<string, unknown> | undefined)?.[f.key];
      if (v === undefined || v === "") continue;
      config[f.key] = f.kind === "number" ? Number(v) : f.kind === "bool" ? v === true || v === "true" : String(v);
    }
    const secrets: Record<string, string> = {};
    for (const f of defs.filter((x) => x.secret)) {
      const v = (b.secrets as Record<string, unknown> | undefined)?.[f.key];
      const old = existing && existing.type === type ? (existing.secrets as Record<string, string>)[f.key] : undefined;
      if (typeof v === "string" && v) secrets[f.key] = v; else if (old && v !== null) secrets[f.key] = old;
    }
    if (type === "gotify" && !secrets.gotifyToken) return reply.code(400).send({ error: "Gotify app token is required" });
    const err = validateTarget(type, config as TargetConfig, secrets as TargetSecrets);
    if (err) return reply.code(400).send({ error: err });
    if (b.ownerId !== undefined && !isAdmin(req.principal)) return reply.code(403).send({ error: "only admins can change a destination's owner" });
    if (b.ownerId !== undefined && !store.getUser(b.ownerId)) return reply.code(400).send({ error: "ownerId is not a user" });
    const id = store.saveDestination({ id: existing?.id, ownerId: b.ownerId ?? existing?.ownerId ?? req.principal!.user.id, name, type, config: config as TargetConfig, secrets: secrets as TargetSecrets, enabled: b.enabled ?? existing?.enabled ?? true });
    audit(req, existing ? "destination.updated" : "destination.created", `destination:${id}`, `${name} (${type})`);
    return existing ? { ok: true } : { id };
  };
  app.post("/api/destinations", async (req, reply) => saveDest(req, reply));
  app.put("/api/destinations/:id", async (req, reply) => { const d = ownDest(req, reply); if (!d) return reply; return saveDest(req, reply, d); });
  app.delete("/api/destinations/:id", async (req, reply) => {
    const d = ownDest(req, reply); if (!d) return reply;
    const users = store.listRoutes().filter((r) => r.options?.destinationIds?.includes(d.id));
    if (users.length && (req.query as { force?: string }).force !== "1") return reply.code(409).send({ error: `used by route(s): ${users.map((r) => r.name).join(", ")}. Remove it there first, or delete with ?force=1` });
    for (const r of users) store.saveRoute({ ...r, options: { ...r.options, destinationIds: r.options!.destinationIds!.filter((x) => x !== d.id) } });
    store.deleteDestination(d.id);
    audit(req, "destination.deleted", `destination:${d.id}`, `${d.name} (${d.type})`);
    return { ok: true };
  });
  app.post("/api/destinations/:id/test", async (req, reply) => {
    const d = ownDest(req, reply); if (!d) return reply;
    audit(req, "destination.tested", `destination:${d.id}`, d.name);
    if (isDryRun()) return { ok: true, dryRun: true };
    try {
      await sendToTarget(destToTarget(d), store.gotifyUrl, { title: "MailBeacon test", message: `Test notification for destination **${d.name}**.`, contentType: "text/markdown" });
      return { ok: true };
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  // ---------- route templates ----------
  app.get("/api/route-templates", async () => ROUTE_TEMPLATES);

  // ---------- HTTP send API / webhooks ----------
  const apiLimiter = new RateLimiter();
  const scalar = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  /** Flatten JSON into template variables: {"host":{"name":"x"}} -> host_name=x. Depth 3, 50 keys, 500 chars each. */
  const flatten = (v: unknown, prefix = "", depth = 0, out: Record<string, string> = {}) => {
    if (!v || typeof v !== "object" || depth > 3) return out;
    for (const [k0, x] of Object.entries(v as Record<string, unknown>)) {
      if (Object.keys(out).length >= 50) break;
      let k = (prefix ? prefix + "_" : "") + k0.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      if (/^[0-9]/.test(k)) k = "_" + k;
      k = k.slice(0, 32);
      if (scalar(x)) { if (VAR_NAME.test(k)) out[k] = String(x).slice(0, 500); } else flatten(x, k, depth + 1, out);
    }
    return out;
  };
  const pickStr = (b: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (scalar(b[k]) && String(b[k]).trim()) return String(b[k]); return undefined; };
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  const apiSend = async (req: FastifyRequest, reply: FastifyReply, webhookRoute?: number) => {
    const p = req.principal!;
    const lim = readLimits(store).apiPerMinute;
    if (!apiLimiter.take(p.via === "key" ? `k${p.keyId}` : `u${p.user.id}`, lim)) {
      store.log("warn", `HTTP API rate limit hit by ${actor(p)} (over ${lim} per minute)`);
      return reply.code(429).header("Retry-After", "60").send({ error: `rate limit: at most ${lim} messages per minute` });
    }
    const raw = req.body;
    const b: Record<string, unknown> = raw && typeof raw === "object" && !Buffer.isBuffer(raw) ? raw as Record<string, unknown> : typeof raw === "string" ? { message: raw } : {};
    const from = String(pickStr(b, ["from", "sender"]) ?? "").trim();
    if (from && !ADDR.test(from)) return reply.code(400).send({ error: "from must be an email address" });
    const to = String(pickStr(b, ["to"]) ?? "").split(/[,\s]+/).filter(Boolean);
    if (to.length > 20 || !to.every((a) => ADDR.test(a))) return reply.code(400).send({ error: "to must be up to 20 email addresses" });
    let priority: number | undefined;
    if (b.priority !== undefined && b.priority !== "") {
      priority = Number(b.priority);
      if (!Number.isInteger(priority) || priority < 0 || priority > 10) return reply.code(400).send({ error: "priority must be a whole number from 0 to 10" });
    }
    const subject = (pickStr(b, ["subject", "title", "summary", "name"]) ?? (webhookRoute ? "Webhook" : "")).replace(/[\r\n]+/g, " ").slice(0, 500);
    let text = pickStr(b, ["body", "message", "text", "msg", "description"]);
    if (text === undefined && webhookRoute) text = JSON.stringify(b, null, 2);
    text = (text ?? "").slice(0, 20000);
    let route: Route | undefined;
    const rid = webhookRoute ?? (b.route !== undefined && b.route !== "" ? Number(b.route) : undefined);
    if (rid !== undefined) {
      route = Number.isInteger(rid) ? store.getRoute(rid) : undefined;
      if (!route || !owns(p, route.ownerId)) return reply.code(404).send({ error: "no such route" });
      if (!route.enabled) return reply.code(409).send({ error: "that route is disabled" });
    } else {
      if (!to.length) return reply.code(400).send({ error: "give a route id or a to address" });
      route = matchRoute(store.listRoutes(), { sender: from, recipients: to, subject }, { includeSubject: true });
      if (!route) return reply.code(422).send({ error: "no route matches that message" });
      if (!owns(p, route.ownerId)) return reply.code(403).send({ error: "that message would go to another user's route" });
    }
    const vars = flatten(b);
    const via = p.via === "key" ? `key "${p.keyName}"` : "session";
    const r = await ingestParsed(store, { sender: from || "api@mailbeacon.local", recipients: to, source: `${webhookRoute ? "webhook" : "HTTP API"} (${p.user.username}, ${via})`,
      subject, text, vars, route, priority });
    if (!r.ok) return reply.code(422).send({ ok: false, error: r.error });
    return reply.code(202).send({ ok: true, id: r.id, route: r.route, held: r.held ?? null, dryRun: isDryRun() });
  };
  app.post("/api/send", async (req, reply) => apiSend(req, reply));
  app.post("/api/webhook/:routeId", async (req, reply) => apiSend(req, reply, Number((req.params as { routeId: string }).routeId)));

  // ---------- templates ----------
  app.post("/api/templates/preview", async (req, reply) => {
    const b = (req.body ?? {}) as { titleTemplate?: string; bodyTemplate?: string; priorityRules?: RouteOptions["priorityRules"]; extract?: RouteOptions["extract"]; raw?: string; vars?: Record<string, unknown>;
      sample?: { subject?: string; from?: string; to?: string; body?: string; route?: string; attachments?: string[] } };
    const e = validateOptions({ titleTemplate: b.titleTemplate, bodyTemplate: b.bodyTemplate, priorityRules: b.priorityRules, extract: b.extract }); if (e) return reply.code(400).send({ error: e });
    const sm = { ...(b.sample ?? {}) };
    // a pasted raw email (headers + body) fills subject/from/to/body; plain text without headers is used as the body
    if (typeof b.raw === "string" && b.raw.trim()) {
      const rawText = b.raw.slice(0, 200000);
      if (/^[\w-]+:\s/m.test(rawText.split(/\r?\n\r?\n/)[0] ?? "") && /^(subject|from|to|date|received|mime-version):/im.test(rawText)) {
        const m = await simpleParser(Buffer.from(rawText.replace(/\r?\n/g, "\r\n")), { skipHtmlToText: false });
        sm.subject = m.subject ?? ""; sm.body = (m.text ?? "").trim();
        if (m.from?.value[0]?.address) sm.from = m.from.value[0].address;
        const tos = (Array.isArray(m.to) ? m.to : m.to ? [m.to] : []).flatMap((a) => a.value.map((x) => x.address)).filter(Boolean);
        if (tos.length) sm.to = tos.join(", ");
      } else sm.body = rawText;
    }
    const subject = String(sm.subject ?? "[PVE] vzdump backup failed on pve1"), body = String(sm.body ?? "Backup of VM 101 failed: storage full.");
    const extracted = extractValues(b.extract, subject, body);
    const extra = { ...flatten(b.vars ?? {}), ...Object.fromEntries(Object.entries(extracted).filter(([, v]) => v)) };
    for (const k of Object.keys(extracted)) if (!(k in extra)) extra[k] = "";
    const priority = pickPriority(b.priorityRules, subject, body, extra);
    const vars = { subject, from: String(sm.from ?? "proxmox@example.com"), to: String(sm.to ?? "alerts@mailbeacon.local"), body, route: String(sm.route ?? "Example route"), date: new Date(), attachments: Array.isArray(sm.attachments) ? sm.attachments.map(String) : [], priority, extra };
    const tz = timezone(store);
    return { title: b.titleTemplate ? renderTemplate(b.titleTemplate, vars, tz) : subject, body: b.bodyTemplate ? renderTemplate(b.bodyTemplate, vars, tz) : body, priority,
      extracted, sample: { subject, from: vars.from, to: vars.to, body: body.slice(0, 5000) }, variables: TEMPLATE_VARS };
  });

  // ---------- held messages (quiet hours / digests) ----------
  app.post("/api/held/release", async (req) => {
    const scope = ownerScope(req.principal);
    const before = store.heldMessages().filter((m) => scope === undefined || m.ownerId === scope);
    if (scope !== undefined) {
      // non-admins release only their own: temporarily leave others held
      const others = store.heldMessages().filter((m) => m.ownerId !== scope);
      for (const m of others) store.setStatus(m.id, "pending");
      const n = await flushHeld(store, new Date(), true);
      for (const m of others) store.setStatus(m.id, "held");
      audit(req, "held.released", null, `${before.length} message(s)`);
      return { released: before.length, notifications: n };
    }
    const n = await flushHeld(store, new Date(), true);
    audit(req, "held.released", null, `${before.length} message(s)`);
    return { released: before.length, notifications: n };
  });

  // ---------- self-alerts ----------
  app.get("/api/alerts", async () => ({ settings: readAlertSettings(store), history: alertHistory(store),
    health: [...health.entries()].map(([key, h]) => ({ key, ...h })) }));
  app.put("/api/alerts", async (req, reply) => {
    const e = writeAlertSettings(store, (req.body ?? {}) as Partial<AlertSettings>);
    if (e) return reply.code(400).send({ error: e });
    audit(req, "alerts.updated", "settings", JSON.stringify(readAlertSettings(store)));
    return { ok: true };
  });
  app.post("/api/alerts/test", async (req) => {
    audit(req, "alerts.tested");
    return sendAlert(store, "test", "MailBeacon: test alert", "This is a test of MailBeacon self-alerts.");
  });

  // ---------- config export / import ----------
  app.post("/api/config/export", async (req, reply) => {
    const b = (req.body ?? {}) as { secrets?: "exclude" | "encrypt"; passphrase?: string };
    if (b.secrets === "encrypt" && (!b.passphrase || b.passphrase.length < 12)) return reply.code(400).send({ error: "an encrypted export needs a passphrase of at least 12 characters" });
    const out = exportConfig(store, VERSION, { passphrase: b.secrets === "encrypt" ? b.passphrase : undefined });
    audit(req, "config.exported", null, `secrets ${out.secrets}; ${out.routes.length} routes, ${out.destinations.length} destinations`);
    reply.header("Content-Disposition", `attachment; filename="mailbeacon-config-${new Date().toISOString().slice(0, 10)}.json"`);
    return out;
  });
  app.post("/api/config/import", { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body ?? {}) as { config?: unknown; passphrase?: string; mode?: "merge" | "replace"; dryRun?: boolean };
    if (b.mode && !["merge", "replace"].includes(b.mode)) return reply.code(400).send({ error: "mode must be merge or replace" });
    try {
      const sum = importConfig(store, b.config, { passphrase: b.passphrase, mode: b.mode, dryRun: b.dryRun !== false, importerId: req.principal!.user.id });
      if (!sum.dryRun) audit(req, "config.imported", null, `${sum.mode}: ${sum.created.routes} routes, ${sum.created.destinations} destinations, ${sum.created.users} users, secrets ${sum.secretsRestored ? "restored" : "not restored"}`);
      if (!sum.dryRun) oidc.reset();
      return sum;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // PWA: manifest and icons follow the white-label name and logo; the service worker caches the static shell only
  const pwaIcon = new Map<string, Buffer>();
  app.get("/manifest.webmanifest", async (_req, reply) => {
    const b = branding(); const v = logoTag() ?? "default";
    reply.type("application/manifest+json").header("Cache-Control", "no-cache");
    return JSON.stringify({ name: b.appName, short_name: b.appName.slice(0, 12), description: "Email in, notifications out.", id: "/", start_url: "/", scope: "/", display: "standalone",
      theme_color: "#1e1e1e", background_color: "#1e1e1e",
      icons: [192, 512].flatMap((n) => [{ src: `/pwa-icon-${n}.png?v=${v}`, sizes: `${n}x${n}`, type: "image/png", purpose: "any" }, { src: `/pwa-icon-${n}.png?v=${v}&maskable=1`, sizes: `${n}x${n}`, type: "image/png", purpose: "maskable" }]) });
  });
  for (const n of [192, 512]) {
    app.get(`/pwa-icon-${n}.png`, async (req, reply) => {
      const logo = store.getSetting("brand_logo");
      const maskable = (req.query as { maskable?: string }).maskable === "1";
      reply.type("image/png").header("Cache-Control", "no-cache");
      if (!logo && !maskable) return fs.readFileSync(path.join(publicDir, `android-chrome-${n}x${n}.png`));
      const key = `${n}:${maskable}:${logoTag() ?? "default"}`;
      if (!pwaIcon.has(key)) {
        if (pwaIcon.size > 16) pwaIcon.clear();
        const src = logo ? Buffer.from(logo, "base64") : fs.readFileSync(path.join(publicDir, "android-chrome-512x512.png"));
        const inner = Math.round(n * (maskable ? 0.62 : 0.84)); // maskable icons keep the logo inside the safe zone
        const img = await sharp(src).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        pwaIcon.set(key, await sharp({ create: { width: n, height: n, channels: 4, background: maskable || logo ? "#1e1e1e" : { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: img, gravity: "center" }]).png().toBuffer());
      }
      return pwaIcon.get(key);
    });
  }
  app.get("/sw.js", async (_req, reply) => {
    reply.type("text/javascript").header("Cache-Control", "no-cache").header("Service-Worker-Allowed", "/");
    return fs.readFileSync(path.join(publicDir, "sw.js"));
  });

  // static UI
  const files: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/wizard.js": "wizard.js", "/icons/gotify.svg": "icons/gotify.svg", "/icons/ntfy.svg": "icons/ntfy.svg", "/icons/pushover.svg": "icons/pushover.svg", "/icons/apprise.svg": "icons/apprise.svg", "/icons/discord.svg": "icons/discord.svg", "/icons/slack.svg": "icons/slack.svg", "/icons/telegram.svg": "icons/telegram.svg", "/icons/webhook.svg": "icons/webhook.svg", "/style.css": "style.css", "/logo.svg": "logo.svg", "/logo-header.svg": "logo-header.svg", "/favicon.svg": "favicon.svg", "/favicon.ico": "favicon.ico", "/apple-touch-icon.png": "apple-touch-icon.png", "/site.webmanifest": "site.webmanifest", "/android-chrome-192x192.png": "android-chrome-192x192.png", "/android-chrome-512x512.png": "android-chrome-512x512.png", "/fonts/Inter.woff2": "fonts/Inter.woff2", "/fonts/OFL.txt": "fonts/OFL.txt", "/fonts/Geist.woff2": "fonts/Geist.woff2", "/fonts/GeistMono.woff2": "fonts/GeistMono.woff2", "/fonts/Geist-OFL.txt": "fonts/Geist-OFL.txt" };
  const types: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", ico: "image/x-icon", png: "image/png", webmanifest: "application/manifest+json", woff2: "font/woff2", txt: "text/plain; charset=utf-8" };
  for (const [url, file] of Object.entries(files)) {
    app.get(url, async (_req, reply) => {
      reply.type(types[file.split(".").pop()!]);
      return fs.readFileSync(path.join(publicDir, file));
    });
  }
  return app;
}
