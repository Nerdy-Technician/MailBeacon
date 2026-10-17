import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decrypt, encrypt, hashPassword, loadKey, verifyPassword } from "../src/crypto.js";
import { Store } from "../src/db.js";

describe("encryption at rest", () => {
  const key = loadKey("/nonexistent", "test-secret");
  it("round-trips with AES-256-GCM and random IVs", () => {
    const a = encrypt("token123", key);
    expect(a).not.toContain("token123");
    expect(a).not.toBe(encrypt("token123", key));
    expect(decrypt(a, key)).toBe("token123");
  });
  it("fails with the wrong key or tampering", () => {
    const a = encrypt("token123", key);
    expect(() => decrypt(a, loadKey("/x", "other"))).toThrow();
    const raw = Buffer.from(a.slice(7), "base64"); raw[raw.length - 1] ^= 1;
    expect(() => decrypt("enc:v1:" + raw.toString("base64"), key)).toThrow();
  });
  it("auto-generates and reuses a key file with a warning", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-"));
    const warns: string[] = [];
    const k1 = loadKey(dir, undefined, (m) => warns.push(m));
    const k2 = loadKey(dir, undefined, (m) => warns.push(m));
    expect(k1.equals(k2)).toBe(true);
    expect(warns).toHaveLength(1);
    expect(fs.statSync(path.join(dir, "secret.key")).mode & 0o777).toBe(0o600);
  });
  it("hashes passwords", () => {
    const h = hashPassword("pw");
    expect(verifyPassword("pw", h)).toBe(true);
    expect(verifyPassword("nope", h)).toBe(false);
  });
  it("stores tokens and SMTP users encrypted in SQLite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-"));
    const s = new Store(dir, key);
    s.saveRoute({ name: "a", matchType: "catchall", pattern: "", order: 1, gotifyUrl: null, gotifyToken: "SECRETTOKEN", gotifyPriority: 5, enabled: true });
    s.setSmtpUser("proxmox", "hunter22");
    expect(s.listRoutes()[0].gotifyToken).toBe("SECRETTOKEN");
    expect(s.checkSmtpUser("proxmox", "hunter22")).toBe(true);
    expect(s.checkSmtpUser("proxmox", "bad")).toBe(false);
    s.close();
    const raw = fs.readFileSync(path.join(dir, "mailbeacon.db")).toString("latin1") +
      (fs.existsSync(path.join(dir, "mailbeacon.db-wal")) ? fs.readFileSync(path.join(dir, "mailbeacon.db-wal")).toString("latin1") : "");
    expect(raw).not.toContain("SECRETTOKEN");
    expect(raw).not.toContain("scrypt:");
  });
});
