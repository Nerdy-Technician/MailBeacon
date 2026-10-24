import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { start } from "../src/index.js";
import { Store } from "../src/db.js";
import { csvCell } from "../src/insights.js";
import { createHealthz, probeUrl } from "../src/healthz.js";

describe("CSV cells (unit)", () => {
  it("neutralises spreadsheet formulas and quotes everything", () => {
    for (const v of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\t=x", "\r=x", "  =HYPERLINK(\"x\")", "＝1", "＠x"]) expect(csvCell(v).startsWith("\"'")).toBe(true);
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
  });
});

describe("/healthz probes (unit)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-hz-"));
  const store = new Store(dir, crypto.randomBytes(32));
  store.saveDestination({ name: "Secret NAS hook", type: "webhook", config: { webhookUrl: "http://nas.internal.lan:9000/hook?token=abc" }, secrets: {}, enabled: true, ownerId: null } as never);
  afterAll(() => store.close());
  it("probes only the origin, never the path or query", () => {
    expect(probeUrl("webhook", { webhookUrl: "http://nas.internal.lan:9000/hook?token=abc" }, "")).toBe("http://nas.internal.lan:9000");
    expect(probeUrl("ntfy", { ntfyUrl: "https://ntfy.example/" }, "")).toBe("https://ntfy.example/v1/health");
  });
  it("caches results and shares one probe between concurrent callers", async () => {
    const seen: string[] = []; let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetcher = async (u: string) => { seen.push(u); await gate; return new Response(null, { status: 404 }); };
    const hz = createHealthz(store, () => true, { ttlMs: 60000, fetcher, probe: true });
    const a = hz.check({}), b = hz.check({}), c = hz.check({});
    release();
    const [ra] = await Promise.all([a, b, c]);
    expect(hz.probeCount()).toBe(1);
    expect(ra.ok).toBe(true); // any HTTP answer = reachable
    for (let i = 0; i < 20; i++) await hz.check({});
    expect(hz.probeCount()).toBe(1);
    expect(seen).toEqual(["http://nas.internal.lan:9000"]);
  });
  it("is unhealthy when a destination is down, or SMTP isn't listening; core skips destinations", async () => {
    const down = createHealthz(store, () => true, { fetcher: async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }); }, probe: true });
    const r = await down.check({});
    expect(r.ok).toBe(false);
    expect(r.body.checks.destinations).toMatchObject({ total: 1, unreachable: 1 });
    expect(JSON.stringify(r.body)).not.toMatch(/nas|Secret|9000|token/);
    expect((await down.check({ detailed: true })).body.checks.destinations?.items?.[0]).toMatchObject({ name: "Secret NAS hook", ok: false, detail: "ECONNREFUSED" });
    expect((await down.check({ core: true })).ok).toBe(true);
    const noSmtp = createHealthz(store, () => false, { probe: false });
    const s = await noSmtp.check({ core: true });
    expect(s.ok).toBe(false);
    expect(s.body.checks.smtp.ok).toBe(false);
  });
  it("doesn't probe when probes are off", async () => {
    const hz = createHealthz(store, () => true, { probe: false, fetcher: async () => { throw new Error("must not be called"); } });
    const r = await hz.check({});
    expect(r.ok).toBe(true);
    expect(r.body.checks.destinations).toMatchObject({ skipped: 1, reachable: 0 });
    expect(hz.probeCount()).toBe(0);
  });
});

describe("0.3.0 batch 4: history filters, CSV, stats, retention, PWA, /healthz", () => {
  const hits: string[] = [];
  const mock = http.createServer((req, res) => { req.resume(); req.on("end", () => { hits.push(req.url!); res.end("{}"); }); });
  let M = "";
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 31250 + Math.floor(Math.random() * 500);
  const webPort = smtpPort + 1000;
  const base = `http://127.0.0.1:${webPort}`;
  const cookies: Record<string, string> = {};
  const as = (who: string, method: string, body?: unknown) => ({ method, redirect: "manual" as const,
    headers: { "X-MailBeacon": "1", cookie: cookies[who] ?? "", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper returns loose JSON
  const call = async (who: string, method: string, p: string, body?: unknown): Promise<{ status: number; body: any; text: string; headers: Headers }> => {
    const r = await fetch(base + p, as(who, method, body)); const text = await r.text(); let j: unknown; try { j = JSON.parse(text); } catch { j = text; }
    return { status: r.status, body: j, text, headers: r.headers };
  };
  const send = (from: string, subject: string, to = "x@alerts.local") => nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true }).sendMail({ from, to, subject, text: "body" });
  const waitFor = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); };
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", () => r()));
    M = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
    app = await start({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "mb-b4-")), smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 2 * 1024 * 1024, smtpHostname: "test", secret: "b4" });
    const r = await fetch(base + "/api/setup", as("", "POST", { username: "root", password: "rootpassword" }));
    cookies.root = (r.headers.get("set-cookie") ?? "").split(";")[0];
    for (const [u, role] of [["ed", "editor"], ["ed2", "editor"], ["vi", "viewer"]]) {
      expect((await call("root", "POST", "/api/users", { username: u, role, password: u + "password" })).status).toBe(200);
      const l = await fetch(base + "/api/login", as("", "POST", { username: u, password: u + "password" }));
      cookies[u] = (l.headers.get("set-cookie") ?? "").split(";")[0];
    }
    ids.d1 = (await call("ed", "POST", "/api/destinations", { name: "Ops hook", type: "webhook", config: { webhookUrl: `${M}/ops` }, secrets: {} })).body.id;
    ids.d2 = (await call("ed2", "POST", "/api/destinations", { name: "Other team", type: "webhook", config: { webhookUrl: `${M}/other` }, secrets: {} })).body.id;
    ids.r1 = (await call("ed", "POST", "/api/routes", { name: "Backups", matchType: "subject", pattern: "backup", targetType: "none", options: { destinationIds: [ids.d1] } })).body.id;
    ids.r2 = (await call("ed2", "POST", "/api/routes", { name: "Team2", matchType: "subject", pattern: "team2", targetType: "none", options: { destinationIds: [ids.d2] } })).body.id;
    await send("pve@lab", "backup ok");
    await send("pve@lab", "backup again");
    await send("=cmd|' /C calc'!A0@evil", "=HYPERLINK(\"http://x\") backup");
    await send("t2@lab", "team2 thing");
    await waitFor(() => hits.length >= 4);
  });
  afterAll(async () => { await app.stop(); mock.close(); });

  it("filters history by sender, route, destination, status and dates", async () => {
    expect((await call("root", "GET", "/api/messages?sender=pve@")).body).toHaveLength(2);
    expect((await call("root", "GET", `/api/messages?routeId=${ids.r1}`)).body).toHaveLength(3);
    expect((await call("root", "GET", `/api/messages?destination=dest:${ids.d2}`)).body).toHaveLength(1);
    expect((await call("root", "GET", "/api/messages?status=delivered")).headers.get("x-total-count")).toBe("4");
    const today = new Date().toISOString().slice(0, 10);
    expect((await call("root", "GET", `/api/messages?from=${today}&to=${today}`)).body).toHaveLength(4);
    expect((await call("root", "GET", "/api/messages?to=2000-01-01")).body).toHaveLength(0);
    expect((await call("root", "GET", "/api/messages?from=yesterday-ish")).status).toBe(400);
    expect((await call("root", "GET", "/api/messages?destination=evil")).status).toBe(400);
    expect((await call("root", "GET", "/api/messages?sender=%25")).body).toHaveLength(0); // LIKE wildcards are literal
  });

  it("scopes filters to what the user may see", async () => {
    expect((await call("ed", "GET", `/api/messages?destination=dest:${ids.d2}`)).status).toBe(400);
    expect((await call("ed", "GET", `/api/messages?routeId=${ids.r2}`)).status).toBe(400);
    const f = await call("ed", "GET", "/api/messages/filters");
    expect(f.body.destinations.map((d: { name: string }) => d.name)).toEqual(["Ops hook"]);
    expect(f.body.routes.map((r: { name: string }) => r.name)).not.toContain("Team2");
    expect((await call("ed", "GET", "/api/messages")).body).toHaveLength(3);
  });

  it("exports CSV with formula injection neutralised, and audits it", async () => {
    const r = await call("ed", "GET", `/api/messages/export.csv?routeId=${ids.r1}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.headers.get("content-disposition")).toMatch(/attachment/);
    const lines = r.text.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toMatch(/^"id","received_at","status","sender"/);
    expect(lines).toHaveLength(4);
    expect(r.text).not.toMatch(/(^|,)"[=+\-@]/m);
    expect(r.text).toContain(`"'=HYPERLINK`);
    expect(r.text).not.toContain("team2");
    const a = await call("root", "GET", "/api/audit?action=messages.exported");
    expect(JSON.stringify(a.body)).toContain("3 of 3");
    expect((await call("", "GET", "/api/messages/export.csv")).status).toBe(401);
  });

  it("reports real stats, scoped per user", async () => {
    const s = await call("root", "GET", "/api/stats/report?days=7");
    expect(s.status).toBe(200);
    expect(s.body.days).toHaveLength(7);
    expect(s.body.totals).toMatchObject({ total: 4, delivered: 4, failureRate: 0 });
    expect(s.body.routes.find((x: { name: string }) => x.name === "Backups")).toMatchObject({ total: 3, failed: 0 });
    expect(s.body.destinations.find((x: { name: string }) => x.name === "Ops hook").total).toBe(3);
    expect(s.body.topSenders[0]).toMatchObject({ sender: "pve@lab", total: 2 });
    const e = await call("ed", "GET", "/api/stats/report?days=30");
    expect(e.body.totals.total).toBe(3);
    expect(JSON.stringify(e.body)).not.toMatch(/Team2|Other team|t2@lab/);
    expect((await call("ed", "GET", "/api/stats/report?days=12")).status).toBe(400);
  });

  it("validates and saves retention (admin only, audited)", async () => {
    expect((await call("root", "GET", "/api/retention")).body).toMatchObject({ historyDays: 0, attachmentDays: 30 });
    expect((await call("ed", "PUT", "/api/retention", { historyDays: 5 })).status).toBe(403);
    expect((await call("root", "PUT", "/api/retention", { historyDays: -1 })).status).toBe(400);
    expect((await call("root", "PUT", "/api/retention", { historyDays: 1.5 })).status).toBe(400);
    expect((await call("root", "PUT", "/api/retention", { historyDays: 99999 })).status).toBe(400);
    expect((await call("root", "PUT", "/api/retention", { historyDays: 0, attachmentDays: 30 })).status).toBe(200);
    expect(JSON.stringify((await call("root", "GET", "/api/audit?action=retention.updated")).body)).toContain("forever");
  });

  it("purges only after a confirm, only finished mail, admin only", async () => {
    const db = app.store.db;
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    db.prepare("UPDATE messages SET received_at=?").run(old);
    const held = app.store.addMessage({ sender: "h@lab", recipients: "x", subject: "held one", routeId: null, title: "t", body: "b", contentType: "text/plain", ownerId: null, priority: null, status: "held" } as never);
    const pend = app.store.addMessage({ sender: "p@lab", recipients: "x", subject: "pending one", routeId: null, title: "t", body: "b", contentType: "text/plain", ownerId: null, priority: null } as never);
    db.prepare("UPDATE messages SET received_at=? WHERE id IN (?,?)").run(old, held, pend);
    expect((await call("ed", "POST", "/api/retention/purge", { olderThanDays: 30, what: "history" })).status).toBe(403);
    const dry = await call("root", "POST", "/api/retention/purge", { olderThanDays: 30, what: "history" });
    expect(dry.body).toMatchObject({ dryRun: true, messages: 4 });
    expect((await call("root", "GET", "/api/messages")).body).toHaveLength(6);
    expect((await call("root", "POST", "/api/retention/purge", { olderThanDays: 30, what: "history", dryRun: false })).status).toBe(400);
    const done = await call("root", "POST", "/api/retention/purge", { olderThanDays: 30, what: "history", dryRun: false, confirm: true });
    expect(done.body).toMatchObject({ dryRun: false, messages: 4 });
    const left = (await call("root", "GET", "/api/messages")).body.map((m: { subject: string }) => m.subject).sort();
    expect(left).toEqual(["held one", "pending one"]);
    expect(JSON.stringify((await call("root", "GET", "/api/audit?action=retention.purged")).body)).toContain("4 messages");
    expect((await call("root", "POST", "/api/retention/purge", { olderThanDays: 30, what: "everything", dryRun: false, confirm: true })).status).toBe(400);
  });

  it("applies retention automatically", async () => {
    const { applyRetention } = await import("../src/insights.js");
    app.store.db.prepare("UPDATE messages SET status='delivered'").run();
    expect((await call("root", "PUT", "/api/retention", { historyDays: 10, attachmentDays: 0 })).status).toBe(200);
    applyRetention(app.store);
    expect((await call("root", "GET", "/api/messages")).body).toHaveLength(0);
    expect(JSON.stringify((await call("root", "GET", "/api/audit?action=retention.applied")).body)).toContain("2");
    await call("root", "PUT", "/api/retention", { historyDays: 0, attachmentDays: 30 });
  });

  it("serves an installable manifest, icons and a shell-only service worker", async () => {
    const m = await call("", "GET", "/manifest.webmanifest");
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ display: "standalone", start_url: "/" });
    expect(m.body.icons.some((i: { sizes: string; purpose: string }) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
    for (const n of [192, 512]) {
      const r = await fetch(`${base}/pwa-icon-${n}.png`);
      expect(r.headers.get("content-type")).toBe("image/png");
      const b = Buffer.from(await r.arrayBuffer());
      expect(b.readUInt32BE(16)).toBe(n);
    }
    const sw = await call("", "GET", "/sw.js");
    expect(sw.headers.get("content-type")).toMatch(/javascript/);
    expect(sw.text).toMatch(/\/api/);
    expect(sw.text).toContain("/healthz");
    expect(sw.text).not.toMatch(/pushManager|addEventListener\(["']push/);
    const html = await call("", "GET", "/");
    expect(html.text).toContain('rel="manifest" href="/manifest.webmanifest"');
  });

  it("/healthz: no auth, no names for anonymous callers, details for admins; /api/health still works", async () => {
    const a = await call("", "GET", "/healthz");
    expect(a.status).toBe(200);
    expect(a.headers.get("cache-control")).toMatch(/no-store/);
    expect(a.body).toMatchObject({ status: "ok", checks: { smtp: { ok: true }, database: { ok: true }, destinations: { total: 2, reachable: 2 } } });
    expect(a.text).not.toMatch(/Ops hook|Other team|127\.0\.0\.1|webhook/);
    const r = await call("root", "GET", "/healthz");
    expect(r.body.checks.destinations.items.map((i: { name: string }) => i.name).sort()).toEqual(["Ops hook", "Other team"]);
    expect(r.text).not.toContain(M);
    expect((await call("ed", "GET", "/healthz")).body.checks.destinations.items).toBeUndefined();
    expect((await call("", "GET", "/healthz?core=1")).body.checks.destinations).toBeUndefined();
    expect((await call("", "GET", "/api/health")).status).toBe(200);
    mock.close();
    // cached: a second call within the TTL doesn't re-probe, so it still reads healthy
    expect((await call("", "GET", "/healthz")).body.checks.destinations.cached).toBe(true);
  });

  it("documents the new endpoints in Swagger", async () => {
    const o = await call("", "GET", "/docs/json");
    for (const p of ["/healthz", "/api/messages/export.csv", "/api/messages/filters", "/api/stats/report", "/api/retention", "/api/retention/purge"]) expect(Object.keys(o.body.paths), p).toContain(p);
  });
});
