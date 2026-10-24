import type { Store } from "./db.js";
import { isDryRun } from "./delivery.js";
import { validateTarget } from "./targets.js";
import { stripSlashes } from "./strings.js";

export interface SelfTestCheck { name: string; ok: boolean; detail: string }
export interface SelfTestResult { at: string; ok: boolean; dryRun: boolean; checks: SelfTestCheck[] }

let last: SelfTestResult | null = null;
export const lastSelfTest = () => last;

/** Gotify app tokens are 15 characters starting with "A"; anything else is almost certainly a paste error. */
export const looksLikeGotifyToken = (t: string) => /^A[\w.-]{14}$/.test(t);

/**
 * Startup self-test: every Gotify server used by an enabled route must answer /health, and every
 * Gotify route needs a token of the right shape. App tokens cannot be verified without posting a
 * message, so this never sends anything; use "Send test" on a route for a real end-to-end check.
 */
export async function runSelfTest(store: Store, timeoutMs = 5000): Promise<SelfTestResult> {
  const checks: SelfTestCheck[] = [];
  const routes = store.listRoutes().filter((r) => r.enabled && r.targetType === "gotify");
  const urls = new Map<string, string[]>();
  for (const r of routes) {
    const u = stripSlashes(r.gotifyUrl || store.gotifyUrl);
    if (!u) { checks.push({ name: `route "${r.name}"`, ok: false, detail: "no Gotify URL (set one in Settings or on the route)" }); continue; }
    urls.set(u, [...(urls.get(u) ?? []), r.name]);
    checks.push(r.gotifyToken
      ? { name: `route "${r.name}" token`, ok: looksLikeGotifyToken(r.gotifyToken), detail: looksLikeGotifyToken(r.gotifyToken) ? "token present and well-formed" : "token does not look like a Gotify app token (15 characters starting with A)" }
      : { name: `route "${r.name}" token`, ok: false, detail: "no token" });
  }
  for (const [u, names] of urls) {
    try {
      const res = await fetch(u + "/health", { signal: AbortSignal.timeout(timeoutMs) });
      const body = (await res.json().catch(() => ({}))) as { health?: string; database?: string };
      const ok = res.ok && body.health !== "red";
      checks.push({ name: `Gotify ${u}`, ok, detail: ok ? `reachable (health ${body.health ?? "ok"}), used by ${names.join(", ")}` : `HTTP ${res.status}, health ${body.health ?? "unknown"}` });
    } catch (e) {
      checks.push({ name: `Gotify ${u}`, ok: false, detail: `unreachable: ${(e as Error).message}` });
    }
  }
  if (!routes.length) checks.push({ name: "Gotify routes", ok: true, detail: "no enabled Gotify routes to check" });
  // saved destinations: config must validate (nothing is sent)
  const dests = store.listDestinations();
  for (const d of dests.filter((x) => x.enabled)) {
    const err = validateTarget(d.type, d.config, d.secrets);
    if (err) checks.push({ name: `destination "${d.name}"`, ok: false, detail: err });
  }
  // routes must have somewhere to deliver to
  for (const r of store.listRoutes().filter((x) => x.enabled)) {
    const ids = r.options?.destinationIds ?? [];
    const missing = ids.filter((id) => !dests.some((d) => d.id === id));
    const live = ids.filter((id) => dests.some((d) => d.id === id && d.enabled));
    if (missing.length) checks.push({ name: `route "${r.name}" destinations`, ok: false, detail: `destination id(s) ${missing.join(", ")} no longer exist` });
    if (r.targetType === "none" && !live.length) checks.push({ name: `route "${r.name}"`, ok: false, detail: "no inline target and no enabled destinations: mail would go nowhere" });
  }
  last = { at: new Date().toISOString(), ok: checks.every((c) => c.ok), dryRun: isDryRun(), checks };
  for (const c of checks) store.log(c.ok ? "info" : "warn", `self-test: ${c.name}: ${c.detail}`);
  store.log(last.ok ? "info" : "warn", `self-test ${last.ok ? "passed" : "found problems"} (${checks.filter((c) => !c.ok).length} of ${checks.length} checks failed)`);
  return last;
}
