import * as client from "openid-client";
import type { Store } from "./db.js";
import { checkUrl, pinAddress, safeFetchApi } from "./safefetch.js";

export interface OidcSettings {
  issuer: string; clientId: string; clientSecret: string; scopes: string; allowed: string[];
  publicUrl: string; fromEnv: string[];
  /** Issuer may be on a private address (LAN, loopback) and may use http://. */
  allowPrivate: boolean;
}

const ENV: Record<string, string> = {
  issuer: "MAILBEACON_OIDC_ISSUER", clientId: "MAILBEACON_OIDC_CLIENT_ID", clientSecret: "MAILBEACON_OIDC_CLIENT_SECRET",
  scopes: "MAILBEACON_OIDC_SCOPES", allowed: "MAILBEACON_OIDC_ALLOWED", publicUrl: "MAILBEACON_PUBLIC_URL",
};
export const CALLBACK_PATH = "/api/oidc/callback";

/** Env vars win over values saved in the UI. */
export function readOidcSettings(store: Store, env: NodeJS.ProcessEnv = process.env): OidcSettings {
  const fromEnv = Object.entries(ENV).filter(([, e]) => env[e]).map(([k]) => k);
  const pick = (k: string, db: string | undefined) => env[ENV[k]] || db || "";
  return {
    issuer: pick("issuer", store.getSetting("oidc_issuer")),
    clientId: pick("clientId", store.getSetting("oidc_client_id")),
    clientSecret: pick("clientSecret", store.getSecretSetting("oidc_client_secret")),
    scopes: pick("scopes", store.getSetting("oidc_scopes")) || "openid profile email",
    allowed: pick("allowed", store.getSetting("oidc_allowed")).split(/[,\n]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
    publicUrl: pick("publicUrl", store.getSetting("public_url")).replace(/\/+$/, ""),
    fromEnv,
    allowPrivate: (env.MAILBEACON_OIDC_ALLOW_PRIVATE ?? store.getSetting("oidc_allow_private")) === "1",
  };
}
export const oidcEnabled = (s: OidcSettings) => !!(s.issuer && s.clientId);

/** True if the claims pass the optional allow-list of emails or group names. */
export function isAllowed(claims: Record<string, unknown>, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  const groups = Array.isArray(claims.groups) ? claims.groups.map((g) => String(g).toLowerCase()) : [];
  return allowed.some((a) => a === email || groups.includes(a));
}

interface Pending { verifier: string; state: string; nonce: string; redirectUri: string; exp: number }

export class OidcLogin {
  private cache?: { key: string; config: client.Configuration };
  private pending = new Map<string, Pending>();
  constructor(private store: Store) {}

  private async config(s: OidcSettings): Promise<client.Configuration> {
    const key = [s.issuer, s.clientId, s.clientSecret, s.allowPrivate].join("\n");
    if (this.cache?.key === key) return this.cache.config;
    const issuer = checkUrl(s.issuer, s.allowPrivate);
    await pinAddress(issuer, s.allowPrivate); // clear error before the library's own message
    const opts: client.DiscoveryRequestOptions = { [client.customFetch]: safeFetchApi(s.allowPrivate) };
    if (issuer.protocol === "http:") opts.execute = [client.allowInsecureRequests];
    const config = await client.discovery(issuer, s.clientId, s.clientSecret || undefined, undefined, opts);
    this.cache = { key, config };
    return config;
  }
  reset() { this.cache = undefined; }

  /** Returns [pending-id, authorisation URL]. */
  async begin(s: OidcSettings, redirectUri: string): Promise<[string, string]> {
    const config = await this.config(s);
    const now = Date.now();
    for (const [k, p] of this.pending) if (p.exp < now) this.pending.delete(k);
    const p: Pending = { verifier: client.randomPKCECodeVerifier(), state: client.randomState(), nonce: client.randomNonce(), redirectUri, exp: now + 10 * 60000 };
    const id = client.randomState();
    this.pending.set(id, p);
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri, scope: s.scopes, state: p.state, nonce: p.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(p.verifier), code_challenge_method: "S256",
    });
    return [id, url.href];
  }

  /** Completes the code flow and returns the ID token claims. Throws on any failure. */
  async finish(s: OidcSettings, id: string | undefined, query: string): Promise<Record<string, unknown>> {
    const p = id ? this.pending.get(id) : undefined;
    if (!p || p.exp < Date.now()) throw new Error("login session expired, try again");
    this.pending.delete(id!);
    const config = await this.config(s);
    const current = new URL(p.redirectUri);
    current.search = query;
    const tokens = await client.authorizationCodeGrant(config, current, { pkceCodeVerifier: p.verifier, expectedState: p.state, expectedNonce: p.nonce, idTokenExpected: true });
    const claims = { ...(tokens.claims() ?? {}) } as Record<string, unknown>;
    if (!claims.email || !claims.groups) {
      try {
        const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub as string);
        for (const [k, v] of Object.entries(info)) if (claims[k] === undefined) claims[k] = v;
      } catch { /* userinfo is optional */ }
    }
    return claims;
  }
}
