import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Store } from "../src/db.js";
import { createWeb } from "../src/web.js";

describe("auth paths: API keys, sessions and login lockout", () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "mb-auth-")), crypto.randomBytes(32));
  const adminId = store.createUser({ username: "boss", role: "admin", password: "correct-horse" });
  const otherId = store.createUser({ username: "gone", role: "editor", password: "correct-horse" });
  const full = store.createApiKey(adminId, "full", ["messages:send", "routes:read"], null).key;
  const sendOnly = store.createApiKey(adminId, "send", ["messages:send"], null).key;
  const disabledKey = store.createApiKey(otherId, "x", ["messages:send"], null).key;
  store.updateUser(otherId, { disabled: true });
  const app = createWeb(store);
  afterAll(async () => { await app.close(); });
  const H = { "x-mailbeacon": "1" };
  const login = (password: string, ip: string) => app.inject({ method: "POST", url: "/api/login", headers: H, payload: { username: "boss", password }, remoteAddress: ip });
  let cookie = "";

  it("signs in with a password and uses the session cookie", async () => {
    const r = await login("correct-horse", "10.1.0.1");
    expect(r.statusCode).toBe(200);
    cookie = String(r.headers["set-cookie"]).split(";")[0]!;
    expect((await app.inject({ url: "/api/me", headers: { ...H, cookie } })).statusCode).toBe(200);
  });
  it("accepts a valid key in the Authorization header", async () => {
    const r = await app.inject({ url: "/api/me", headers: { authorization: `Bearer ${full}` } });
    expect(r.statusCode).toBe(200);
  });
  it("never falls back to the cookie when a presented key is wrong", async () => {
    const bad = full.slice(0, -4) + "AAAA";
    expect((await app.inject({ url: "/api/me", headers: { ...H, cookie, authorization: `Bearer ${bad}` } })).statusCode).toBe(401);
  });
  it("refuses keys of disabled users", async () => {
    expect((await app.inject({ url: "/api/me", headers: { authorization: `Bearer ${disabledKey}` } })).statusCode).toBe(401);
  });
  it("only takes ?key= on the webhook URL, and only for send-only keys", async () => {
    expect((await app.inject({ url: `/api/me?key=${full}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/webhook/999?key=${full}`, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/webhook/999?key=${sendOnly}`, payload: {} })).statusCode).not.toBe(401);
  });
  it("locks a client out after 5 failures, even with the right password, and only that client", async () => {
    for (let i = 0; i < 5; i++) expect((await login("wrong", "10.2.0.2")).statusCode).toBe(401);
    expect((await login("correct-horse", "10.2.0.2")).statusCode).toBe(429);
    expect((await login("correct-horse", "10.3.0.3")).statusCode).toBe(200);
  });
  it("treats a missing or non-string password as wrong", async () => {
    expect((await app.inject({ method: "POST", url: "/api/login", headers: H, payload: { username: "boss" }, remoteAddress: "10.4.0.4" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/login", headers: H, payload: { username: "boss", password: 12345 }, remoteAddress: "10.4.0.4" })).statusCode).toBe(401);
  });
});
