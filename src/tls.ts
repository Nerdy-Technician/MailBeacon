import fs from "node:fs";
import path from "node:path";
import { generate } from "selfsigned";

const files = (dataDir: string) => {
  const dir = path.join(dataDir, "tls");
  return { dir, certF: path.join(dir, "cert.pem"), keyF: path.join(dir, "key.pem") };
};

/** Generate a self-signed pair in /data/tls unless cert.pem + key.pem already exist. */
export async function ensureTls(dataDir: string, hostname: string): Promise<void> {
  const { dir, certF, keyF } = files(dataDir);
  try { loadTls(dataDir); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  fs.mkdirSync(dir, { recursive: true });
  const notAfterDate = new Date(Date.now() + 3650 * 24 * 3600 * 1000);
  const pems = await generate([{ name: "commonName", value: hostname }], { keySize: 2048, notAfterDate, algorithm: "sha256" });
  // Write each file with O_EXCL so a pair created meanwhile (or a symlink planted in the dir) is never overwritten.
  try {
    fs.writeFileSync(keyF, pems.private, { mode: 0o600, flag: "wx" });
    fs.writeFileSync(certF, pems.cert, { flag: "wx" });
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
}

/** Load /data/tls/cert.pem + key.pem (call ensureTls first). */
export function loadTls(dataDir: string): { cert: Buffer; key: Buffer } {
  const { certF, keyF } = files(dataDir);
  return { cert: fs.readFileSync(certF), key: fs.readFileSync(keyF) };
}
