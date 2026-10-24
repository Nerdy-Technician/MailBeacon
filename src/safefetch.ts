/**
 * Outbound requests to addresses an admin typed in (the SSO issuer and the
 * endpoints its discovery document lists). Every hop is checked before any
 * connection is made:
 *  - https only (http only when private issuers are allowed), no user:pass@ in the URL;
 *  - the host name is resolved once and every address must be public, unless
 *    private issuers are allowed; cloud metadata addresses are always refused;
 *  - the connection goes to the address that was checked (the host name is
 *    kept for TLS and the Host header), so a second DNS answer can't swap it;
 *  - redirects are followed by hand, at most MAX_REDIRECTS, each one checked again;
 *  - a timeout and a response size cap.
 */
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export interface SafeFetchOptions {
  /** Allow private, loopback and link-local addresses, and plain http://. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Name resolution, replaceable in tests. */
  resolve?: (host: string) => Promise<string[]>;
}
export interface SafeResponse { status: number; headers: Record<string, string>; body: Buffer; url: string; }
export class UnsafeUrlError extends Error {}

export const MAX_REDIRECTS = 3;
const METADATA = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200", "fd00:ec2::254"]);

const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96]] as const)
  blocked.addSubnet(net, bits, "ipv6");

/** IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address. */
const unmap = (ip: string) => { const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); return m ? m[1]! : ip; };
export const isMetadataAddress = (ip: string) => METADATA.has(unmap(ip).toLowerCase());
export const isPrivateAddress = (ip: string): boolean => {
  const a = unmap(ip);
  const fam = isIP(a);
  if (!fam) return true;
  return blocked.check(a, fam === 4 ? "ipv4" : "ipv6");
};

/** Throws UnsafeUrlError unless the URL is acceptable in form (no DNS yet). */
export function checkUrl(raw: string, allowPrivate = false): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrlError("not a valid URL"); }
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:"))
    throw new UnsafeUrlError(allowPrivate ? "the URL must start with https:// or http://" : "the URL must start with https:// (allow private issuers to use http://)");
  if (u.username || u.password) throw new UnsafeUrlError("the URL must not contain a user name or password");
  if (!u.hostname) throw new UnsafeUrlError("the URL has no host");
  return u;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Resolve the host and return the one address to connect to, or throw. */
export async function pinAddress(u: URL, allowPrivate: boolean, resolve = defaultResolve): Promise<string> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: string[];
  if (isIP(host)) addrs = [host];
  else {
    try { addrs = await resolve(host); } catch { throw new UnsafeUrlError(`could not resolve ${host}`); }
  }
  if (!addrs.length) throw new UnsafeUrlError(`could not resolve ${host}`);
  for (const a of addrs) {
    if (isMetadataAddress(a)) throw new UnsafeUrlError(`${host} resolves to a cloud metadata address, which is never allowed`);
    if (!allowPrivate && isPrivateAddress(a))
      throw new UnsafeUrlError(`${host} resolves to a private or local address (${a}); turn on "Allow private issuer" if your provider is on your network`);
  }
  return addrs[0]!;
}

function once(u: URL, address: string, o: SafeFetchOptions): Promise<SafeResponse> {
  const mod = u.protocol === "https:" ? https : http;
  const maxBytes = o.maxBytes ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      // connect to the checked address only; the name is kept for TLS and Host
      host: address, family: isIP(address), port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: o.method ?? "GET",
      servername: isIP(u.hostname) ? undefined : u.hostname,
      headers: { Host: u.host, ...o.headers },
      timeout: o.timeoutMs ?? 6000,
    }, (res) => {
      const chunks: Buffer[] = []; let n = 0; let over = false;
      res.on("data", (c: Buffer) => {
        if (over) return;
        n += c.length;
        if (n > maxBytes) { over = true; reject(new UnsafeUrlError("response too large")); res.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        if (over) return;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
        resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks), url: u.href });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => { const e = new Error("no answer in time"); e.name = "TimeoutError"; req.destroy(e); });
    req.on("error", reject);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

/** GET (or o.method) a user-supplied URL with the checks above. */
export async function safeFetch(raw: string, o: SafeFetchOptions = {}): Promise<SafeResponse> {
  const allowPrivate = !!o.allowPrivate;
  let u = checkUrl(raw, allowPrivate);
  for (let hop = 0; ; hop++) {
    const address = await pinAddress(u, allowPrivate, o.resolve);
    const r = await once(u, address, o);
    if (r.status < 300 || r.status >= 400 || !r.headers.location) return r;
    if (hop >= MAX_REDIRECTS) throw new UnsafeUrlError(`more than ${MAX_REDIRECTS} redirects`);
    u = checkUrl(new URL(r.headers.location, u).href, allowPrivate);
  }
}

/** Body types the fetch()-style wrapper accepts. */
type FetchLikeBody = string | URLSearchParams | ArrayBuffer | Uint8Array | null | undefined | ReadableStream;
/** fetch()-style wrapper (openid-client's customFetch shape) running every request through safeFetch. */
export const safeFetchApi = (allowPrivate: boolean) => async (url: string, init: { method?: string; headers?: Record<string, string>; body?: FetchLikeBody } = {}): Promise<Response> => {
  const b = init.body;
  if (b instanceof ReadableStream) throw new UnsafeUrlError("streamed request bodies are not supported");
  const body = b == null ? undefined : typeof b === "string" ? b : b instanceof URLSearchParams ? b.toString() : Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b);
  const r = await safeFetch(url, { allowPrivate, method: init.method ?? "GET", headers: init.headers ?? {}, body });
  const res = new Response(r.status === 204 || r.status === 304 ? null : new Uint8Array(r.body), { status: r.status, headers: r.headers });
  Object.defineProperty(res, "url", { value: r.url });
  return res;
};
