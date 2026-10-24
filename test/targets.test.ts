import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { sendToTarget, validateTarget, type TargetRoute } from "../src/targets.js";
import { Store } from "../src/db.js";
import { encrypt } from "../src/crypto.js";

interface Hit { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

describe("notification targets against mock servers", () => {
  const hits: Hit[] = [];
  let srv: http.Server;
  let base = "";
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        hits.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        res.statusCode = req.url!.includes("fail") || body.includes("fail-topic") ? 500 : 200;
        res.setHeader("Content-Type", "application/json"); res.end('{"status":1}');
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  });
  afterAll(() => srv.close());

  const r = (p: Partial<TargetRoute>): TargetRoute => ({ name: "t", targetType: "gotify", gotifyUrl: null, gotifyToken: "g", gotifyPriority: 5, target: {}, secrets: {}, ...p });
  const n = { title: "Disk full", message: "Pool **tank** at 95%", contentType: "text/markdown" };

  it("gotify posts to /message with the app token", async () => {
    await sendToTarget(r({ gotifyToken: "GT" }), base, n);
    const h = hits.at(-1)!;
    expect(h.url).toBe("/message");
    expect(h.headers["x-gotify-key"]).toBe("GT");
    expect(JSON.parse(h.body)).toMatchObject({ title: "Disk full", priority: 5 });
  });

  it("ntfy publishes JSON with topic, priority, markdown and bearer token", async () => {
    await sendToTarget(r({ targetType: "ntfy", target: { ntfyUrl: base + "/", ntfyTopic: "alerts", ntfyPriority: 9 }, secrets: { ntfyToken: "tk_abc" } }), "", n);
    const h = hits.at(-1)!;
    expect(h.headers.authorization).toBe("Bearer tk_abc");
    expect(JSON.parse(h.body)).toEqual({ topic: "alerts", title: "Disk full", message: n.message, priority: 5, markdown: true });
  });

  it("ntfy supports basic auth and markdown off", async () => {
    await sendToTarget(r({ targetType: "ntfy", target: { ntfyUrl: base, ntfyTopic: "a", ntfyUsername: "bob", ntfyMarkdown: false }, secrets: { ntfyPassword: "pw" } }), "", n);
    const h = hits.at(-1)!;
    expect(h.headers.authorization).toBe("Basic " + Buffer.from("bob:pw").toString("base64"));
    expect(JSON.parse(h.body).markdown).toBe(false);
    expect(JSON.parse(h.body).priority).toBe(3);
  });

  it("pushover sends a form with token, user, priority and HTML", async () => {
    await sendToTarget(r({ targetType: "pushover", target: { pushoverApiUrl: base, pushoverPriority: 1 }, secrets: { pushoverToken: "APP", pushoverUser: "USR" } }), "", n);
    const h = hits.at(-1)!;
    expect(h.url).toBe("/1/messages.json");
    const f = new URLSearchParams(h.body);
    expect(Object.fromEntries(f)).toMatchObject({ token: "APP", user: "USR", title: "Disk full", priority: "1", html: "1", message: "Pool <b>tank</b> at 95%" });
  });

  it("apprise stateless sends urls; config key uses /notify/{key}", async () => {
    await sendToTarget(r({ targetType: "apprise", target: { appriseUrl: base }, secrets: { appriseUrls: "tgram://x/y" } }), "", n);
    expect(hits.at(-1)!.url).toBe("/notify/");
    expect(JSON.parse(hits.at(-1)!.body)).toEqual({ title: "Disk full", body: n.message, format: "markdown", urls: "tgram://x/y" });
    await sendToTarget(r({ targetType: "apprise", target: { appriseUrl: base, appriseConfigKey: "home" } }), "", n);
    expect(hits.at(-1)!.url).toBe("/notify/home");
    expect(JSON.parse(hits.at(-1)!.body).urls).toBeUndefined();
  });

  it("surfaces HTTP errors so retry can pick them up", async () => {
    await expect(sendToTarget(r({ targetType: "apprise", target: { appriseUrl: base + "/fail" }, secrets: { appriseUrls: "x://" } }), "", n)).rejects.toThrow(/Apprise returned HTTP 500/);
    await expect(sendToTarget(r({ targetType: "ntfy", target: { ntfyUrl: base, ntfyTopic: "fail-topic" } }), "", n)).rejects.toThrow(/ntfy/);
  });

  it("validates target settings", () => {
    expect(validateTarget("ntfy", { ntfyUrl: "ftp://x", ntfyTopic: "a" }, {})).toMatch(/URL/);
    expect(validateTarget("ntfy", { ntfyUrl: base, ntfyTopic: "bad topic" }, {})).toMatch(/topic/);
    expect(validateTarget("pushover", {}, { pushoverToken: "a" })).toMatch(/user key/);
    expect(validateTarget("apprise", { appriseUrl: base }, {})).toMatch(/either/);
    expect(validateTarget("apprise", { appriseUrl: base, appriseConfigKey: "k" }, { appriseUrls: "x" })).toMatch(/either/);
    expect(validateTarget("apprise", { appriseUrl: base, appriseConfigKey: "k" }, {})).toBeNull();
  });
});

describe("DB migration", () => {
  it("keeps routes created before target types existed as working Gotify routes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-mig-"));
    const key = Buffer.alloc(32, 7);
    const old = new Database(path.join(dir, "mailbeacon.db"));
    old.exec(`CREATE TABLE routes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, match_type TEXT NOT NULL,
      pattern TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 100, gotify_url TEXT,
      gotify_token TEXT NOT NULL, gotify_priority INTEGER NOT NULL DEFAULT 5, enabled INTEGER NOT NULL DEFAULT 1);`);
    old.prepare("INSERT INTO routes(name,match_type,pattern,gotify_token) VALUES('legacy','recipient','a@b',?)").run(encrypt("LEGACY", key));
    old.close();
    const s = new Store(dir, key);
    const [rt] = s.listRoutes();
    expect(rt).toMatchObject({ name: "legacy", targetType: "gotify", gotifyToken: "LEGACY", target: {}, secrets: {} });
    expect(s.db.pragma("user_version", { simple: true })).toBe(4);
    s.saveRoute({ ...rt, targetType: "pushover", secrets: { pushoverToken: "pt-plaintext-token-123", pushoverUser: "pu-plaintext-user-456" } });
    const raw = s.db.prepare("SELECT target_secret FROM routes").get() as { target_secret: string };
    expect(raw.target_secret).not.toContain("pt-plaintext-token-123");
    expect(raw.target_secret).not.toContain("pu-plaintext-user-456");
    expect(s.getRoute(rt.id)!.secrets).toEqual({ pushoverToken: "pt-plaintext-token-123", pushoverUser: "pu-plaintext-user-456" });
    s.close();
    new Store(dir, key).close(); // re-opening is a no-op
  });
});

describe("0.2.0 -> 0.3.0 migration", () => {
  it("turns the single admin password into user admin who owns everything", async () => {
    const { hashPassword } = await import("../src/crypto.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-mig3-"));
    const key = Buffer.alloc(32, 7);
    const s0 = new Store(dir, key);
    s0.db.exec("DELETE FROM users; DELETE FROM audit;");
    s0.db.exec("ALTER TABLE routes DROP COLUMN owner_id; ALTER TABLE messages DROP COLUMN owner_id;");
    s0.db.exec("DROP TABLE users;");
    s0.setSetting("admin_hash", hashPassword("legacypassword"));
    s0.db.prepare("INSERT INTO routes(name,match_type,pattern,gotify_token) VALUES('old','recipient','a@b',?)").run(encrypt("T", key));
    s0.db.pragma("user_version = 2");
    s0.close();
    const s = new Store(dir, key);
    expect(s.db.pragma("user_version", { simple: true })).toBe(4);
    const u = s.checkLogin("admin", "legacypassword")!;
    expect(u).toMatchObject({ username: "admin", role: "admin" });
    expect(s.checkLogin("admin", "wrong")).toBeUndefined();
    expect(s.listRoutes()[0].ownerId).toBe(u.id);
    expect(s.queryAudit().items.map((a) => a.action)).toContain("user.migrated");
    s.close();
  });
});
