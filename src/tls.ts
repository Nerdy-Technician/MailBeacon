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
  if (fs.existsSync(certF) && fs.existsSync(keyF)) return;
  fs.mkdirSync(dir, { recursive: true });
  const notAfterDate = new Date(Date.now() + 3650 * 24 * 3600 * 1000);
  const pems = await generate([{ name: "commonName", value: hostname }], { keySize: 2048, notAfterDate, algorithm: "sha256" });
  fs.writeFileSync(certF, pems.cert);
  fs.writeFileSync(keyF, pems.private, { mode: 0o600 });
}

/** Load /data/tls/cert.pem + key.pem (call ensureTls first). */
export function loadTls(dataDir: string): { cert: Buffer; key: Buffer } {
  const { certF, keyF } = files(dataDir);
  return { cert: fs.readFileSync(certF), key: fs.readFileSync(keyF) };
}
