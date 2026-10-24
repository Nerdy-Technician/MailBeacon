import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { start } from "../src/index.js";
import { AVATAR_MAX_BYTES } from "../src/web.js";

describe("first-run wizard lock and 5 MB avatars", () => {
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 29250 + Math.floor(Math.random() * 400);
  const webPort = smtpPort + 1000;
  const base = `http://127.0.0.1:${webPort}`;
  const cookies: Record<string, string> = {};
  const req = async (who: string, method: string, p: string, body?: unknown, extra: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method, redirect: "manual",
      headers: { "X-MailBeacon": "1", cookie: cookies[who] ?? "", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
    let j: any; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, headers: r.headers };
  };
  const upload = (type: string, body: Buffer) => fetch(base + "/api/me/avatar", { method: "POST", headers: { "X-MailBeacon": "1", cookie: cookies.admin!, "Content-Type": type }, body: new Uint8Array(body) });

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-setup-"));
    app = await start({ dataDir, smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 1024 * 1024, smtpHostname: "test", secret: "setup" });
  });
  afterAll(async () => { await app.stop(); });

  describe("setup lock (security)", () => {
    it("reports a fresh install as needing setup", async () => {
      const s = await req("", "GET", "/api/status");
      expect(s.body).toMatchObject({ setupDone: false, needsSetup: true, wizardDone: false, authed: false });
    });
    it("refuses setup without the CSRF header", async () => {
      const r = await fetch(base + "/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "evil", password: "evilpassword" }) });
      expect(r.status).toBe(403);
      expect((await req("", "GET", "/api/status")).body.needsSetup).toBe(true);
    });
    it("creates the first admin once and starts a session", async () => {
      const r = await req("", "POST", "/api/setup", { username: "admin", password: "adminpassword" });
      expect(r.status).toBe(200);
      cookies.admin = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
      const s = await req("admin", "GET", "/api/status");
      expect(s.body).toMatchObject({ setupDone: true, needsSetup: false, authed: true });
    });
    it("locks /api/setup for good: anonymous, second attempt, and even as admin", async () => {
      expect((await req("", "POST", "/api/setup", { username: "evil", password: "evilpassword" })).status).toBe(409);
      expect((await req("", "POST", "/api/setup", { username: "admin", password: "overwrittenpw" })).status).toBe(409);
      expect((await req("admin", "POST", "/api/setup", { username: "evil2", password: "evilpassword" })).status).toBe(409);
      const users = (await req("admin", "GET", "/api/users")).body as { username: string }[];
      expect(users.map((u) => u.username)).toEqual(["admin"]);
      // the original password still works, the "overwrite" didn't take
      expect((await req("", "POST", "/api/login", { username: "admin", password: "adminpassword" })).status).toBe(200);
      expect((await req("", "POST", "/api/login", { username: "admin", password: "overwrittenpw" })).status).toBe(401);
    });
    it("stays locked when the only users are non-admins", async () => {
      // demote path: create an editor, the lock must not depend only on an admin existing
      expect((await req("admin", "POST", "/api/users", { username: "ed", role: "editor", password: "editorpass" })).status).toBe(200);
      expect((await req("admin", "POST", "/api/users", { username: "vi", role: "viewer", password: "viewerpass" })).status).toBe(200);
      for (const u of ["ed", "vi"]) {
        const r = await req("", "POST", "/api/login", { username: u, password: u === "ed" ? "editorpass" : "viewerpass" });
        cookies[u] = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
      }
      expect((await req("ed", "POST", "/api/setup", { username: "x", password: "xxxxxxxxxx" })).status).toBe(409);
    });
    it("only lets an admin mark the wizard finished", async () => {
      expect((await req("", "POST", "/api/setup/complete", {})).status).toBe(401);
      expect((await req("ed", "POST", "/api/setup/complete", {})).status).toBe(403);
      expect((await req("vi", "POST", "/api/setup/complete", {})).status).toBe(403);
      const key = await req("ed", "POST", "/api/keys", { name: "k", scopes: ["routes:read", "routes:write"] });
      expect(key.status).toBe(200);
      const r = await fetch(base + "/api/setup/complete", { method: "POST", headers: { Authorization: `Bearer ${key.body.key}`, "Content-Type": "application/json" }, body: "{}" });
      expect(r.status).toBe(403);
      expect((await req("", "GET", "/api/status")).body.wizardDone).toBe(false);
      expect((await req("admin", "POST", "/api/setup/complete", { skipped: ["oidc"] })).status).toBe(200);
      expect((await req("", "GET", "/api/status")).body.wizardDone).toBe(true);
      const audit = await req("admin", "GET", "/api/audit");
      expect(JSON.stringify(audit.body)).toContain("setup.wizard.completed");
    });
  });

  it("serves the wizard script and bundled service icons locally", async () => {
    expect((await fetch(base + "/wizard.js")).status).toBe(200);
    for (const n of ["gotify", "ntfy", "pushover", "discord", "slack", "telegram", "apprise", "webhook"]) {
      const r = await fetch(base + `/icons/${n}.svg`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("image/svg+xml");
    }
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("/wizard.js");
    expect(html).not.toMatch(/cdn\.jsdelivr|selfh\.st\/icons/);
  });

  describe("settings test buttons", () => {
    it("checks the SMTP listener without sending mail (admin only)", async () => {
      expect((await req("ed", "POST", "/api/smtp/test", {})).status).toBe(403);
      const r = await req("admin", "POST", "/api/smtp/test", {});
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, starttls: false, auth: false });
      expect(r.body.banner).toBeTruthy();
    });
    it("checks an OIDC discovery document (admin only)", async () => {
      const http = await import("node:http");
      let port = 0;
      const srv = http.createServer((q, res) => {
        res.setHeader("Content-Type", "application/json");
        const iss = `http://127.0.0.1:${port}/good`;
        if (q.url === "/good/.well-known/openid-configuration") return res.end(JSON.stringify({ issuer: iss, authorization_endpoint: iss + "/a", token_endpoint: iss + "/t", jwks_uri: iss + "/j" }));
        if (q.url === "/bad/.well-known/openid-configuration") return res.end(JSON.stringify({ issuer: "https://elsewhere" }));
        res.statusCode = 404; res.end("{}");
      });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
      port = (srv.address() as { port: number }).port;
      try {
        expect((await req("ed", "POST", "/api/oidc/test", { issuer: `http://127.0.0.1:${port}/good` })).status).toBe(403);
        // private issuers are refused unless allowed
        const refused = (await req("admin", "POST", "/api/oidc/test", { issuer: `http://127.0.0.1:${port}/good` }));
        expect(refused.status).toBe(400);
        expect(refused.body.error).toMatch(/https/);
        expect((await req("admin", "POST", "/api/oidc/test", { issuer: `https://127.0.0.1:${port}/good` })).body.error).toMatch(/private or local/);
        expect((await req("admin", "PUT", "/api/settings", { oidcAllowPrivate: true })).status).toBe(200);
        expect((await req("admin", "POST", "/api/oidc/test", { issuer: `http://127.0.0.1:${port}/good` })).body).toMatchObject({ ok: true, issuerMatches: true });
        const bad = (await req("admin", "POST", "/api/oidc/test", { issuer: `http://127.0.0.1:${port}/bad` })).body;
        expect(bad.ok).toBe(false); expect(bad.missing).toContain("token_endpoint");
        expect((await req("admin", "POST", "/api/oidc/test", { issuer: `http://127.0.0.1:${port}/none` })).body.ok).toBe(false);
        expect((await req("admin", "POST", "/api/oidc/test", { issuer: "file:///etc/passwd" })).status).toBe(400);
      } finally { srv.close(); }
    });
  });

  describe("profile pictures up to 5 MB", () => {
    it("accepts a ~4.5 MB photo and stores a 256px WebP", async () => {
      // random noise doesn't compress, so this PNG really is several MB
      const w = 1300, h = 1200;
      const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
      const big = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
      expect(big.length).toBeGreaterThan(4 * 1024 * 1024);
      expect(big.length).toBeLessThanOrEqual(AVATAR_MAX_BYTES);
      const r = await upload("image/png", big);
      expect(r.status).toBe(200);
      const me = await r.json();
      const img = await fetch(base + me.avatar.url, { headers: { cookie: cookies.admin! } });
      expect(img.headers.get("content-type")).toBe("image/webp");
      const buf = Buffer.from(await img.arrayBuffer());
      const meta = await sharp(buf).metadata();
      expect(meta).toMatchObject({ format: "webp", width: 256, height: 256 });
      expect(meta.exif).toBeUndefined();
      expect(buf.length).toBeLessThan(200 * 1024);
      const etag = img.headers.get("etag")!;
      expect(etag).toBeTruthy();
      expect((await fetch(base + me.avatar.url, { headers: { cookie: cookies.admin!, "If-None-Match": etag } })).status).toBe(304);
    });
    it("refuses files over 5 MB with 413", async () => {
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer();
      const r = await upload("image/png", Buffer.concat([png, Buffer.alloc(AVATAR_MAX_BYTES)]));
      expect(r.status).toBe(413);
    });
    it("refuses a type mismatch, SVG and undecodable data", async () => {
      const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer();
      expect((await upload("image/png", jpg)).status).toBe(415);
      expect((await upload("image/svg+xml", Buffer.from("<svg onload=alert(1)/>"))).status).toBe(415);
      expect((await upload("image/png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048)]))).status).toBe(422);
    });
    it("refuses decompression bombs", async () => {
      const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
      expect(bomb.length).toBeLessThan(AVATAR_MAX_BYTES);
      expect((await upload("image/png", bomb)).status).toBe(422);
    });
    it("flattens animated GIFs to a still and crops wide images square", async () => {
      const gif = await sharp({ create: { width: 600, height: 200, channels: 3, background: "#0a0" } }).gif().toBuffer();
      const r = await upload("image/gif", gif);
      expect(r.status).toBe(200);
      const img = Buffer.from(await (await fetch(base + (await r.json()).avatar.url, { headers: { cookie: cookies.admin! } })).arrayBuffer());
      const meta = await sharp(img).metadata();
      expect(meta).toMatchObject({ width: 256, height: 256, format: "webp" });
      expect(meta.pages ?? 1).toBe(1);
    });
  });
});
