import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { start } from "../src/index.js";
import { extractValues, pickPriority, renderTemplate, validateOptions } from "../src/format.js";
import { ROUTE_TEMPLATES } from "../src/routeTemplates.js";
import { testPattern } from "../src/matcher.js";

interface Hit { url: string; body: Buffer }
const vars = (subject: string, body: string, extra: Record<string, string> = {}) => ({ subject, body, from: "a@b", to: "c@d", route: "r", date: new Date(0), attachments: [], priority: null, extra });

describe("extraction and templates (unit)", () => {
  it("pulls named regex groups and Label: value fields", () => {
    const x = extractValues([
      { kind: "regex", field: "subject", pattern: "\\((?<host>[^)]+)\\): (?<status>\\w+)" },
      { kind: "field", field: "body", pattern: "Importance", name: "importance" },
      { kind: "regex", field: "body", pattern: "never(?<nothing>x)" },
    ], "vzdump backup status (pve1): failed", "Event: x\n  Importance:   alert  \n");
    expect(x).toEqual({ host: "pve1", status: "failed", importance: "alert", nothing: "" });
  });
  it("first rule wins, and values are capped", () => {
    const x = extractValues([{ kind: "regex", field: "any", pattern: "(?<v>a+)" }, { kind: "regex", field: "any", pattern: "(?<v>b+)" }], "", "b".repeat(9) + "a".repeat(900));
    expect(x.v.length).toBe(500);
  });
  it("renders vars, fallbacks and nested fallbacks without re-expanding message text", () => {
    expect(renderTemplate("{{host|?}} {{missing|{{subject}}}} {{unknown}}", vars("S {{body}}", "B", { host: "h1", missing: "" }))).toBe("h1 S {{body}} {{unknown}}");
    expect(renderTemplate("{{subject}}", vars("x", "y", { subject: "evil" }))).toBe("x"); // built-ins win
  });
  it("priority rules can test extracted values", () => {
    expect(pickPriority([{ field: "var:status", pattern: "^fail", priority: 9 }], "", "", { status: "failed" })).toBe(9);
    expect(pickPriority([{ field: "var:status", pattern: "^fail", priority: 9 }], "failed", "failed", { status: "ok" })).toBeNull();
  });
  it("validates extraction rules", () => {
    expect(validateOptions({ extract: [{ kind: "regex", field: "subject", pattern: "(" }] })).toMatch(/regular expression|regex/i);
    expect(validateOptions({ extract: [{ kind: "regex", field: "subject", pattern: "plain" }] })).toMatch(/named group|name/i);
    expect(validateOptions({ extract: [{ kind: "field", field: "body", pattern: "Host", name: "Bad Name!" }] })).toBeTruthy();
    expect(validateOptions({ priorityRules: [{ field: "var:BAD-", pattern: "x", priority: 1 }] })).toBeTruthy();
    expect(validateOptions({ extract: Array.from({ length: 21 }, () => ({ kind: "field" as const, field: "body" as const, pattern: "x", name: "x" })) })).toBeTruthy();
  });
  it("every ready-made template is valid, matches its own sample and extracts something", () => {
    expect(ROUTE_TEMPLATES.map((t) => t.id)).toEqual(expect.arrayContaining(["proxmox-vzdump", "truenas", "unraid", "nut", "synology", "uptime-kuma", "cron"]));
    for (const t of ROUTE_TEMPLATES) {
      expect(validateOptions(t.options), t.id).toBeNull();
      expect(testPattern(t.matchType, t.pattern, t.matchType === "recipient" ? t.sample.to : t.sample.subject).matches, t.id).toBe(true);
      const x = extractValues(t.options.extract, t.sample.subject, t.sample.body);
      expect(Object.values(x).filter(Boolean).length, t.id).toBeGreaterThan(0);
      expect(["known", "partial", "guess"]).toContain(t.confidence);
      if (t.confidence !== "known") expect(t.notes.toLowerCase(), t.id).toMatch(/guess|varies|depends|differ/);
    }
  });
});

describe("0.3.0 batch 3: send API, webhooks, branding", () => {
  const hits: Hit[] = [];
  const mock = http.createServer((req, res) => {
    const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => { hits.push({ url: req.url!, body: Buffer.concat(chunks) }); res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}'); });
  });
  let M = "";
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 29250 + Math.floor(Math.random() * 500);
  const webPort = smtpPort + 1000;
  const base = `http://127.0.0.1:${webPort}`;
  const web = (p: string, init: RequestInit = {}) => fetch(base + p, { redirect: "manual", ...init });
  const cookies: Record<string, string> = {};
  const as = (who: string, method: string, body?: unknown) => ({
    method, headers: { "X-MailBeacon": "1", cookie: cookies[who] ?? "", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper returns loose JSON
  const parse = async (r: Response): Promise<{ status: number; body: any; headers: Headers }> => { const t = await r.text(); let j: unknown; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j, headers: r.headers }; };
  const call = async (who: string, method: string, p: string, body?: unknown) => parse(await web(p, as(who, method, body)));
  const withKey = async (key: string, p: string, body: string, type = "application/json") => parse(await web(p, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": type }, body }));
  const waitHits = async (n: number) => { for (let i = 0; i < 80 && hits.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };
  const keys: Record<string, string> = {};
  const routes: Record<string, number> = {};

  beforeAll(async () => {
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", () => r()));
    M = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-b3-"));
    app = await start({ dataDir, smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 2 * 1024 * 1024, smtpHostname: "test", secret: "b3" });
    const r = await web("/api/setup", as("", "POST", { username: "root", password: "rootpassword" }));
    cookies.root = (r.headers.get("set-cookie") ?? "").split(";")[0];
    expect((await call("root", "POST", "/api/users", { username: "ed", role: "editor", password: "editorpass" })).status).toBe(200);
    expect((await call("root", "POST", "/api/users", { username: "vi", role: "viewer", password: "viewerpass" })).status).toBe(200);
    for (const u of ["ed", "vi"]) {
      const l = await web("/api/login", as("", "POST", { username: u, password: u === "ed" ? "editorpass" : "viewerpass" }));
      cookies[u] = (l.headers.get("set-cookie") ?? "").split(";")[0];
    }
  });
  afterAll(async () => { await app.stop(); mock.close(); });

  it("lists route templates and creates a working route from one", async () => {
    const t = await call("vi", "GET", "/api/route-templates");
    expect(t.status).toBe(200);
    const px = (t.body as typeof ROUTE_TEMPLATES).find((x) => x.id === "proxmox-vzdump")!;
    const d = await call("ed", "POST", "/api/destinations", { name: "hook", type: "webhook", config: { webhookUrl: `${M}/hook` }, secrets: {} });
    expect(d.status).toBe(200);
    const d2 = await call("ed", "POST", "/api/destinations", { name: "hook2", type: "webhook", config: { webhookUrl: `${M}/hook2` }, secrets: {} });
    const r = await call("ed", "POST", "/api/routes", { name: px.name, matchType: px.matchType, pattern: px.pattern, targetType: "none", options: { ...px.options, destinationIds: [d.body.id, d2.body.id] } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    routes.px = r.body.id;
    hits.length = 0;
    await nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true }).sendMail({ from: "root@pve1", to: "any@alerts.local", subject: px.sample.subject, text: px.sample.body });
    await waitHits(2);
    const j = JSON.parse(hits.find((h) => h.url === "/hook")!.body.toString());
    expect(j.title).toBe("Proxmox pve1.lan: backup failed");
    expect(j.priority).toBe(8);
    const list = await call("ed", "GET", "/api/messages?limit=1");
    const m = await call("ed", "GET", `/api/messages/${(list.body.items ?? list.body)[0].id}`);
    expect(JSON.stringify(m.body.events)).toContain("host=pve1.lan");
  });

  it("previews extraction against a pasted raw email", async () => {
    const raw = "From: Kuma <kuma@mon.lan>\nTo: kuma@alerts.local\nSubject: [Plex] [🔴 Down] timeout\n\n[Plex] [🔴 Down] timeout\nTime (Europe/London): 2026-10-24 15:00:00\n";
    const k = ROUTE_TEMPLATES.find((x) => x.id === "uptime-kuma")!;
    const p = await call("vi", "POST", "/api/templates/preview", { ...k.options, raw });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.extracted).toMatchObject({ monitor: "Plex", state: "Down", reason: "timeout", at: "2026-10-24 15:00:00" });
    expect(p.body.title).toBe("Plex is Down");
    expect(p.body.priority).toBe(8);
    expect(p.body.sample.from).toBe("kuma@mon.lan");
    const plain = await call("vi", "POST", "/api/templates/preview", { extract: [{ kind: "field", field: "body", pattern: "Host", name: "host" }], titleTemplate: "{{host}}", raw: "Host: nas1\nall fine" });
    expect(plain.body.title).toBe("nas1");
    expect((await call("vi", "POST", "/api/templates/preview", { extract: [{ kind: "regex", field: "body", pattern: "(" }] })).status).toBe(400);
  });

  it("creates send-only keys; viewers can't, and the key is shown once", async () => {
    const k = await call("ed", "POST", "/api/keys", { name: "kuma", scopes: ["messages:send"] });
    expect(k.status, JSON.stringify(k.body)).toBe(200);
    keys.send = k.body.key;
    keys.read = (await call("ed", "POST", "/api/keys", { name: "reader", scopes: ["messages:read"] })).body.key;
    keys.mixed = (await call("ed", "POST", "/api/keys", { name: "mixed", scopes: ["messages:send", "routes:read"] })).body.key;
    expect((await call("vi", "POST", "/api/keys", { name: "x", scopes: ["messages:send"] })).status).toBe(403);
    expect(JSON.stringify((await call("ed", "GET", "/api/keys")).body)).not.toContain(keys.send);
  });

  it("webhook: JSON fields become variables, fan-out and history work", async () => {
    const r = await call("ed", "POST", "/api/routes", { name: "hooked", matchType: "recipient", pattern: "nobody@nowhere.local", targetType: "none",
      options: { destinationIds: [(await call("ed", "GET", "/api/destinations")).body[0].id], titleTemplate: "{{host_name}}: {{title}}", priorityRules: [{ field: "var:severity", pattern: "crit", priority: 9 }] } });
    routes.hook = r.body.id;
    hits.length = 0;
    const s = await withKey(keys.send, `/api/webhook/${routes.hook}`, JSON.stringify({ title: "Disk full", message: "/data 99%", host: { name: "nas1" }, severity: "critical" }));
    expect(s.status, JSON.stringify(s.body)).toBe(202);
    await waitHits(1);
    const j = JSON.parse(hits[0]!.body.toString());
    expect(j).toMatchObject({ title: "nas1: Disk full", priority: 9 });
    expect(j.message).toContain("/data 99%");
    const m = await call("ed", "GET", `/api/messages/${s.body.id}`);
    expect(m.body.status).not.toBe("dead");
    expect(JSON.stringify(m.body.events)).toMatch(/webhook \(ed, key \\"kuma\\"\)/);
  });

  it("webhook: ?key= only for send-only keys and only on webhook URLs", async () => {
    expect((await parse(await fetch(base + `/api/webhook/${routes.hook}?key=${keys.send}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{\"title\":\"q\"}" }))).status).toBe(202);
    expect((await parse(await fetch(base + `/api/webhook/${routes.hook}?key=${keys.mixed}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status).toBe(401);
    expect((await parse(await fetch(base + `/api/send?key=${keys.send}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{\"to\":\"a@b.c\"}" }))).status).toBe(403); // CSRF header missing, no key accepted
  });

  it("an explicit API key wins over a session cookie (key scopes apply)", async () => {
    const r = await parse(await web("/api/settings", { headers: { cookie: cookies.root!, Authorization: `Bearer ${keys.read}` } }));
    expect(r.status).toBe(403);
    expect((await parse(await web("/api/settings", { headers: { cookie: cookies.root!, Authorization: "Bearer mbk_nope" } }))).status).toBe(401);
  });

  it("send API: scopes, ownership, matching, form data, text and validation", async () => {
    expect((await withKey(keys.read, "/api/send", JSON.stringify({ route: routes.hook, title: "x" }))).status).toBe(403);
    expect((await withKey("mbk_nope", "/api/send", "{}")).status).toBe(401);
    expect((await parse(await web("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status).toBe(403);
    const form = await withKey(keys.send, "/api/send", new URLSearchParams({ route: String(routes.hook), title: "Form", message: "hello", host_name: "f1" }).toString(), "application/x-www-form-urlencoded");
    expect(form.status, JSON.stringify(form.body)).toBe(202);
    expect((await call("ed", "GET", `/api/messages/${form.body.id}`)).body.title).toBe("f1: Form");
    const text = await withKey(keys.send, `/api/webhook/${routes.hook}`, "just text", "text/plain");
    expect(text.status).toBe(202);
    // matching like an email (subject route from the Proxmox template)
    const match = await withKey(keys.send, "/api/send", JSON.stringify({ to: "x@alerts.local", subject: "vzdump backup status (pve2): backup successful" }));
    expect(match.status, JSON.stringify(match.body)).toBe(202);
    expect(match.body.route).toBe("Proxmox backups");
    expect((await call("ed", "GET", `/api/messages/${match.body.id}`)).body.priority).toBe(2);
    expect((await withKey(keys.send, "/api/send", JSON.stringify({ to: "nomatch@zzz.local", subject: "zzz" }))).status).toBe(422);
    expect((await withKey(keys.send, "/api/send", JSON.stringify({ route: routes.hook, priority: 11 }))).status).toBe(400);
    expect((await withKey(keys.send, "/api/send", JSON.stringify({ route: routes.hook, from: "not an address" }))).status).toBe(400);
    expect((await withKey(keys.send, "/api/send", JSON.stringify({ route: 99999 }))).status).toBe(404);
    // sender priority overrides rules and is logged
    const pr = await withKey(keys.send, "/api/send", JSON.stringify({ route: routes.hook, title: "p", severity: "critical", priority: 1 }));
    const pm = (await call("ed", "GET", `/api/messages/${pr.body.id}`)).body;
    expect(pm.priority).toBe(1);
    expect(JSON.stringify(pm.events)).toContain("priority set by sender");
    // another user's route: admin route, editor key
    const rd = await call("root", "POST", "/api/destinations", { name: "roothook", type: "webhook", config: { webhookUrl: `${M}/root` }, secrets: {} });
    const adminRoute = await call("root", "POST", "/api/routes", { name: "admins", matchType: "recipient", pattern: "admin-only@alerts.local", targetType: "none", options: { destinationIds: [rd.body.id] } });
    expect(adminRoute.status, JSON.stringify(adminRoute.body)).toBe(200);
    expect((await withKey(keys.send, "/api/send", JSON.stringify({ route: adminRoute.body.id }))).status).toBe(404);
    expect((await withKey(keys.send, "/api/send", JSON.stringify({ to: "admin-only@alerts.local" }))).status).toBe(403);
    // disabled route
    expect((await call("ed", "PATCH", `/api/routes/${routes.hook}`, { enabled: false })).status).toBe(200);
    expect((await withKey(keys.send, `/api/webhook/${routes.hook}`, "{}")).status).toBe(409);
    expect((await call("ed", "PATCH", `/api/routes/${routes.hook}`, { enabled: true })).status).toBe(200);
  });

  it("rate-limits per key with 429 and Retry-After", async () => {
    expect((await call("root", "PUT", "/api/settings", { limits: { apiPerMinute: 2 } })).status).toBe(200);
    const k = (await call("ed", "POST", "/api/keys", { name: "burst", scopes: ["messages:send"] })).body.key;
    const codes: number[] = [];
    let last: Headers | undefined;
    for (let i = 0; i < 3; i++) { const r = await withKey(k, `/api/webhook/${routes.hook}`, "{}"); codes.push(r.status); last = r.headers; }
    expect(codes).toEqual([202, 202, 429]);
    expect(last!.get("retry-after")).toBe("60");
    const k2 = (await call("ed", "POST", "/api/keys", { name: "burst2", scopes: ["messages:send"] })).body.key;
    expect((await withKey(k2, `/api/webhook/${routes.hook}`, "{}")).status).toBe(202); // other keys unaffected
    expect((await call("root", "PUT", "/api/settings", { limits: { apiPerMinute: 60 } })).status).toBe(200);
  });

  it("white-label: app name, default theme and a checked, re-encoded logo", async () => {
    expect((await call("root", "PUT", "/api/settings", { appName: "x".repeat(41) })).status).toBe(400);
    expect((await call("root", "PUT", "/api/settings", { defaultTheme: "pink" })).status).toBe(400);
    expect((await call("ed", "PUT", "/api/settings", { appName: "Mine" })).status).toBe(403);
    expect((await call("root", "PUT", "/api/settings", { appName: "  Asgard <b>Alerts</b> ", defaultTheme: "light" })).status).toBe(200);
    let st = (await call("", "GET", "/api/status")).body;
    expect(st).toMatchObject({ appName: "Asgard bAlerts/b", defaultTheme: "light", logoUrl: null });
    const up = (body: Buffer, type: string, who = "root") => web("/api/branding/logo", { method: "POST", headers: { "X-MailBeacon": "1", cookie: cookies[who]!, "Content-Type": type }, body: new Uint8Array(body) });
    const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#c90000" } }).png().toBuffer();
    expect((await up(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml")).status).toBe(415);
    expect((await up(Buffer.from("GIF89a-not-really-a-png"), "image/png")).status).toBe(415);
    expect((await up(png, "image/png", "ed")).status).toBe(403);
    const big = Buffer.concat([png, Buffer.alloc(1024 * 1024 + 10)]);
    expect([413]).toContain((await up(big, "image/png")).status);
    expect((await up(png, "image/png")).status).toBe(200);
    st = (await call("", "GET", "/api/status")).body;
    expect(st.logoUrl).toMatch(/^\/api\/branding\/logo\?v=/);
    const g = await web(st.logoUrl);
    expect(g.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await g.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([256, 128]);
    const etag = g.headers.get("etag")!;
    expect((await web(st.logoUrl, { headers: { "If-None-Match": etag } })).status).toBe(304);
    expect((await call("root", "DELETE", "/api/branding/logo")).status).toBe(200);
    expect((await web("/api/branding/logo")).status).toBe(404);
    expect((await call("root", "PUT", "/api/settings", { appName: "" })).status).toBe(200);
    expect((await call("", "GET", "/api/status")).body.appName).toBe("MailBeacon");
  });

  it("documents the new endpoints in Swagger", async () => {
    const spec = (await call("", "GET", "/docs/json")).body;
    for (const p of ["/api/send", "/api/webhook/{routeId}", "/api/route-templates", "/api/branding/logo"]) expect(spec.paths[p], p).toBeTruthy();
    expect(JSON.stringify(spec.components.schemas.Scope)).toContain("messages:send");
  });
});
