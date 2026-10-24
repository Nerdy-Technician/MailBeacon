import type { Destination, MessageRow, Route, Store } from "./db.js";
import { sendToTarget, type TargetRoute, type Notification } from "./targets.js";
import { counters } from "./metrics.js";
import { inQuietHours } from "./format.js";

export const MAX_ATTEMPTS = 5;

/** MAILBEACON_DRY_RUN=1: route and record everything but never call a notification service. */
export const isDryRun = () => process.env.MAILBEACON_DRY_RUN === "1";

/** Timezone for quiet hours, digests and template dates. */
export const timezone = (store: Store) => store.getSetting("timezone") || process.env.TZ || "UTC";

/** Consecutive failures per target, for the targets list and self-alerts. Key: "route:<id>" or "dest:<id>". */
export interface Health { name: string; failures: number; lastError: string | null; lastOk: string | null; lastFail: string | null }
export const health = new Map<string, Health>();
const markHealth = (key: string, name: string, err: string | null) => {
  const h = health.get(key) ?? { name, failures: 0, lastError: null, lastOk: null, lastFail: null };
  h.name = name;
  if (err) { h.failures++; h.lastError = err; h.lastFail = new Date().toISOString(); } else { h.failures = 0; h.lastOk = new Date().toISOString(); }
  health.set(key, h);
};

export const destToTarget = (d: Destination): TargetRoute => ({
  name: d.name, targetType: d.type, gotifyUrl: d.config.gotifyUrl || null, gotifyToken: d.secrets.gotifyToken ?? "",
  gotifyPriority: d.config.gotifyPriority ?? 5, target: d.config, secrets: d.secrets,
});

interface Leg { key: number; healthKey: string; label: string; target: TargetRoute }
/** The route's inline target (key 0) plus every enabled destination it fans out to. */
export function legsFor(store: Store, route: Route, skip: string[] = []): Leg[] {
  const legs: Leg[] = [];
  if (route.targetType !== "none") legs.push({ key: 0, healthKey: `route:${route.id}`, label: `route "${route.name}" (${route.targetType})`, target: route as TargetRoute });
  for (const id of route.options?.destinationIds ?? []) {
    const d = store.getDestination(id);
    if (!d) { skip.push(`destination #${id} no longer exists`); continue; }
    if (!d.enabled) { skip.push(`destination "${d.name}" is disabled`); continue; }
    legs.push({ key: d.id, healthKey: `dest:${d.id}`, label: `destination "${d.name}" (${d.type})`, target: destToTarget(d) });
  }
  return legs;
}

function notification(store: Store, m: MessageRow, route: Route): Notification {
  return {
    title: m.title, message: m.body, contentType: m.contentType, priority: m.priority ?? undefined,
    attachments: route.options?.attachments?.forward ? store.attachmentData(m.id) : [],
  };
}

export async function deliver(store: Store, messageId: number): Promise<boolean> {
  const m = store.getMessage(messageId);
  if (!m) return false;
  const route = m.routeId ? store.getRoute(m.routeId) : undefined;
  const dead = (why: string) => { store.markMessage(m.id, "dead", why); store.addEvent(m.id, "dead", why); counters.deadLettered++; return false; };
  if (!route) return dead("route no longer exists");
  const skipped: string[] = [];
  const legs = legsFor(store, route, skipped);
  for (const s of skipped) store.addEvent(m.id, "skipped", s);
  if (!legs.length) return dead("route has no usable destination");
  const done = new Set(m.deliveredTo ?? []);
  const todo = legs.filter((l) => !done.has(l.key));
  const n = notification(store, m, route);
  if (isDryRun()) {
    for (const l of todo) store.recordDelivery(m.id, l.healthKey, l.label, true, true);
    for (const l of todo) store.addEvent(m.id, "dry-run", `would send to ${l.label}${n.attachments?.length ? ` with ${n.attachments.length} attachment(s)` : ""}${n.priority !== undefined ? `, priority ${n.priority}` : ""}; nothing was sent`);
    store.setDeliveredTo(m.id, legs.map((l) => l.key));
    store.markMessage(m.id, "delivered", null);
    store.log("info", `message ${m.id} dry-run via route "${route.name}" to ${todo.length} target(s), nothing sent`);
    counters.delivered++;
    return true;
  }
  const errors: string[] = [];
  for (const l of todo) {
    try {
      const note = await sendToTarget(l.target, store.gotifyUrl, n);
      done.add(l.key);
      store.setDeliveredTo(m.id, [...done]);
      store.addEvent(m.id, "delivered", `${l.label}, attempt ${m.attempts + 1}`);
      if (note) store.addEvent(m.id, "attachments", note);
      markHealth(l.healthKey, l.label, null);
      store.recordDelivery(m.id, l.healthKey, l.label, true);
    } catch (e) {
      const err = (e as Error).message;
      errors.push(`${l.label}: ${err}`);
      store.addEvent(m.id, "failed", `${l.label}, attempt ${m.attempts + 1}: ${err}`);
      markHealth(l.healthKey, l.label, err);
      store.recordDelivery(m.id, l.healthKey, l.label, false);
    }
  }
  if (!errors.length) {
    store.markMessage(m.id, "delivered", null);
    store.log("info", `message ${m.id} delivered via route "${route.name}" to ${todo.length} target(s)`);
    counters.delivered++;
    return true;
  }
  const err = errors.join("; ");
  const isDead = m.attempts + 1 >= MAX_ATTEMPTS;
  store.markMessage(m.id, isDead ? "dead" : "failed", err);
  counters.deliveryFailures++;
  if (isDead) {
    store.addEvent(m.id, "dead", `gave up after ${MAX_ATTEMPTS} attempts`);
    counters.deadLettered++;
    store.log("error", `message ${m.id} moved to dead letters after ${MAX_ATTEMPTS} attempts: ${err}`);
  } else store.log("error", `message ${m.id} failed via route "${route.name}": ${err}`);
  return false;
}

/** Retry failed (not dead) messages periodically; they become dead letters after MAX_ATTEMPTS. */
export function startRetryLoop(store: Store, everyMs = 60000): NodeJS.Timeout {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return; busy = true;
    try { for (const m of store.failedMessages(MAX_ATTEMPTS)) await deliver(store, m.id); } finally { busy = false; }
  }, everyMs);
  t.unref();
  return t;
}

/** Should a new message on this route wait (quiet hours / digest)? Returns null to send now. */
export function holdReason(route: Route, priority: number | null, now: Date, tz: string): "quiet-hold" | "quiet-digest" | "quiet-drop" | "digest" | null {
  const o = route.options ?? {};
  const q = o.quiet;
  if (q && inQuietHours(q, now, tz) && (priority ?? 5) < (q.bypassPriority ?? 8)) return q.action === "drop" ? "quiet-drop" : q.action === "hold" ? "quiet-hold" : "quiet-digest";
  if (o.digest?.enabled) return "digest";
  return null;
}

/**
 * Release held messages: when a route's quiet window has ended (and, for digest routes, the interval
 * has passed), send them either one by one ("hold") or as a single digest notification.
 */
export async function flushHeld(store: Store, now = new Date(), force = false): Promise<number> {
  const tz = timezone(store);
  let sent = 0;
  const byRoute = new Map<number, MessageRow[]>();
  for (const m of store.heldMessages()) if (m.routeId) byRoute.set(m.routeId, [...(byRoute.get(m.routeId) ?? []), m]);
  for (const [rid, msgs] of byRoute) {
    const route = store.getRoute(rid);
    if (!route) { for (const m of msgs) { store.setStatus(m.id, "pending"); await deliver(store, m.id); } continue; }
    const o = route.options ?? {};
    if (!force && o.quiet && inQuietHours(o.quiet, now, tz)) continue;
    const lastKey = `digest_last_${rid}`;
    const last = Number(store.getSetting(lastKey) ?? 0);
    if (!force && o.digest?.enabled && now.getTime() - last < o.digest.everyMinutes * 60000) continue;
    const asDigest = o.digest?.enabled || o.quiet?.action !== "hold";
    store.setSetting(lastKey, String(now.getTime()));
    if (!asDigest || msgs.length === 1) {
      for (const m of msgs) { store.setStatus(m.id, "pending"); store.addEvent(m.id, "released", "quiet hours ended"); await deliver(store, m.id); sent++; }
      continue;
    }
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    const lines = msgs.map((m) => `- **${fmt.format(new Date(m.receivedAt))}** ${m.title}${m.sender ? ` (${m.sender})` : ""}\n  ${m.body.replace(/\s+/g, " ").slice(0, 160)}`);
    const prio = msgs.reduce<number | null>((a, m) => (m.priority === null || m.priority === undefined ? a : Math.max(a ?? 0, m.priority)), null);
    const id = store.addMessage({ sender: "mailbeacon", recipients: "", subject: `Digest: ${msgs.length} messages`, routeId: rid, ownerId: route.ownerId ?? null,
      title: `${route.name}: ${msgs.length} messages`, body: lines.join("\n"), contentType: "text/markdown", priority: prio });
    store.addEvent(id, "digest", `digest of messages ${msgs.map((m) => "#" + m.id).join(", ")}`);
    for (const m of msgs) { store.markMessage(m.id, "delivered", null, false); store.addEvent(m.id, "digested", `sent in digest message #${id}`); }
    await deliver(store, id);
    sent++;
  }
  return sent;
}

export function startScheduler(store: Store, everyMs = 60000, extra: (() => Promise<void>)[] = []): NodeJS.Timeout {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return; busy = true;
    try { await flushHeld(store); for (const f of extra) await f(); } catch (e) { store.log("error", `scheduler: ${(e as Error).message}`); } finally { busy = false; }
  }, everyMs);
  t.unref();
  return t;
}
