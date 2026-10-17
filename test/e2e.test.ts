import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { start } from "../src/index.js";

interface Got { token: string; body: { title: string; message: string; priority: number; extras: Record<string, { contentType: string }> } }

describe("end to end: SMTP -> Gotify", () => {
  const received: Got[] = [];
  let gotify: http.Server;
  let gotifyUrl = "";
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 25250 + Math.floor(Math.random() * 500);
  const webPort = smtpPort + 1000;
  const web = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${webPort}${p}`, init);
  let cookie = "";

  beforeAll(async () => {
    gotify = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => {
        const token = String(req.headers["x-gotify-key"]);
        if (token === "down") { res.statusCode = 500; return res.end(); }
        received.push({ token, body: JSON.parse(b) }); res.end("{}");
      });
    });
    await new Promise<void>((r) => gotify.listen(0, "127.0.0.1", () => r()));
    gotifyUrl = `http://127.0.0.1:${(gotify.address() as { port: number }).port}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-e2e-"));
    app = await start({ dataDir, smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 64 * 1024, smtpHostname: "test", secret: "e2e" });
  });
  afterAll(async () => { await app.stop(); gotify.close(); });

  const j = (method: string, body?: unknown) => ({
    method, headers: { "X-MailBeacon": "1", cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });

  it("reports health and the package version", async () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(await (await web("/api/health")).json()).toEqual({ ok: true, version: pkg.version });
  });

  it("requires first-run setup and protects the API", async () => {
    expect((await web("/api/routes")).status).toBe(401);
    expect((await web("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"password":"longpassword"}' })).status).toBe(403);
    const r = await web("/api/setup", j("POST", { password: "longpassword" }));
    expect(r.status).toBe(200);
    cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    expect((await web("/api/setup", j("POST", { password: "another1234" }))).status).toBe(409);
  });

  it("configures routes via the API without leaking tokens", async () => {
    expect((await web("/api/settings", j("PUT", { gotifyUrl }))).status).toBe(200);
    expect((await web("/api/routes", j("POST", { name: "proxmox", matchType: "recipient", pattern: "proxmox@alerts.local", order: 10, gotifyToken: "TOKEN_A", gotifyPriority: 8 }))).status).toBe(200);
    expect((await web("/api/routes", j("POST", { name: "backups", matchType: "recipient", pattern: "backups@alerts.local", order: 20, gotifyToken: "TOKEN_B" }))).status).toBe(200);
    const list = await (await web("/api/routes", j("GET"))).json();
    expect(JSON.stringify(list)).not.toContain("TOKEN_A");
  });

  const transport = () => nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true });
  const waitFor = async (n: number) => { for (let i = 0; i < 50 && received.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };

  it("delivers a text mail to the right token", async () => {
    await transport().sendMail({ from: "pve@host", to: "proxmox@alerts.local", subject: "Backup done", text: "All good" });
    await waitFor(1);
    expect(received[0]).toMatchObject({ token: "TOKEN_A", body: { title: "Backup done", message: "All good", priority: 8 } });
  });

  it("converts HTML-only mail to markdown", async () => {
    await transport().sendMail({ from: "x@y", to: "backups@alerts.local", subject: "Report", html: "<p>Status <b>FAILED</b></p>" });
    await waitFor(2);
    expect(received[1].token).toBe("TOKEN_B");
    expect(received[1].body.message).toBe("Status **FAILED**");
    expect(received[1].body.extras["client::display"].contentType).toBe("text/markdown");
  });

  it("rejects unmatched recipients with 550 (no open relay)", async () => {
    const e = await transport().sendMail({ from: "x@y", to: "victim@gmail.com", subject: "spam", text: "x" }).catch((err) => err);
    expect(e).toBeInstanceOf(Error);
    expect(e.responseCode).toBe(550);
  });

  it("enforces the size limit", async () => {
    const e = await transport().sendMail({ from: "x@y", to: "proxmox@alerts.local", subject: "big", text: "a".repeat(200 * 1024) }).catch((err) => err);
    expect(e).toBeInstanceOf(Error);
    expect(e.responseCode).toBe(552);
  });

  it("records failures and retries them", async () => {
    await web("/api/routes", j("POST", { name: "broken", matchType: "recipient", pattern: "broken@alerts.local", gotifyToken: "down" }));
    await transport().sendMail({ from: "x@y", to: "broken@alerts.local", subject: "t", text: "t" });
    await new Promise((r) => setTimeout(r, 300));
    const msgs = await (await web("/api/messages", j("GET"))).json();
    const m = msgs.find((x: { subject: string }) => x.subject === "t");
    expect(m.status).toBe("failed");
    const retry = await (await web(`/api/messages/${m.id}/retry`, j("POST"))).json();
    expect(retry.ok).toBe(false);
    const again = (await (await web("/api/messages", j("GET"))).json()).find((x: { id: number }) => x.id === m.id);
    expect(again.attempts).toBe(2);
  });

  it("send-test button hits Gotify", async () => {
    const routes = await (await web("/api/routes", j("GET"))).json();
    const before = received.length;
    expect((await web(`/api/routes/${routes[0].id}/test`, j("POST"))).status).toBe(200);
    expect(received.length).toBe(before + 1);
  });

  it("pattern-test endpoint dry-runs patterns without saving", async () => {
    const t = async (body: unknown) => { const r = await web("/api/routes/match-test", j("POST", body)); return { status: r.status, body: await r.json() }; };
    expect((await t({ matchType: "recipient", pattern: "*@alerts.local", sample: "proxmox@alerts.local" })).body).toEqual({ valid: true, matches: true });
    expect((await t({ matchType: "recipient", pattern: "*@alerts.local", sample: "x@other.local" })).body.matches).toBe(false);
    expect((await t({ matchType: "sender", pattern: "^proxmox@", sample: "proxmox@bjr-home.uk" })).body.matches).toBe(true);
    expect((await t({ matchType: "subject", pattern: "(", sample: "x" })).body).toMatchObject({ valid: false, matches: false });
    expect((await t({ matchType: "catchall", sample: "anything" })).body.matches).toBe(true);
    expect((await t({ matchType: "bogus", pattern: "x", sample: "x" })).status).toBe(400);
    expect((await t({ matchType: "sender", pattern: "x" })).status).toBe(400);
    expect((await web("/api/routes/match-test", { method: "POST", headers: { "X-MailBeacon": "1", "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
  });

  it("toggles, reorders and reports last delivery per route", async () => {
    const list = async () => (await (await web("/api/routes", j("GET"))).json()) as { id: number; name: string; order: number; enabled: boolean; lastDelivery: { status: string } | null }[];
    const before = await list();
    const proxmox = before.find((r) => r.name === "proxmox")!;
    expect(proxmox.lastDelivery?.status).toBe("delivered");
    expect((await web(`/api/routes/${proxmox.id}`, j("PATCH", { enabled: false }))).status).toBe(200);
    expect((await list()).find((r) => r.id === proxmox.id)!.enabled).toBe(false);
    expect((await web(`/api/routes/${proxmox.id}`, j("PATCH", { enabled: "no" }))).status).toBe(400);
    expect((await web(`/api/routes/99999`, j("PATCH", { enabled: true }))).status).toBe(404);
    await web(`/api/routes/${proxmox.id}`, j("PATCH", { enabled: true }));
    const ids = before.map((r) => r.id).reverse();
    expect((await web("/api/routes/reorder", j("POST", { ids }))).status).toBe(200);
    expect((await list()).map((r) => r.id)).toEqual(ids);
    expect((await web("/api/routes/reorder", j("POST", { ids: ["a"] }))).status).toBe(400);
    await web("/api/routes/reorder", j("POST", { ids: before.map((r) => r.id) }));
  });

  it("requires AUTH when enabled", async () => {
    await web("/api/smtp-users", j("POST", { username: "pve", password: "s3cret" }));
    await web("/api/settings", j("PUT", { smtpAuth: true, smtpStarttls: true }));
    const noAuth = await transport().sendMail({ from: "x@y", to: "proxmox@alerts.local", subject: "a", text: "a" }).catch((e) => e);
    expect(noAuth).toBeInstanceOf(Error);
    const t = nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, requireTLS: true, tls: { rejectUnauthorized: false }, auth: { user: "pve", pass: "s3cret" } });
    const before = received.length;
    await t.sendMail({ from: "x@y", to: "proxmox@alerts.local", subject: "authed", text: "ok" });
    await waitFor(before + 1);
    expect(received.at(-1)?.body.title).toBe("authed");
    const bad = nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, tls: { rejectUnauthorized: false }, auth: { user: "pve", pass: "wrong" } });
    expect(await bad.sendMail({ from: "x@y", to: "proxmox@alerts.local", subject: "a", text: "a" }).catch((e) => e.responseCode)).toBe(535);
  });
});
