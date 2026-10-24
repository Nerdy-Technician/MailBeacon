import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { start } from "../src/index.js";
import { Store } from "../src/db.js";
import { PERMS } from "../src/auth.js";
import { inQuietHours, pickPriority, renderTemplate } from "../src/format.js";
import { checkAlerts } from "../src/alerts.js";
import { health } from "../src/delivery.js";
import { gravatarUrl, sniffImage } from "../src/web.js";

interface Hit { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }

describe("0.3.0: users, keys, destinations, templates, quiet hours, export, alerts, profile", () => {
  const hits: Hit[] = [];
  let down = false;
  const mock = http.createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (down) { res.statusCode = 503; return res.end(); }
      hits.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}');
    });
  });
  let M = "";
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 27250 + Math.floor(Math.random() * 500);
  const webPort = smtpPort + 1000;
  const base = `http://127.0.0.1:${webPort}`;
  const web = (p: string, init: RequestInit = {}) => fetch(base + p, { redirect: "manual", ...init });
  const cookies: Record<string, string> = {};
  const as = (who: string, method: string, body?: unknown) => ({
    method, headers: { "X-MailBeacon": "1", cookie: cookies[who] ?? "", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const call = async (who: string, method: string, p: string, body?: unknown) => {
    const r = await web(p, as(who, method, body));
    const t = await r.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper returns loose JSON
    let j: any; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, headers: r.headers };
  };
  const login = async (who: string, password: string) => {
    const r = await web("/api/login", as("", "POST", { username: who, password }));
    expect(r.status).toBe(200);
    cookies[who] = (r.headers.get("set-cookie") ?? "").split(";")[0];
  };
  const transport = () => nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true });
  const waitHits = async (n: number) => { for (let i = 0; i < 80 && hits.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };
  const dests: Record<string, number> = {};

  beforeAll(async () => {
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", () => r()));
    M = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-b2-"));
    app = await start({ dataDir, smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 2 * 1024 * 1024, smtpHostname: "test", secret: "b2" });
    const r = await web("/api/setup", as("", "POST", { username: "root", password: "rootpassword" }));
    expect(r.status).toBe(200);
    cookies.root = (r.headers.get("set-cookie") ?? "").split(";")[0];
  });
  afterAll(async () => { await app.stop(); mock.close(); });

  describe("users and roles", () => {
    it("creates editor and viewer users and audits it", async () => {
      expect((await call("root", "POST", "/api/users", { username: "ed", role: "editor", password: "editorpass" })).status).toBe(200);
      expect((await call("root", "POST", "/api/users", { username: "vi", role: "viewer", password: "viewerpass" })).status).toBe(200);
      expect((await call("root", "POST", "/api/users", { username: "ed", role: "editor" })).status).toBe(409);
      expect((await call("root", "POST", "/api/users", { username: "x y", role: "editor" })).status).toBe(400);
      expect((await call("root", "POST", "/api/users", { username: "bad", role: "god" })).status).toBe(400);
      await login("ed", "editorpass"); await login("vi", "viewerpass");
      const me = await call("ed", "GET", "/api/me");
      expect(me.body).toMatchObject({ username: "ed", role: "editor" });
      expect(me.body.perms).toContain("routes:write");
      expect(me.body.perms).not.toContain("admin");
    });
    it("enforces role permissions", async () => {
      expect((await call("vi", "POST", "/api/routes", { name: "v", matchType: "recipient", pattern: "v@x", gotifyToken: "AAAAAAAAAAAAAAA" })).status).toBe(403);
      expect((await call("ed", "GET", "/api/users")).status).toBe(403);
      expect((await call("ed", "GET", "/api/settings")).status).toBe(403);
      expect((await call("ed", "GET", "/api/audit")).status).toBe(403);
      expect((await call("vi", "GET", "/api/routes")).status).toBe(200);
    });
    it("protects the last admin", async () => {
      const users = (await call("root", "GET", "/api/users")).body as { id: number; username: string }[];
      const root = users.find((u) => u.username === "root")!;
      expect((await call("root", "PUT", `/api/users/${root.id}`, { role: "viewer" })).status).toBe(400);
      expect((await call("root", "PUT", `/api/users/${root.id}`, { disabled: true })).status).toBe(400);
      expect((await call("root", "DELETE", `/api/users/${root.id}`)).status).toBe(400);
    });
    it("disabling a user ends their sessions", async () => {
      expect((await call("root", "POST", "/api/users", { username: "tmp", role: "viewer", password: "temppassword" })).status).toBe(200);
      await login("tmp", "temppassword");
      const id = ((await call("root", "GET", "/api/users")).body as { id: number; username: string }[]).find((u) => u.username === "tmp")!.id;
      expect((await call("root", "PUT", `/api/users/${id}`, { disabled: true })).status).toBe(200);
      expect((await call("tmp", "GET", "/api/me")).status).toBe(401);
      expect((await web("/api/login", as("", "POST", { username: "tmp", password: "temppassword" }))).status).toBe(401);
      expect((await call("root", "DELETE", `/api/users/${id}`)).status).toBe(200);
    });
  });

  describe("destinations and fan-out", () => {
    it("lists destination types", async () => {
      const t = (await call("ed", "GET", "/api/destination-types")).body;
      expect(Object.keys(t)).toEqual(expect.arrayContaining(["gotify", "ntfy", "pushover", "apprise", "discord", "slack", "telegram", "webhook"]));
    });
    it("creates one destination of each type with masked secrets", async () => {
      const defs: [string, string, Record<string, unknown>, Record<string, string>][] = [
        ["gotify", "g", { gotifyUrl: M }, { gotifyToken: "AgotifySECRET01" }],
        ["ntfy", "n", { ntfyUrl: M, ntfyTopic: "alerts" }, { ntfyToken: "tk_ntfySECRET" }],
        ["pushover", "p", { pushoverApiUrl: M }, { pushoverToken: "poTokenSECRET", pushoverUser: "poUserSECRET" }],
        ["apprise", "a", { appriseUrl: M }, { appriseUrls: "mailto://SECRETapprise" }],
        ["discord", "d", { discordUsername: "MB" }, { discordWebhookUrl: `${M}/discord/SECRETdiscord` }],
        ["slack", "s", {}, { slackWebhookUrl: `${M}/slack/SECRETslack` }],
        ["telegram", "t", { telegramChatId: "-100123", telegramApiUrl: M }, { telegramBotToken: "123456:SECRETtelegramTOKEN_abcdef" }],
        ["webhook", "w", { webhookUrl: `${M}/hook`, webhookAttachments: true }, { webhookAuthHeader: "Bearer SECRETwebhook" }],
      ];
      for (const [type, name, config, secrets] of defs) {
        const r = await call("ed", "POST", "/api/destinations", { name, type, config, secrets });
        expect(r.status, `${type}: ${JSON.stringify(r.body)}`).toBe(200);
        dests[type] = r.body.id;
      }
      const list = await call("ed", "GET", "/api/destinations");
      expect(list.body).toHaveLength(8);
      expect(JSON.stringify(list.body)).not.toMatch(/SECRET/);
      expect((await call("ed", "POST", "/api/destinations", { name: "bad", type: "telegram", config: { telegramChatId: "x" }, secrets: { telegramBotToken: "nope" } })).status).toBe(400);
    });
    it("scopes destinations to their owner", async () => {
      expect((await call("vi", "GET", "/api/destinations")).body).toHaveLength(0);
      expect((await call("root", "GET", "/api/destinations")).body).toHaveLength(8);
      expect((await call("vi", "PUT", `/api/destinations/${dests.slack}`, { name: "x" })).status).toBe(403);
    });
    it("fans one mail out to every destination, with attachments where supported", async () => {
      const r = await call("ed", "POST", "/api/routes", { name: "fan", matchType: "recipient", pattern: "fan@alerts.local", targetType: "none",
        options: { destinationIds: Object.values(dests), titleTemplate: "[{{route}}] {{subject:20}}", priorityRules: [{ field: "subject", pattern: "fail", priority: 9 }], attachments: { forward: true } } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      hits.length = 0;
      await transport().sendMail({ from: "pve@host", to: "fan@alerts.local", subject: "Backup failed on pve1 tonight", text: "storage full",
        attachments: [{ filename: "log.txt", content: "line1\nline2" }] });
      await waitHits(9);
      await new Promise((r2) => setTimeout(r2, 300));
      const urls = hits.map((h) => `${h.method} ${h.url}`);
      expect(urls).toEqual(expect.arrayContaining(["POST /message", "PUT /alerts", "POST /1/messages.json", "POST /notify/", "POST /discord/SECRETdiscord", "POST /slack/SECRETslack",
        "POST /bot123456:SECRETtelegramTOKEN_abcdef/sendMessage", "POST /bot123456:SECRETtelegramTOKEN_abcdef/sendDocument", "POST /hook"]));
      const gotify = JSON.parse(hits.find((h) => h.url === "/message")!.body.toString());
      expect(gotify.title).toBe("[fan] Backup failed on pve…");
      expect(gotify.priority).toBe(9);
      const ntfyPut = hits.find((h) => h.method === "PUT")!;
      expect(ntfyPut.body.toString()).toBe("line1\nline2");
      expect(ntfyPut.headers.priority).toBe("5");
      const hook = JSON.parse(hits.find((h) => h.url === "/hook")!.body.toString());
      expect(hook.attachments[0]).toMatchObject({ filename: "log.txt" });
      expect(Buffer.from(hook.attachments[0].base64, "base64").toString()).toBe("line1\nline2");
      expect(hits.find((h) => h.url === "/hook")!.headers.authorization).toBe("Bearer SECRETwebhook");
      const msgs = (await call("ed", "GET", "/api/messages")).body as { id: number; status: string }[];
      expect(msgs[0].status).toBe("delivered");
      const detail = (await call("ed", "GET", `/api/messages/${msgs[0].id}`)).body;
      expect(detail.attachments?.length).toBe(1);
      const dl = await web(`/api/messages/${msgs[0].id}/attachments/${detail.attachments[0].id}`, as("ed", "GET"));
      expect(dl.headers.get("content-type")).toContain("application/octet-stream");
      expect((await call("vi", "GET", `/api/messages/${msgs[0].id}`)).status).toBe(404);
    });
    it("only re-sends to the destinations that failed", async () => {
      hits.length = 0;
      down = true;
      await transport().sendMail({ from: "pve@host", to: "fan@alerts.local", subject: "x", text: "y" });
      await new Promise((r) => setTimeout(r, 600));
      down = false;
      const m = ((await call("ed", "GET", "/api/messages")).body as { id: number; status: string }[])[0];
      expect(m.status).toBe("failed");
      expect((await call("ed", "POST", `/api/messages/${m.id}/retry`)).status).toBe(200);
      await waitHits(8);
      expect(((await call("ed", "GET", `/api/messages/${m.id}`)).body).status).toBe("delivered");
    });
  });

  describe("API keys", () => {
    let key = "";
    it("creates a scoped key shown once, stored hashed", async () => {
      const r = await call("ed", "POST", "/api/keys", { name: "ci", scopes: ["routes:read", "messages:read"], expiresInDays: 30 });
      expect(r.status).toBe(200);
      key = r.body.key;
      expect(key).toMatch(/^mbk_\d+_/);
      const list = await call("ed", "GET", "/api/keys");
      expect(JSON.stringify(list.body)).not.toContain(key.replace(/^mbk_\d+_/, ""));
      const raw = JSON.stringify(app.store.db.prepare("SELECT * FROM api_keys").all());
      expect(raw).not.toContain(key.replace(/^mbk_\d+_/, ""));
    });
    it("refuses scopes above the role", async () => {
      expect((await call("vi", "POST", "/api/keys", { name: "x", scopes: ["routes:write"] })).status).toBe(403);
      expect((await call("ed", "POST", "/api/keys", { name: "x", scopes: ["admin"] })).status).toBe(403);
      expect((await call("ed", "POST", "/api/keys", { name: "x", scopes: ["nope"] })).status).toBe(400);
    });
    it("authenticates with Bearer, limited by scope, no CSRF header needed", async () => {
      const b = { headers: { Authorization: `Bearer ${key}` } };
      expect((await web("/api/routes", b)).status).toBe(200);
      expect((await web("/api/destinations", b)).status).toBe(403);
      expect((await web("/api/routes", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
      expect((await web("/api/routes", { headers: { Authorization: `Bearer ${key}x` } })).status).toBe(401);
      expect((await web("/api/me", b)).status).toBe(200);
      expect((await web("/api/me", { method: "PUT", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
    });
    it("revokes a key", async () => {
      const id = Number(key.split("_")[1]);
      expect((await call("vi", "DELETE", `/api/keys/${id}`)).status).toBe(404);
      expect((await call("ed", "DELETE", `/api/keys/${id}`)).status).toBe(200);
      expect((await web("/api/routes", { headers: { Authorization: `Bearer ${key}` } })).status).toBe(401);
    });
  });

  describe("audit log", () => {
    it("records who did what, without secrets", async () => {
      const r = await call("root", "GET", "/api/audit?limit=500");
      expect(Number(r.headers.get("x-total-count"))).toBeGreaterThan(10);
      const actions = (r.body.items as { action: string; actor: string }[]).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["user.created", "destination.created", "route.created", "apikey.created", "apikey.revoked", "login"]));
      expect(JSON.stringify(r.body)).not.toMatch(/SECRET|editorpass|rootpassword/);
      const f = await call("root", "GET", "/api/audit?actor=ed&action=apikey.");
      expect((f.body.items as { action: string }[]).every((a) => a.action.startsWith("apikey."))).toBe(true);
    });
  });

  describe("templates, priority and quiet hours", () => {
    it("renders templates with truncation and leaves unknown names visible", () => {
      const v = { subject: "Hello world", from: "a@b", to: "c@d", body: "B", route: "R", date: new Date("2026-10-24T13:00:00Z"), attachments: ["x.txt"], priority: 7 };
      expect(renderTemplate("[{{route}}] {{subject:5}} {{nope}} {{attachments}} {{priority}}", v)).toBe("[R] Hello… {{nope}} x.txt 7");
      expect(renderTemplate("{{time}}", v, "Europe/London")).toBe("14:00");
    });
    it("picks the first matching priority rule", () => {
      const rules = [{ field: "subject" as const, pattern: "fail", priority: 9 }, { field: "any" as const, pattern: "warn", priority: 6 }];
      expect(pickPriority(rules, "Backup FAILED", "")).toBe(9);
      expect(pickPriority(rules, "ok", "a warning")).toBe(6);
      expect(pickPriority(rules, "ok", "ok")).toBeNull();
    });
    it("handles quiet windows that wrap midnight", () => {
      const q = { enabled: true, start: "22:00", end: "07:00", action: "hold" as const };
      expect(inQuietHours(q, new Date("2026-10-24T22:30:00Z"), "UTC")).toBe(true);
      expect(inQuietHours(q, new Date("2026-10-24T06:59:00Z"), "UTC")).toBe(true);
      expect(inQuietHours(q, new Date("2026-10-24T12:00:00Z"), "UTC")).toBe(false);
    });
    it("previews templates through the API", async () => {
      const r = await call("ed", "POST", "/api/templates/preview", { titleTemplate: "{{subject:10}}!", priorityRules: [{ field: "subject", pattern: "failed", priority: 9 }] });
      expect(r.body).toMatchObject({ title: "[PVE] vzdu…!", priority: 9 });
      expect((await call("ed", "POST", "/api/templates/preview", { priorityRules: [{ field: "subject", pattern: "(", priority: 9 }] })).status).toBe(400);
    });
    it("holds mail during quiet hours, lets urgent mail through, and sends a digest on release", async () => {
      const r = await call("ed", "POST", "/api/routes", { name: "quiet", matchType: "recipient", pattern: "quiet@alerts.local", targetType: "none",
        options: { destinationIds: [dests.webhook], priorityRules: [{ field: "subject", pattern: "URGENT", priority: 9 }], quiet: { enabled: true, start: "00:00", end: "23:59", action: "digest", bypassPriority: 8 } } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      hits.length = 0;
      for (const s of ["one", "two", "URGENT three"]) await transport().sendMail({ from: "a@b", to: "quiet@alerts.local", subject: s, text: s });
      await waitHits(1); await new Promise((x) => setTimeout(x, 300));
      expect(hits).toHaveLength(1);
      expect(JSON.parse(hits[0].body.toString()).title).toBe("URGENT three");
      const held = (await call("ed", "GET", "/api/messages?status=held")).body as unknown[];
      expect(held).toHaveLength(2);
      const rel = await call("ed", "POST", "/api/held/release");
      expect(rel.body).toMatchObject({ released: 2, notifications: 1 });
      await waitHits(2);
      expect(JSON.parse(hits[1].body.toString()).title).toBe("quiet: 2 messages");
    });
  });

  describe("attachment limits", () => {
    it("rejects too many or too large attachments by stripping them with a note", async () => {
      expect((await call("root", "PUT", "/api/settings", { attachments: { maxFileKb: 1, maxTotalKb: 2, maxCount: 1 } })).status).toBe(200);
      hits.length = 0;
      await transport().sendMail({ from: "a@b", to: "fan@alerts.local", subject: "big", text: "t",
        attachments: [{ filename: "a.bin", content: Buffer.alloc(2048, 1) }, { filename: "b.txt", content: "ok" }] });
      await waitHits(9); await new Promise((x) => setTimeout(x, 300));
      const m = ((await call("ed", "GET", "/api/messages")).body as { id: number }[])[0];
      const d = (await call("ed", "GET", `/api/messages/${m.id}`)).body;
      expect(d.attachments.length).toBeLessThanOrEqual(1);
      expect(JSON.stringify(d.events)).toMatch(/attachment/i);
      expect((await call("root", "PUT", "/api/settings", { attachments: { maxFileKb: -1 } })).status).toBe(400);
    });
  });

  describe("config export and import", () => {
    let enc: unknown, plain: unknown;
    it("exports without secrets or password hashes", async () => {
      const r = await call("root", "POST", "/api/config/export", { secrets: "exclude" });
      plain = r.body;
      const t = JSON.stringify(r.body);
      expect(t).not.toMatch(/SECRET|scrypt|password_hash/);
      expect(r.body.routes.length).toBeGreaterThanOrEqual(2);
      expect((await call("root", "POST", "/api/config/export", { secrets: "encrypt", passphrase: "short" })).status).toBe(400);
      const e = await call("root", "POST", "/api/config/export", { secrets: "encrypt", passphrase: "correct horse battery" });
      enc = e.body;
      expect(JSON.stringify(e.body)).not.toMatch(/SECRET/);
      expect((await call("ed", "POST", "/api/config/export", {})).status).toBe(403);
    });
    it("round-trips into a fresh instance, restoring encrypted secrets", async () => {
      const s2 = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "mb-imp-")), Buffer.alloc(32, 3));
      s2.createUser({ username: "admin", role: "admin", password: "x".repeat(10) });
      const { importConfig } = await import("../src/configio.js");
      expect(() => importConfig(s2, enc, { passphrase: "wrong passphrase!!", mode: "merge", dryRun: false, importerId: 1 })).toThrow(/passphrase/);
      const dry = importConfig(s2, enc, { passphrase: "correct horse battery", mode: "merge", dryRun: true, importerId: 1 });
      expect(s2.listDestinations()).toHaveLength(0);
      expect(dry.created.destinations).toBe(8);
      const sum = importConfig(s2, enc, { passphrase: "correct horse battery", mode: "merge", dryRun: false, importerId: 1 });
      expect(sum.secretsRestored).toBe(true);
      const d = s2.listDestinations().find((x) => x.type === "webhook")!;
      expect(d.secrets.webhookAuthHeader).toBe("Bearer SECRETwebhook");
      expect(d.enabled).toBe(true);
      const fan = s2.listRoutes().find((r) => r.name === "fan")!;
      expect(fan.options?.destinationIds?.length).toBe(8);
      expect(fan.options!.destinationIds!.every((id) => s2.listDestinations().some((x) => x.id === id))).toBe(true);
      expect(s2.getUserByName("ed")?.hasPassword).toBe(false);
      // without secrets, items come in disabled
      const s3 = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "mb-imp-")), Buffer.alloc(32, 4));
      s3.createUser({ username: "admin", role: "admin", password: "x".repeat(10) });
      const sum3 = importConfig(s3, plain, { mode: "merge", dryRun: false, importerId: 1 });
      expect(s3.listDestinations().every((x) => !x.enabled || x.type === "webhook")).toBe(true);
      expect(sum3.warnings.join(" ")).toMatch(/disabled/);
      s2.close(); s3.close();
    });
  });

  describe("self-alerts", () => {
    it("alerts once per cooldown when dead letters pile up or a target keeps failing", async () => {
      expect((await call("root", "PUT", "/api/alerts", { enabled: true, destinationId: dests.webhook, deadLetterThreshold: 1, unreachableAfter: 2, cooldownMinutes: 60, onSelfTestFail: false })).status).toBe(200);
      app.store.db.prepare("UPDATE messages SET status='dead' WHERE id=(SELECT MIN(id) FROM messages)").run();
      health.set(`dest:${dests.slack}`, { name: "s", failures: 5, lastError: "HTTP 503", lastOk: null, lastFail: new Date().toISOString() });
      hits.length = 0;
      const a = await checkAlerts(app.store);
      expect(a.map((x) => x.kind.split(":")[0]).sort()).toEqual(["dead-letters", "unreachable"]);
      expect(hits.filter((h) => h.url === "/hook")).toHaveLength(2);
      expect(await checkAlerts(app.store)).toHaveLength(0);
      health.delete(`dest:${dests.slack}`);
      expect(((await call("root", "GET", "/api/alerts")).body.history as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect((await call("root", "PUT", "/api/alerts", { cooldownMinutes: -1 })).status).toBe(400);
    });
  });

  describe("profile and avatars", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0)]);
    const up = (who: string, type: string, body: Buffer) => web("/api/me/avatar", { method: "POST", headers: { "X-MailBeacon": "1", cookie: cookies[who], "Content-Type": type }, body: new Uint8Array(body) });
    it("sniffs image types and refuses SVG", () => {
      expect(sniffImage(png)).toBe("image/png");
      expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
      expect(sniffImage(Buffer.from("GIF89a....."))).toBe("image/gif");
      expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    });
    it("defaults to Gravatar (sha256 of the trimmed lowercase email, d=404), else initials", async () => {
      expect(gravatarUrl("  NT@Example.com ")).toBe("https://gravatar.com/avatar/" + crypto.createHash("sha256").update("nt@example.com").digest("hex") + "?s=96&d=404");
      let me = (await call("ed", "GET", "/api/me")).body;
      expect(me.avatar).toMatchObject({ source: "initials", url: null, initials: "ED" });
      me = (await call("ed", "PUT", "/api/me", { email: " ed@example.com", displayName: "Eddie Editor" })).body;
      expect(me.avatar.initials).toBe("EE");
      expect((await call("ed", "PUT", "/api/me", { email: "ed@example.com" })).body.avatar).toMatchObject({ source: "gravatar", url: gravatarUrl("ed@example.com") });
      expect((await call("root", "PUT", "/api/settings", { gravatar: false })).status).toBe(200);
      expect((await call("ed", "GET", "/api/me")).body.avatar.source).toBe("initials");
      expect((await call("root", "PUT", "/api/settings", { gravatar: true })).status).toBe(200);
    });
    it("validates uploads by type, content and size", async () => {
      expect((await up("ed", "image/svg+xml", Buffer.from("<svg/>"))).status).toBe(415);
      expect((await up("ed", "image/png", Buffer.from("not really a png"))).status).toBe(415);
      expect((await up("ed", "image/jpeg", png)).status).toBe(415);
      expect((await up("ed", "image/png", png)).status).toBe(422); // right magic bytes, but not a decodable image
      const real = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c90000" } }).png().toBuffer();
      const ok = await up("ed", "image/png", real);
      expect(ok.status).toBe(200);
      const me = await ok.json();
      expect(me.avatar).toMatchObject({ source: "upload" });
      const img = await web(me.avatar.url, as("vi", "GET"));
      expect(img.headers.get("content-type")).toBe("image/webp");
      expect(img.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await call("ed", "PUT", "/api/me", { avatarSource: "gravatar" })).body.avatar.source).toBe("gravatar");
      expect((await call("ed", "PUT", "/api/me", { avatarSource: "oidc" })).status).toBe(400);
      expect((await call("ed", "DELETE", "/api/me/avatar")).body.avatar.available).not.toContain("upload");
    });
    it("saves theme and time zone preferences", async () => {
      expect((await call("vi", "PUT", "/api/me", { prefs: { theme: "light", timezone: "Europe/London" } })).body.prefs).toEqual({ theme: "light", timezone: "Europe/London" });
      expect((await call("vi", "PUT", "/api/me", { prefs: { theme: "neon" } })).status).toBe(400);
      expect((await call("vi", "PUT", "/api/me", { prefs: { timezone: "Mars/Olympus" } })).status).toBe(400);
      expect((await call("vi", "PUT", "/api/me", { displayName: "" })).status).toBe(400);
    });
    it("changes own password (local accounts)", async () => {
      expect((await call("vi", "POST", "/api/password", { current: "wrong", password: "newviewerpass" })).status).toBe(401);
      expect((await call("vi", "POST", "/api/password", { current: "viewerpass", password: "newviewerpass" })).status).toBe(200);
      await login("vi", "newviewerpass");
    });
  });

  describe("dashboard stats", () => {
    it("returns buckets and scoped counts", async () => {
      const r = await call("ed", "GET", "/api/stats?range=24h");
      expect(r.body.buckets).toHaveLength(24);
      expect(r.body.buckets.reduce((a: number, b: { delivered: number }) => a + b.delivered, 0)).toBeGreaterThan(0);
      expect(r.body.destinations).toHaveLength(8);
      expect((await call("vi", "GET", "/api/stats?range=7d")).body.buckets).toHaveLength(7);
      expect((await call("vi", "GET", "/api/stats")).body.counts.delivered).toBe(0);
      expect((await call("vi", "GET", "/api/stats?range=1y")).status).toBe(400);
    });
  });

  describe("API docs", () => {
    it("documents every route and every documented route has a permission", async () => {
      const spec = await (await web("/docs/json")).json();
      const documented = Object.entries(spec.paths as Record<string, Record<string, unknown>>).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ":$1")}`));
      for (const k of documented.filter((k) => k.includes("/api/"))) expect(PERMS[k], k).toBeDefined();
      for (const k of Object.keys(PERMS)) expect(documented, k).toContain(k);
    });
  });
});
