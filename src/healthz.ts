import type { Store } from "./db.js";
import { isDryRun } from "./delivery.js";

/**
 * /healthz: SMTP listener, database and destination reachability.
 * Destination probes are network-level only (an HTTP response of any status = reachable): they go to the
 * service's base URL, never to a webhook path, never with a token, and never send a notification.
 * Results are cached (default 60 s) and concurrent callers share one in-flight probe, so the
 * unauthenticated endpoint can't be used to flood destinations.
 */
export interface ProbeTarget { key: string; name: string; type: string; url: string | null }
export interface ProbeResult { key: string; name: string; type: string; ok: boolean | null; detail: string }
export interface DestCheck { ok: boolean; total: number; reachable: number; unreachable: number; skipped: number; checkedAt: string | null; reason?: string; items: ProbeResult[] }

const origin = (u: string | undefined | null) => { try { return u ? new URL(u).origin : null; } catch { return null; } };
export const gotifyBase = (u: string) => u.replace(/\/+$/, "");

/** Where to probe for each service: a base URL or a public health path, never anything carrying a secret. */
export function probeUrl(type: string, config: Record<string, unknown>, globalGotify: string): string | null {
  const c = config as Record<string, string | undefined>;
  switch (type) {
    case "gotify": { const b = c.gotifyUrl || globalGotify; return b && origin(b) ? gotifyBase(b) + "/health" : null; }
    case "ntfy": return origin(c.ntfyUrl) ? gotifyBase(c.ntfyUrl!) + "/v1/health" : null;
    case "pushover": return origin(c.pushoverApiUrl) ?? "https://api.pushover.net";
    case "apprise": return origin(c.appriseUrl);
    case "discord": return "https://discord.com";
    case "slack": return "https://hooks.slack.com";
    case "telegram": return origin(c.telegramApiUrl) ?? "https://api.telegram.org";
    case "webhook": return origin(c.webhookUrl);
    default: return null;
  }
}

export function probeTargets(store: Store): ProbeTarget[] {
  const out: ProbeTarget[] = [];
  for (const d of store.listDestinations().filter((x) => x.enabled)) out.push({ key: `dest:${d.id}`, name: d.name, type: d.type, url: probeUrl(d.type, d.config as Record<string, unknown>, store.gotifyUrl) });
  for (const r of store.listRoutes().filter((x) => x.enabled && x.targetType !== "none")) {
    out.push({ key: `route:${r.id}`, name: `route "${r.name}" (inline)`, type: r.targetType, url: probeUrl(r.targetType, { ...(r.target ?? {}), gotifyUrl: r.gotifyUrl ?? undefined } as Record<string, unknown>, store.gotifyUrl) });
  }
  return out;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface HealthzOpts { ttlMs?: number; timeoutMs?: number; fetcher?: Fetcher; probe?: boolean }

export function createHealthz(store: Store, smtpListening: () => boolean, o: HealthzOpts = {}) {
  const ttl = o.ttlMs ?? (Number(process.env.MAILBEACON_HEALTHZ_CACHE_SECONDS) || 60) * 1000;
  const timeout = o.timeoutMs ?? 5000;
  const fetcher: Fetcher = o.fetcher ?? ((u, i) => fetch(u, i));
  let cache: { at: number; value: DestCheck } | null = null;
  let inflight: Promise<DestCheck> | null = null;
  let probes = 0;

  async function probeAll(): Promise<DestCheck> {
    const targets = probeTargets(store);
    const enabled = o.probe ?? process.env.MAILBEACON_HEALTHZ_PROBE !== "0";
    const skipReason = isDryRun() ? "dry-run: destinations are not contacted" : !enabled ? "probes off (MAILBEACON_HEALTHZ_PROBE=0)" : null;
    const items: ProbeResult[] = await Promise.all(targets.map(async (t): Promise<ProbeResult> => {
      if (skipReason) return { key: t.key, name: t.name, type: t.type, ok: null, detail: "not checked" };
      if (!t.url) return { key: t.key, name: t.name, type: t.type, ok: null, detail: "no URL to check" };
      probes++;
      try {
        const res = await fetcher(t.url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeout) });
        return { key: t.key, name: t.name, type: t.type, ok: true, detail: `HTTP ${res.status}` };
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        return { key: t.key, name: t.name, type: t.type, ok: false, detail: err.name === "TimeoutError" ? "timed out" : err.cause?.code ?? "unreachable" };
      }
    }));
    const unreachable = items.filter((i) => i.ok === false).length;
    return { ok: unreachable === 0, total: items.length, reachable: items.filter((i) => i.ok).length, unreachable, skipped: items.filter((i) => i.ok === null).length, checkedAt: new Date().toISOString(), ...(skipReason ? { reason: skipReason } : {}), items };
  }

  async function destinations(): Promise<DestCheck & { cached: boolean }> {
    if (cache && Date.now() - cache.at < ttl) return { ...cache.value, cached: true };
    inflight ??= probeAll().then((v) => { cache = { at: Date.now(), value: v }; return v; }).finally(() => { inflight = null; });
    return { ...(await inflight), cached: false };
  }

  async function check(opts: { core?: boolean; detailed?: boolean }) {
    let db: boolean;
    try { db = (store.db.prepare("SELECT 1 AS x").get() as { x: number }).x === 1; } catch { db = false; }
    const smtp = smtpListening();
    const dest = opts.core ? null : await destinations();
    const ok = db && smtp && (dest ? dest.ok : true);
    const destOut = dest && { ok: dest.ok, total: dest.total, reachable: dest.reachable, unreachable: dest.unreachable, skipped: dest.skipped, checkedAt: dest.checkedAt, cached: dest.cached, ...(dest.reason ? { reason: dest.reason } : {}),
      ...(opts.detailed ? { items: dest.items.map((i) => ({ name: i.name, type: i.type, ok: i.ok, detail: i.detail })) } : {}) };
    return { ok, body: { status: ok ? "ok" : "fail", dryRun: isDryRun(), checks: { smtp: { ok: smtp }, database: { ok: db }, ...(destOut ? { destinations: destOut } : {}) } } };
  }
  return { check, probeCount: () => probes, reset: () => { cache = null; } };
}
