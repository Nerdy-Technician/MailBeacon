import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PREFIX = "enc:v1:";

/** Derive a 32-byte key from MAILBEACON_SECRET, or load/generate one in the data dir. */
export function loadKey(dataDir: string, secret?: string, warn: (m: string) => void = console.warn): Buffer {
  if (secret) return crypto.createHash("sha256").update(secret, "utf8").digest();
  const file = path.join(dataDir, "secret.key");
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
  warn(`MAILBEACON_SECRET not set: generated a key at ${file}. Back it up, or set MAILBEACON_SECRET.`);
  return key;
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string, key: Buffer): string {
  if (!blob.startsWith(PREFIX)) throw new Error("not an encrypted value");
  const raw = Buffer.from(blob.slice(PREFIX.length), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32);
  return `scrypt:${salt.toString("hex")}:${h.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split(":");
  if (alg !== "scrypt" || !s || !h) return false;
  const want = Buffer.from(h, "hex");
  const got = crypto.scryptSync(pw, Buffer.from(s, "hex"), want.length);
  return crypto.timingSafeEqual(want, got);
}
