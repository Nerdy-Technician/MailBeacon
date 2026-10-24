import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { start } from "../src/index.js";
import { Store } from "../src/db.js";
import { deliver, MAX_ATTEMPTS } from "../src/delivery.js";
import { DEFAULT_LIMITS, RateLimiter, readLimits, writeLimits } from "../src/limits.js";
import { previewRoute } from "../src/matcher.js";
import { counters, renderMetrics, resetCounters } from "../src/metrics.js";
import { looksLikeGotifyToken, runSelfTest } from "../src/selftest.js";
import { route } from "./helpers.js";

const tmpStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), "mb-f-")), Buffer.alloc(32, 7));

describe("rate limiter and limits", () => {
  it("allows up to the limit per key in a sliding minute", () => {
    let t = 0; const rl = new RateLimiter(60000, () => t);
    expect([1, 2, 3].map(() => rl.take("a", 2))).toEqual([true, true, false]);
    expect(rl.take("b", 2)).toBe(true);
    t = 60001; expect(rl.take("a", 2)).toBe(true);
    expect(rl.take("a", 0)).toBe(true); // 0 = no limit
  });
  it("stores validated limits and falls back to defaults", () => {
    const s = tmpStore();
    expect(readLimits(s)).toEqual(DEFAULT_LIMITS);
    expect(writeLimits(s, { maxRecipients: 5, messagesPerMinutePerIp: 0 })).toBeNull();
    expect(readLimits(s)).toMatchObject({ maxRecipients: 5, messagesPerMinutePerIp: 0 });
    expect(writeLimits(s, { maxConnections: -1 })).toMatch(/whole number/);
    expect(writeLimits(s, { maxConnections: 1.5, maxRecipients: 9 })).toMatch(/whole number/);
    expect(readLimits(s).maxRecipients).toBe(5); // nothing saved when any value is invalid
  });
});

describe("route preview", () => {
  const routes = [
    route({ name: "proxmox", matchType: "sender", pattern: "^proxmox@bjr-home\\.uk$", order: 10 }),
    route({ name: "off", matchType: "catchall", order: 15, enabled: false }),
    route({ name: "alerts", matchType: "recipient", pattern: "*@alerts.local", order: 20 }),
  ];
  it("names the winning route and marks later routes unchecked", () => {
    const p = previewRoute(routes, { sender: "proxmox@bjr-home.uk", recipients: ["x@alerts.local"], subject: "" });
    expect(p).toMatchObject({ accepted: true, route: { name: "proxmox" } });
    expect(p.trace.map((t) => t.note)).toEqual(["first match wins", "disabled", "not checked: an earlier route matched"]);
  });
  it("explains a 550 at RCPT TO, or after DATA when subject routes exist", () => {
    expect(previewRoute(routes, { sender: "a@b", recipients: ["v@gmail.com"], subject: "x" })).toMatchObject({ accepted: false, stage: "rcpt" });
    const withSubject = [...routes, route({ name: "subj", matchType: "subject", pattern: "^ALERT" })];
    expect(previewRoute(withSubject, { sender: "a@b", recipients: ["v@gmail.com"], subject: "hello" })).toMatchObject({ accepted: false, stage: "data" });
    expect(previewRoute(withSubject, { sender: "a@b", recipients: ["v@gmail.com"], subject: "ALERT disk" }).route?.name).toBe("subj");
  });
});

describe("metrics and self-test helpers", () => {
  it("renders Prometheus text with escaped labels", () => {
    resetCounters(); counters.received = 3; counters.rejected.set('we"ird', 2);
    const txt = renderMetrics({ queue: { delivered: 3, dead: 1 }, routes: 2, selfTestOk: null, dryRun: false, version: "1.2.3" });
    expect(txt).toContain("mailbeacon_messages_received_total 3");
    expect(txt).toContain('mailbeacon_smtp_rejected_total{reason="we\\"ird"} 2');
    expect(txt).toContain('mailbeacon_messages{status="dead"} 1');
    expect(txt).toContain("mailbeacon_selftest_ok -1");
    expect(txt).toMatch(/# TYPE mailbeacon_deliveries_total counter/);
  });
  it("recognises the shape of Gotify app tokens", () => {
    expect(looksLikeGotifyToken("AbCdEfGhIjKlMn0")).toBe(true);
    expect(looksLikeGotifyToken("")).toBe(false);
    expect(looksLikeGotifyToken("Bxxxxxxxxxxxxxx")).toBe(false);
    expect(looksLikeGotifyToken("Ashort")).toBe(false);
  });
  it("self-test checks Gotify /health and flags bad tokens, sending nothing", async () => {
    const hits: string[] = [];
    const srv = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.end('{"health":"green","database":"green"}'); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const s = tmpStore();
    s.setSetting("gotify_url", `http://127.0.0.1:${(srv.address() as { port: number }).port}`);
    s.saveRoute({ name: "good", matchType: "catchall", pattern: "", order: 1, gotifyUrl: null, gotifyToken: "AbCdEfGhIjKlMn0", gotifyPriority: 5, enabled: true });
    s.saveRoute({ name: "bad", matchType: "catchall", pattern: "", order: 2, gotifyUrl: null, gotifyToken: "oops", gotifyPriority: 5, enabled: true });
    s.saveRoute({ name: "down", matchType: "catchall", pattern: "", order: 3, gotifyUrl: "http://127.0.0.1:1", gotifyToken: "AbCdEfGhIjKlMn0", gotifyPriority: 5, enabled: true });
    const r = await runSelfTest(s, 2000);
    srv.close();
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'route "bad" token')?.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'route "good" token')?.ok).toBe(true);
    expect(r.checks.find((c) => c.name.endsWith(":1"))?.detail).toMatch(/unreachable/);
    expect(hits).toEqual(["GET /health"]); // never posts a message
  });
});

describe("retry queue and dead letters", () => {
  it("moves a message to dead letters after MAX_ATTEMPTS failures and records each attempt", async () => {
    const srv = http.createServer((_q, res) => { res.statusCode = 500; res.end(); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const s = tmpStore();
    const rid = s.saveRoute({ name: "r", matchType: "catchall", pattern: "", order: 1, gotifyUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, gotifyToken: "t", gotifyPriority: 5, enabled: true });
    const id = s.addMessage({ sender: "a@b", recipients: "c@d", subject: "s", routeId: rid, title: "s", body: "b", contentType: "text/plain" });
    for (let i = 0; i < MAX_ATTEMPTS; i++) await deliver(s, id);
    srv.close();
    expect(s.getMessage(id)).toMatchObject({ status: "dead", attempts: MAX_ATTEMPTS });
    expect(s.failedMessages(MAX_ATTEMPTS)).toHaveLength(0);
    const ev = s.messageEvents(id).map((e) => e.event);
    expect(ev.filter((e) => e === "failed")).toHaveLength(MAX_ATTEMPTS);
    expect(ev.at(-1)).toBe("dead");
    expect(s.requeueMessage(id)).toBe(true);
    expect(s.getMessage(id)).toMatchObject({ status: "failed", attempts: 0 });
  });
  it("migrates old failed messages that used every attempt to dead letters", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-mig-"));
    const s1 = new Store(dir, Buffer.alloc(32, 1));
    s1.db.prepare("INSERT INTO messages(received_at,status,attempts) VALUES('2026-01-01','failed',5),('2026-01-01','failed',2)").run();
    s1.db.pragma("user_version = 1"); s1.close();
    const s2 = new Store(dir, Buffer.alloc(32, 1));
    expect(s2.statusCounts()).toMatchObject({ dead: 1, failed: 1 });
    expect(s2.db.pragma("user_version", { simple: true })).toBe(4);
  });
});

describe("end to end: 0.2.0 features", () => {
  const received: string[] = [];
  let gotify: http.Server;
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 26250 + Math.floor(Math.random() * 500);
  const webPort = smtpPort + 1000;
  const web = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${webPort}${p}`, init);
  let cookie = "";
  const j = (method: string, body?: unknown) => ({ method, headers: { "X-MailBeacon": "1", cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const transport = (o: Record<string, unknown> = {}) => nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true, ...o });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    process.env.MAILBEACON_METRICS_TOKEN = "metrics-secret";
    gotify = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => { if (req.headers["x-gotify-key"] === "down") { res.statusCode = 500; return res.end(); } received.push(JSON.parse(b || "{}").title); res.end("{}"); });
    });
    await new Promise<void>((r) => gotify.listen(0, "127.0.0.1", () => r()));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-f-e2e-"));
    app = await start({ dataDir, smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 64 * 1024, smtpHostname: "test", secret: "f" });
    const r = await web("/api/setup", j("POST", { password: "longpassword" }));
    cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    await web("/api/settings", j("PUT", { gotifyUrl: `http://127.0.0.1:${(gotify.address() as { port: number }).port}` }));
    await web("/api/routes", j("POST", { name: "proxmox", matchType: "sender", pattern: "^proxmox@bjr-home\\.uk$", order: 10, gotifyToken: "AbCdEfGhIjKlMn0" }));
    await web("/api/routes", j("POST", { name: "alerts", matchType: "recipient", pattern: "*@alerts.local", order: 20, gotifyToken: "AbCdEfGhIjKlMn1" }));
  });
  afterAll(async () => { delete process.env.MAILBEACON_METRICS_TOKEN; await app.stop(); gotify.close(); });

  it("SMTP AUTH is off by default, and cannot be turned on without STARTTLS", async () => {
    const s = await (await web("/api/settings", j("GET"))).json();
    expect(s.smtpAuth).toBe(false);
    expect(s.limits).toEqual(DEFAULT_LIMITS);
    const r = await web("/api/settings", j("PUT", { smtpAuth: true }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/STARTTLS/);
    expect((await (await web("/api/settings", j("GET"))).json()).smtpAuth).toBe(false);
  });

  it("with AUTH on, refuses AUTH before STARTTLS (no plaintext credentials)", async () => {
    await web("/api/smtp-users", j("POST", { username: "pve", password: "s3cret" }));
    expect((await web("/api/settings", j("PUT", { smtpAuth: true, smtpStarttls: true }))).status).toBe(200);
    // raw session: EHLO, then AUTH PLAIN without STARTTLS
    const reply = await new Promise<string>((resolve) => {
      const sock = net.connect(smtpPort, "127.0.0.1"); let buf = ""; let step = 0;
      sock.on("data", (d) => {
        buf += d.toString();
        if (step === 0 && buf.includes("220 ")) { step = 1; buf = ""; sock.write("EHLO t\r\n"); }
        else if (step === 1 && /^250 /m.test(buf)) { step = 2; buf = ""; sock.write("AUTH PLAIN " + Buffer.from("\0pve\0s3cret").toString("base64") + "\r\n"); }
        else if (step === 2 && /\r\n$/.test(buf)) { step = 3; sock.end("QUIT\r\n"); resolve(buf); }
      });
    });
    expect(reply).toMatch(/^5\d\d /); // 538: must issue STARTTLS first
    const ok = transport({ ignoreTLS: false, requireTLS: true, tls: { rejectUnauthorized: false }, auth: { user: "pve", pass: "s3cret" } });
    await ok.sendMail({ from: "proxmox@bjr-home.uk", to: "root@x", subject: "authed over tls", text: "ok" });
    // turning STARTTLS off also requires AUTH off
    expect((await web("/api/settings", j("PUT", { smtpStarttls: false }))).status).toBe(400);
    expect((await web("/api/settings", j("PUT", { smtpAuth: false, smtpStarttls: false }))).status).toBe(200);
  });

  it("rejects unmatched mail with 550 and counts it in /metrics", async () => {
    const e = await transport().sendMail({ from: "spam@evil", to: "victim@gmail.com", subject: "x", text: "x" }).catch((x) => x);
    expect(e.responseCode).toBe(550);
    const m = await (await web("/metrics", { headers: { Authorization: "Bearer metrics-secret" } })).text();
    expect(m).toMatch(/mailbeacon_smtp_rejected_total\{reason="no_route"\} [1-9]/);
  });

  it("enforces the per-recipient and per-minute limits from Settings", async () => {
    expect((await web("/api/settings", j("PUT", { limits: { maxRecipients: 2 } }))).status).toBe(200);
    // the third RCPT TO gets 452; nodemailer still delivers to the first two and reports the rejection
    const many = await transport().sendMail({ from: "x@y", to: ["a@alerts.local", "b@alerts.local", "c@alerts.local"], subject: "m", text: "m" });
    expect(many.rejected).toEqual(["c@alerts.local"]);
    expect(String((many as unknown as { rejectedErrors: { response: string }[] }).rejectedErrors[0].response)).toMatch(/^452 /);
    expect((await web("/api/settings", j("PUT", { limits: { maxRecipients: "lots" } }))).status).toBe(400);
    await web("/api/settings", j("PUT", { limits: { maxRecipients: 20, messagesPerMinutePerIp: 2 } }));
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push(await transport().sendMail({ from: "x@y", to: "rl@alerts.local", subject: "rl" + i, text: "r" }).then(() => 250, (x) => x.responseCode));
    expect(codes.filter((c) => c === 450).length).toBeGreaterThanOrEqual(1);
    await web("/api/settings", j("PUT", { limits: { messagesPerMinutePerIp: 0 } }));
  });

  it("caps open connections per IP with 421", async () => {
    await web("/api/settings", j("PUT", { limits: { maxConnectionsPerIp: 1 } }));
    const first = net.connect(smtpPort, "127.0.0.1");
    await new Promise((r) => first.once("data", r));
    const second = await new Promise<string>((resolve) => { const s = net.connect(smtpPort, "127.0.0.1"); s.once("data", (d) => { resolve(d.toString()); s.destroy(); }); });
    first.destroy();
    expect(second).toMatch(/^421 /);
    await sleep(100);
    await web("/api/settings", j("PUT", { limits: { maxConnectionsPerIp: 10 } }));
  });

  it("history filters, pages and shows a per-message delivery log", async () => {
    await transport().sendMail({ from: "proxmox@bjr-home.uk", to: "root@bjr-home.uk", subject: "vzdump ok", text: "done" });
    await sleep(200);
    const r = await web("/api/messages?q=vzdump", j("GET"));
    expect(Number(r.headers.get("x-total-count"))).toBe(1);
    const [m] = await r.json();
    expect(m).toMatchObject({ sender: "proxmox@bjr-home.uk", status: "delivered" });
    const d = await (await web(`/api/messages/${m.id}`, j("GET"))).json();
    expect(d.routeName).toBe("proxmox");
    expect(d.events.map((e: { event: string }) => e.event)).toEqual(["received", "delivered"]);
    expect((await web("/api/messages?status=bogus", j("GET"))).status).toBe(400);
    const page = await web("/api/messages?limit=1&offset=1", j("GET"));
    expect((await page.json()).length).toBe(1);
    expect((await web("/api/messages/99999", j("GET"))).status).toBe(404);
  });

  it("lists, retries and discards dead letters", async () => {
    const { id: rid } = await (await web("/api/routes", j("POST", { name: "broken", matchType: "recipient", pattern: "broken@alerts.local", order: 5, gotifyToken: "down" }))).json();
    await transport().sendMail({ from: "x@y", to: "broken@alerts.local", subject: "will die", text: "x" });
    await sleep(200);
    const [m] = await (await web("/api/messages?q=will%20die", j("GET"))).json();
    for (let i = 1; i < MAX_ATTEMPTS; i++) await web(`/api/messages/${m.id}/retry`, j("POST"));
    const dead = await (await web("/api/dead-letters", j("GET"))).json();
    expect(dead.items.map((x: { id: number }) => x.id)).toContain(m.id);
    // retrying a dead letter gives it a fresh budget; it fails again and is back in the queue
    expect((await (await web(`/api/messages/${m.id}/retry`, j("POST"))).json()).ok).toBe(false);
    expect((await (await web(`/api/messages/${m.id}`, j("GET"))).json())).toMatchObject({ status: "failed", attempts: 1 });
    expect((await (await web("/api/dead-letters/retry", j("POST"))).json()).requeued).toBe(0);
    expect((await web(`/api/messages/${m.id}`, j("DELETE"))).status).toBe(200);
    expect((await web(`/api/messages/${m.id}`, j("GET"))).status).toBe(404);
    await web(`/api/routes/${rid}`, j("DELETE"));
  });

  it("test email goes through the real pipeline; preview sends nothing", async () => {
    const before = received.length;
    const p = await (await web("/api/routes/preview", j("POST", { from: "proxmox@bjr-home.uk", to: "root@x", subject: "s" }))).json();
    expect(p).toMatchObject({ accepted: true, route: { name: "proxmox" } });
    expect((await (await web("/api/routes/preview", j("POST", { from: "a@b", to: "v@gmail.com" }))).json()).stage).toBe("rcpt");
    expect((await web("/api/routes/preview", j("POST", { to: "not an address" }))).status).toBe(400);
    await sleep(100);
    expect(received.length).toBe(before);
    const t = await (await web("/api/test-email", j("POST", { from: "proxmox@bjr-home.uk", to: "root@x", subject: "UI test\r\nBcc: evil@x", body: "hi" }))).json();
    expect(t).toMatchObject({ ok: true, route: "proxmox", dryRun: false });
    await sleep(200);
    expect(received.at(-1)).toBe("UI test Bcc: evil@x"); // header injection flattened into the subject
    const miss = await web("/api/test-email", j("POST", { from: "a@b", to: "v@gmail.com" }));
    expect(miss.status).toBe(422);
  });

  it("protects /metrics with the token when set, and serves Swagger UI", async () => {
    expect((await web("/metrics")).status).toBe(401);
    expect((await web("/metrics", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await web("/metrics", { headers: { cookie } })).status).toBe(200);
    expect((await web("/docs/")).status).toBe(200);
    const spec = await (await web("/docs/json")).json();
    expect(spec.openapi).toBe("3.1.0");
    for (const p of ["/api/messages", "/api/dead-letters", "/api/test-email", "/api/routes/preview", "/api/selftest", "/metrics", "/api/settings"]) expect(spec.paths[p]).toBeDefined();
    expect(JSON.stringify(spec)).not.toMatch(/AbCdEf|metrics-secret|longpassword/);
  });

  it("self-test endpoint reports the Gotify check", async () => {
    const r = await (await web("/api/selftest", j("POST"))).json();
    expect(r.ok).toBe(true); // mock Gotify answers /health with 200 and both tokens are well-formed
    expect(r.checks.some((c: { name: string; ok: boolean }) => c.name.startsWith("Gotify http://127.0.0.1") && c.ok)).toBe(true);
  });
});

describe("dry-run mode", () => {
  it("routes and records mail but never calls the target", async () => {
    process.env.MAILBEACON_DRY_RUN = "1";
    const hits: string[] = [];
    const srv = http.createServer((req, res) => { hits.push(req.url ?? ""); res.end("{}"); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const s = tmpStore();
    const rid = s.saveRoute({ name: "r", matchType: "catchall", pattern: "", order: 1, gotifyUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, gotifyToken: "t", gotifyPriority: 5, enabled: true });
    const id = s.addMessage({ sender: "a@b", recipients: "c@d", subject: "s", routeId: rid, title: "s", body: "b", contentType: "text/plain" });
    expect(await deliver(s, id)).toBe(true);
    delete process.env.MAILBEACON_DRY_RUN;
    srv.close();
    expect(hits).toEqual([]);
    expect(s.getMessage(id)?.status).toBe("delivered");
    expect(s.messageEvents(id)[0]).toMatchObject({ event: "dry-run" });
  });
});
