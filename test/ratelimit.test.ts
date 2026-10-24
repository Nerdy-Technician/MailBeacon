import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Store } from "../src/db.js";
import { createWeb } from "../src/web.js";

describe("HTTP rate limit", () => {
  process.env.MAILBEACON_HTTP_RATE_LIMIT = "60";
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), "mb-rl-")), crypto.randomBytes(32));
  const app = createWeb(store);
  afterAll(async () => { await app.close(); delete process.env.MAILBEACON_HTTP_RATE_LIMIT; });

  it("answers 429 with Retry-After once a client goes over the limit", async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await app.inject({ url: "/api/me" })).statusCode;
    const r = await app.inject({ url: "/api/me" });
    expect(last).toBe(429);
    expect(r.headers["retry-after"]).toBeDefined();
  });
  it("never limits the health check", async () => {
    for (let i = 0; i < 70; i++) expect((await app.inject({ url: "/healthz?core=1" })).statusCode).not.toBe(429);
  });
  it("limits password logins to 20 a minute", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await app.inject({ method: "POST", url: "/api/login", headers: { "x-mailbeacon": "1", "x-forwarded-for": "x" }, payload: { username: "x", password: "y" }, remoteAddress: "10.9.9.9" })).statusCode);
    expect(codes.at(-1)).toBe(429);
  });
});
