import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureTls, loadTls } from "../src/tls.js";

describe("tls", () => {
  it("generates a self-signed pair once and loads it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-tls-"));
    await ensureTls(dir, "mailbeacon-test");
    const first = loadTls(dir);
    const cert = new crypto.X509Certificate(first.cert);
    expect(cert.subject).toContain("CN=mailbeacon-test");
    expect(cert.checkPrivateKey(crypto.createPrivateKey(first.key))).toBe(true);
    await ensureTls(dir, "other");
    expect(loadTls(dir).cert.equals(first.cert)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30000);
});
