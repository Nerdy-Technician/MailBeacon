import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../src/db.js";
import { createWeb } from "../src/web.js";

const mk = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), "mb-op-")), crypto.randomBytes(32));

describe("Allow private issuer setting", () => {
  it("starts on for installs that already had an issuer, off for new ones", async () => {
    const old = mk(); old.setSetting("oidc_issuer", "http://auth.lan/application/o/mb/");
    await createWeb(old).close();
    expect(old.getSetting("oidc_allow_private")).toBe("1");
    const fresh = mk();
    await createWeb(fresh).close();
    expect(fresh.getSetting("oidc_allow_private")).toBeUndefined();
  });
  it("refuses to save an http:// or credentialed issuer unless allowed", async () => {
    const store = mk();
    store.createUser({ username: "boss", role: "admin", password: "correct-horse" });
    const app = createWeb(store);
    const H = { "x-mailbeacon": "1" };
    const li = await app.inject({ method: "POST", url: "/api/login", headers: H, payload: { username: "boss", password: "correct-horse" } });
    const cookie = String(li.headers["set-cookie"]).split(";")[0]!;
    const put = (payload: object) => app.inject({ method: "PUT", url: "/api/settings", headers: { ...H, cookie }, payload });
    expect((await put({ oidcIssuer: "http://auth.lan/" })).statusCode).toBe(400);
    expect((await put({ oidcIssuer: "https://u:p@auth.example.com/" })).statusCode).toBe(400);
    expect((await put({ oidcIssuer: "http://auth.lan/", oidcAllowPrivate: true })).statusCode).toBe(200);
    expect(store.getSetting("oidc_allow_private")).toBe("1");
    await app.close();
  });
});
