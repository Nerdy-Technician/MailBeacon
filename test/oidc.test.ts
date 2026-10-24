import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { start } from "../src/index.js";

/** Minimal OIDC provider: discovery, authorize (auto-approves), token, JWKS, userinfo. */
function mockIdp(user: () => Record<string, unknown>) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { nonce: string; challenge: string; clientId: string }>();
  let issuer = "";
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url!, issuer);
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (o: unknown, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (u.pathname === "/.well-known/openid-configuration") return json({
        issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token", jwks_uri: issuer + "/jwks",
        userinfo_endpoint: issuer + "/userinfo", response_types_supported: ["code"], subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"],
      });
      if (u.pathname === "/jwks") return json({ keys: [jwk] });
      if (u.pathname === "/authorize") {
        const code = crypto.randomBytes(8).toString("hex");
        codes.set(code, { nonce: u.searchParams.get("nonce")!, challenge: u.searchParams.get("code_challenge")!, clientId: u.searchParams.get("client_id")! });
        const back = new URL(u.searchParams.get("redirect_uri")!);
        back.searchParams.set("code", code); back.searchParams.set("state", u.searchParams.get("state")!);
        res.writeHead(302, { Location: back.href }); return res.end();
      }
      if (u.pathname === "/token") {
        const p = new URLSearchParams(body);
        const c = codes.get(p.get("code")!);
        const auth = Buffer.from((req.headers.authorization ?? "").replace("Basic ", ""), "base64").toString();
        const post = `${p.get("client_id")}:${p.get("client_secret")}`;
        if (!c || (auth !== "mailbeacon:shh" && post !== "mailbeacon:shh")) return json({ error: "invalid_grant" }, 400);
        const verifier = crypto.createHash("sha256").update(p.get("code_verifier")!).digest("base64url");
        if (verifier !== c.challenge) return json({ error: "invalid_grant" }, 400);
        const now = Math.floor(Date.now() / 1000);
        const head = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
        const claims = b64({ iss: issuer, aud: c.clientId, sub: "u1", iat: now, exp: now + 300, nonce: c.nonce, ...user() });
        const sig = crypto.sign("sha256", Buffer.from(`${head}.${claims}`), privateKey).toString("base64url");
        return json({ access_token: "at", token_type: "Bearer", expires_in: 300, id_token: `${head}.${claims}.${sig}` });
      }
      if (u.pathname === "/userinfo") return json({ sub: "u1" });
      res.statusCode = 404; res.end();
    });
  });
  return {
    srv, get issuer() { return issuer; },
    listen: () => new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => { issuer = `http://127.0.0.1:${(srv.address() as { port: number }).port}`; r(); })),
  };
}

describe("OIDC login and multi-target routes", () => {
  let who: Record<string, unknown> = { email: "nt@example.com", groups: ["MailBeacon Admins"] };
  const idp = mockIdp(() => who);
  const ntfyHits: { auth?: string; body: Record<string, unknown> }[] = [];
  let ntfyDown = false;
  const ntfy = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { if (ntfyDown) { res.statusCode = 502; return res.end(); } ntfyHits.push({ auth: req.headers.authorization, body: JSON.parse(b) }); res.end("{}"); });
  });
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 26250 + Math.floor(Math.random() * 500);
  const webPort = smtpPort + 1000;
  const base = `http://127.0.0.1:${webPort}`;
  const web = (p: string, init: RequestInit = {}) => fetch(base + p, { redirect: "manual", ...init });
  let admin = "";
  const j = (method: string, body?: unknown, cookie = admin) => ({
    method, headers: { "X-MailBeacon": "1", cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });

  beforeAll(async () => {
    await idp.listen();
    await new Promise<void>((r) => ntfy.listen(0, "127.0.0.1", () => r()));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-oidc-"));
    app = await start({ dataDir, smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 64 * 1024, smtpHostname: "test", secret: "oidc" });
    const r = await web("/api/setup", j("POST", { password: "longpassword" }, ""));
    admin = (r.headers.get("set-cookie") ?? "").split(";")[0];
  });
  afterAll(async () => { await app.stop(); idp.srv.close(); ntfy.close(); });

  /** Walks the browser redirects: /api/oidc/login -> IdP -> callback. Returns the final response. */
  const ssoLogin = async () => {
    const r1 = await web("/api/oidc/login");
    expect(r1.status).toBe(302);
    const stateCookie = (r1.headers.get("set-cookie") ?? "").split(";")[0];
    expect(stateCookie).toMatch(/^mb_oidc=/);
    const r2 = await fetch(r1.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(r2.headers.get("location")!);
    expect(cb.pathname).toBe("/api/oidc/callback");
    return web(cb.pathname + cb.search, { headers: { cookie: stateCookie } });
  };

  it("saves OIDC settings, encrypts the client secret and shows the redirect URI", async () => {
    expect((await web("/api/settings", j("PUT", { oidcIssuer: idp.issuer, oidcClientId: "mailbeacon", oidcClientSecret: "shh", oidcAllowed: "mailbeacon admins", publicUrl: base }))).status).toBe(200);
    const s = await (await web("/api/settings", j("GET"))).json();
    expect(s).toMatchObject({ oidcIssuer: idp.issuer, oidcClientSecretSet: true, oidcRedirectUri: base + "/api/oidc/callback", oidcScopes: "openid profile email" });
    expect(JSON.stringify(s)).not.toContain("shh");
    const raw = app.store.getSetting("oidc_client_secret")!;
    expect(raw.startsWith("enc:v1:")).toBe(true);
    expect((await (await web("/api/status")).json()).oidc).toBe(true);
  });

  it("refuses to disable password login before a successful SSO login", async () => {
    const r = await web("/api/settings", j("PUT", { localLoginDisabled: true }));
    expect(r.status).toBe(400);
  });

  it("rejects users outside the allowed list", async () => {
    who = { email: "intruder@example.com", groups: ["users"] };
    const r = await ssoLogin();
    expect(r.headers.get("location")).toMatch(/login_error=/);
    expect(r.headers.get("set-cookie") ?? "").not.toContain("mb_session");
  });

  it("logs in an allowed group member and creates a session", async () => {
    who = { email: "nt@example.com", groups: ["MailBeacon Admins"] };
    const r = await ssoLogin();
    expect(r.headers.get("location")).toBe("/");
    const sess = (r.headers.getSetCookie().find((c) => c.startsWith("mb_session=")) ?? "").split(";")[0];
    expect(sess).toMatch(/^mb_session=[a-f0-9]+$/);
    expect((await (await web("/api/status", { headers: { cookie: sess } })).json()).authed).toBe(true);
  });

  it("rejects a callback with a forged or replayed state", async () => {
    const r = await web("/api/oidc/callback?code=x&state=y", { headers: { cookie: "mb_oidc=nope" } });
    expect(r.headers.get("location")).toMatch(/login_error=/);
  });

  it("can disable password login after SSO worked", async () => {
    expect((await web("/api/settings", j("PUT", { localLoginDisabled: true }))).status).toBe(200);
    expect((await (await web("/api/status")).json()).localLogin).toBe(false);
    expect((await web("/api/login", j("POST", { password: "longpassword" }, ""))).status).toBe(403);
    expect((await web("/api/settings", j("PUT", { localLoginDisabled: false }))).status).toBe(200);
    expect((await web("/api/login", j("POST", { password: "longpassword" }, ""))).status).toBe(200);
  });

  it("routes mail to an ntfy target, masks its secrets, and send-test/retry work", async () => {
    const ntfyUrl = `http://127.0.0.1:${(ntfy.address() as { port: number }).port}`;
    const bad = await web("/api/routes", j("POST", { name: "n", matchType: "recipient", pattern: "n@x", targetType: "ntfy", target: { ntfyUrl } }));
    expect(bad.status).toBe(400);
    const ok = await web("/api/routes", j("POST", { name: "ntfy", matchType: "recipient", pattern: "nas@alerts.local", targetType: "ntfy",
      target: { ntfyUrl, ntfyTopic: "nas", ntfyPriority: 4 }, secrets: { ntfyToken: "tk_secret_123" } }));
    expect(ok.status).toBe(200);
    const { id } = await ok.json();
    const list = await (await web("/api/routes", j("GET"))).json();
    expect(JSON.stringify(list)).not.toContain("tk_secret_123");
    expect(list.find((x: { id: number }) => x.id === id).secrets.ntfyToken).toBe("••••_123");

    expect((await web(`/api/routes/${id}/test`, j("POST"))).status).toBe(200);
    expect(ntfyHits.at(-1)).toMatchObject({ auth: "Bearer tk_secret_123", body: { topic: "nas", title: "MailBeacon test", priority: 4 } });

    // editing without re-sending the secret keeps it
    expect((await web(`/api/routes/${id}`, j("PUT", { name: "ntfy2", matchType: "recipient", pattern: "nas@alerts.local", targetType: "ntfy", target: { ntfyUrl, ntfyTopic: "nas" }, secrets: { ntfyToken: "" } }))).status).toBe(200);
    expect(app.store.getRoute(id)!.secrets.ntfyToken).toBe("tk_secret_123");

    ntfyDown = true;
    await nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, secure: false, ignoreTLS: true })
      .sendMail({ from: "nas@host", to: "nas@alerts.local", subject: "Scrub done", text: "0 errors" });
    await new Promise((r) => setTimeout(r, 300));
    const m = (await (await web("/api/messages", j("GET"))).json()).find((x: { subject: string }) => x.subject === "Scrub done");
    expect(m.status).toBe("failed");
    ntfyDown = false;
    expect((await (await web(`/api/messages/${m.id}/retry`, j("POST"))).json()).ok).toBe(true);
    expect(ntfyHits.at(-1)!.body).toMatchObject({ title: "Scrub done", message: "0 errors" });
  });
});

describe("OIDC group-to-role mapping (Authentik style) and picture claim", () => {
  let who: Record<string, unknown> = {};
  const idp = mockIdp(() => who);
  let app: Awaited<ReturnType<typeof start>>;
  const smtpPort = 28250 + Math.floor(Math.random() * 500);
  const webPort = smtpPort + 1000;
  const base = `http://127.0.0.1:${webPort}`;
  const web = (p: string, init: RequestInit = {}) => fetch(base + p, { redirect: "manual", ...init });
  let admin = "";
  const j = (method: string, body?: unknown, cookie = admin) => ({
    method, headers: { "X-MailBeacon": "1", cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const sso = async () => {
    const r1 = await web("/api/oidc/login");
    const stateCookie = (r1.headers.get("set-cookie") ?? "").split(";")[0];
    const r2 = await fetch(r1.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(r2.headers.get("location")!);
    const r3 = await web(cb.pathname + cb.search, { headers: { cookie: stateCookie } });
    const sess = (r3.headers.getSetCookie().find((c) => c.startsWith("mb_session=")) ?? "").split(";")[0];
    return { location: r3.headers.get("location"), sess };
  };
  const meOf = async (sess: string) => (await web("/api/me", { headers: { cookie: sess } })).json();

  beforeAll(async () => {
    await idp.listen();
    app = await start({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "mb-oidc2-")), smtpPort, webPort, host: "127.0.0.1", maxSizeBytes: 64 * 1024, smtpHostname: "test", secret: "oidc2" });
    const r = await web("/api/setup", j("POST", { username: "owner", password: "longpassword" }, ""));
    admin = (r.headers.get("set-cookie") ?? "").split(";")[0];
    expect((await web("/api/settings", j("PUT", { oidcIssuer: idp.issuer, oidcClientId: "mailbeacon", oidcClientSecret: "shh", publicUrl: base,
      oidcGroupsClaim: "groups", oidcAdminGroups: "mailbeacon-admins", oidcEditorGroups: "mailbeacon-editors", oidcViewerGroups: "mailbeacon-viewers", oidcDefaultRole: "none" }))).status).toBe(200);
  });
  afterAll(async () => { await app.stop(); idp.srv.close(); });

  it("maps groups to roles, highest wins", async () => {
    who = { sub: "s-ed", preferred_username: "alice", email: "alice@example.com", groups: ["mailbeacon-viewers", "mailbeacon-editors"] };
    const { sess } = await sso();
    expect(await meOf(sess)).toMatchObject({ username: "alice", role: "editor", sso: true });
    who = { sub: "s-vi", preferred_username: "bob", groups: ["mailbeacon-viewers"] };
    expect(await meOf((await sso()).sess)).toMatchObject({ username: "bob", role: "viewer" });
  });
  it("refuses users in no mapped group when the default role is none", async () => {
    who = { sub: "s-x", preferred_username: "mallory", groups: ["staff"] };
    const r = await sso();
    expect(r.location).toMatch(/login_error=/);
    expect(r.sess).toBe("");
  });
  it("follows group changes on the next login, matched by subject not email", async () => {
    who = { sub: "s-ed", preferred_username: "alice", email: "changed@example.com", groups: ["mailbeacon-admins"] };
    expect((await meOf((await sso()).sess)).role).toBe("admin");
    who = { sub: "s-other", preferred_username: "alice", email: "alice@example.com", groups: ["mailbeacon-viewers"] };
    const m = await meOf((await sso()).sess);
    expect(m.username).toBe("alice-2"); // a different subject never takes over an account
  });
  it("uses the OIDC picture claim as the default avatar and lets the user switch", async () => {
    who = { sub: "s-pic", preferred_username: "carol", name: "Carol Danvers", email: "carol@example.com", picture: "https://auth.example.com/media/carol.png", groups: ["mailbeacon-viewers"] };
    const { sess } = await sso();
    const m = await meOf(sess);
    expect(m.avatar).toMatchObject({ source: "oidc", url: "https://auth.example.com/media/carol.png", initials: "CD" });
    expect(m.avatar.available).toEqual(["oidc", "gravatar", "initials"]);
    const r = await web("/api/me", { method: "PUT", headers: { "X-MailBeacon": "1", cookie: sess, "Content-Type": "application/json" }, body: JSON.stringify({ avatarSource: "gravatar" }) });
    expect((await r.json()).avatar.url).toMatch(/^https:\/\/gravatar\.com\/avatar\/[a-f0-9]{64}\?s=96&d=404$/);
    who = { ...who, picture: "javascript:alert(1)" };
    expect((await meOf((await sso()).sess)).avatar.available).not.toContain("oidc");
  });
});
