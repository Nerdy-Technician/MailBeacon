import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, isMetadataAddress, isPrivateAddress, MAX_REDIRECTS, pinAddress, safeFetch, UnsafeUrlError } from "../src/safefetch.js";

describe("safe fetch: URL form", () => {
  it("wants https unless private issuers are allowed, and no credentials", () => {
    expect(() => checkUrl("http://auth.example.com/")).toThrow(UnsafeUrlError);
    expect(checkUrl("http://auth.example.com/", true).protocol).toBe("http:");
    expect(() => checkUrl("file:///etc/passwd", true)).toThrow(/https/);
    expect(() => checkUrl("ftp://x.example/", true)).toThrow(UnsafeUrlError);
    expect(() => checkUrl("https://user:pw@auth.example.com/")).toThrow(/user name or password/);
    expect(() => checkUrl("not a url")).toThrow(/valid URL/);
  });
});

describe("safe fetch: addresses", () => {
  it("classifies private, loopback, link-local, CGNAT and mapped addresses", () => {
    for (const a of ["10.0.0.1", "172.16.5.5", "192.168.1.10", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd12::1", "::ffff:192.168.0.20", "::"])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("always refuses metadata addresses, even when private issuers are allowed", async () => {
    expect(isMetadataAddress("169.254.169.254")).toBe(true);
    expect(isMetadataAddress("::ffff:169.254.169.254")).toBe(true);
    await expect(pinAddress(new URL("http://169.254.169.254/"), true)).rejects.toThrow(/metadata/);
    await expect(pinAddress(new URL("https://meta.test/"), true, async () => ["fd00:ec2::254"])).rejects.toThrow(/metadata/);
  });
  it("refuses a name if any of its addresses is private", async () => {
    await expect(pinAddress(new URL("https://auth.test/"), false, async () => ["1.1.1.1", "192.168.0.5"])).rejects.toThrow(/Allow private issuer/);
    expect(await pinAddress(new URL("https://auth.test/"), false, async () => ["1.1.1.1"])).toBe("1.1.1.1");
    expect(await pinAddress(new URL("https://auth.test/"), true, async () => ["192.168.0.5"])).toBe("192.168.0.5");
  });
  it("reports names that don't resolve", async () => {
    await expect(pinAddress(new URL("https://nope.test/"), false, async () => { throw new Error("ENOTFOUND"); })).rejects.toThrow(/could not resolve/);
  });
});

describe("safe fetch: requests", () => {
  let server: http.Server; let port = 0; const hosts: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hosts.push(String(req.headers.host));
      if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); return; }
      if (req.url === "/to-metadata") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); res.end(); return; }
      if (req.url === "/to-ok") { res.writeHead(301, { location: "/ok" }); res.end(); return; }
      if (req.url === "/big") { res.end("x".repeat(3000)); return; }
      res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("connects to the address it checked, so a changed DNS answer can't redirect it", async () => {
    const answers = [["127.0.0.1"], ["169.254.169.254"]];
    let calls = 0;
    const resolve = async () => answers[Math.min(calls++, 1)]!;
    const r = await safeFetch(`http://idp.test:${port}/ok`, { allowPrivate: true, resolve });
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
    expect(hosts.at(-1)).toBe(`idp.test:${port}`); // Host header keeps the name
  });
  it("refuses loopback without the setting", async () => {
    await expect(safeFetch(`https://127.0.0.1:${port}/ok`)).rejects.toThrow(/private or local/);
  });
  it("follows a few redirects and checks every hop", async () => {
    expect(JSON.parse((await safeFetch(`http://127.0.0.1:${port}/to-ok`, { allowPrivate: true })).body.toString()).ok).toBe(true);
    await expect(safeFetch(`http://127.0.0.1:${port}/loop`, { allowPrivate: true })).rejects.toThrow(new RegExp(`more than ${MAX_REDIRECTS}`));
    await expect(safeFetch(`http://127.0.0.1:${port}/to-metadata`, { allowPrivate: true })).rejects.toThrow(/metadata/);
  });
  it("caps the response size", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/big`, { allowPrivate: true, maxBytes: 1000 })).rejects.toThrow(/too large/);
  });
});
