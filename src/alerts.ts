import type { Store } from "./db.js";
import { destToTarget, health, isDryRun } from "./delivery.js";
import { lastSelfTest } from "./selftest.js";
import { sendToTarget } from "./targets.js";

/** Self-alerts: MailBeacon tells you about its own trouble through one saved destination. */
export interface AlertSettings {
  enabled: boolean; destinationId: number | null;
  deadLetterThreshold: number; // alert when this many dead letters exist (and the count went up)
  unreachableAfter: number; // consecutive failures before a target counts as unreachable
  cooldownMinutes: number; // per alert kind
  onSelfTestFail: boolean;
}
export const DEFAULT_ALERTS: AlertSettings = { enabled: false, destinationId: null, deadLetterThreshold: 5, unreachableAfter: 3, cooldownMinutes: 60, onSelfTestFail: true };
export interface AlertRecord { at: string; kind: string; title: string; message: string; sent: boolean; detail: string }

export function readAlertSettings(store: Store): AlertSettings {
  try { return { ...DEFAULT_ALERTS, ...(JSON.parse(store.getSetting("alerts") ?? "{}") as Partial<AlertSettings>) }; } catch { return { ...DEFAULT_ALERTS }; }
}
export function writeAlertSettings(store: Store, b: Partial<AlertSettings>): string | null {
  const s = { ...readAlertSettings(store), ...b };
  if (typeof s.enabled !== "boolean" || typeof s.onSelfTestFail !== "boolean") return "enabled and onSelfTestFail must be true or false";
  if (s.destinationId !== null && !(Number.isInteger(s.destinationId) && store.getDestination(s.destinationId))) return "destinationId must be a saved destination";
  if (s.enabled && s.destinationId === null) return "pick a destination for self-alerts";
  for (const [k, lo, hi] of [["deadLetterThreshold", 1, 100000], ["unreachableAfter", 1, 1000], ["cooldownMinutes", 1, 10080]] as const)
    if (!Number.isInteger(s[k]) || s[k] < lo || s[k] > hi) return `${k} must be a whole number from ${lo} to ${hi}`;
  store.setSetting("alerts", JSON.stringify(s));
  return null;
}
export function alertHistory(store: Store): AlertRecord[] {
  try { return JSON.parse(store.getSetting("alert_history") ?? "[]") as AlertRecord[]; } catch { return []; }
}

/** Send (or, in dry-run, only record) one alert through the configured destination. */
export async function sendAlert(store: Store, kind: string, title: string, message: string): Promise<AlertRecord> {
  const s = readAlertSettings(store);
  const d = s.destinationId ? store.getDestination(s.destinationId) : undefined;
  const rec: AlertRecord = { at: new Date().toISOString(), kind, title, message, sent: false, detail: "" };
  if (!d) rec.detail = "no alert destination configured";
  else if (isDryRun()) rec.detail = `dry-run: would send to "${d.name}" (${d.type})`;
  else {
    try { await sendToTarget(destToTarget(d), store.gotifyUrl, { title, message, contentType: "text/markdown", priority: 8 }); rec.sent = true; rec.detail = `sent to "${d.name}"`; }
    catch (e) { rec.detail = `could not send to "${d.name}": ${(e as Error).message}`; }
  }
  store.setSetting("alert_history", JSON.stringify([rec, ...alertHistory(store)].slice(0, 50)));
  store.log(rec.sent || isDryRun() ? "warn" : "error", `self-alert ${kind}: ${title} (${rec.detail})`);
  store.audit("system", "alert.sent", kind, `${title}: ${rec.detail}`);
  return rec;
}

/** One pass of the alert checks; called every minute by the scheduler. Returns the alerts raised. */
export async function checkAlerts(store: Store, now = Date.now()): Promise<AlertRecord[]> {
  const s = readAlertSettings(store);
  if (!s.enabled) return [];
  const out: AlertRecord[] = [];
  const state = (() => { try { return JSON.parse(store.getSetting("alert_state") ?? "{}") as Record<string, number>; } catch { return {} as Record<string, number>; } })();
  const cool = (k: string) => now - (state[`at:${k}`] ?? 0) >= s.cooldownMinutes * 60000;
  const fire = async (k: string, title: string, msg: string) => { out.push(await sendAlert(store, k, title, msg)); state[`at:${k}`] = now; };

  const dead = store.statusCounts().dead;
  if (dead >= s.deadLetterThreshold && dead > (state.deadSeen ?? 0) && cool("dead-letters"))
    await fire("dead-letters", `MailBeacon: ${dead} dead letters`, `${dead} messages could not be delivered after every retry. Open **Dead letters** in MailBeacon to retry or discard them.`);
  if (dead < s.deadLetterThreshold) state.deadSeen = 0; else state.deadSeen = Math.max(state.deadSeen ?? 0, dead);

  for (const [key, h] of health) {
    if (key === `dest:${s.destinationId}`) continue; // can't alert about the alert channel through itself
    if (h.failures >= s.unreachableAfter && cool(`unreachable:${key}`))
      await fire(`unreachable:${key}`, `MailBeacon: ${h.name} unreachable`, `${h.failures} deliveries in a row failed. Last error: ${h.lastError ?? "unknown"}`);
  }
  const st = lastSelfTest();
  if (s.onSelfTestFail && st && !st.ok && cool("selftest"))
    await fire("selftest", "MailBeacon: self-test failed", st.checks.filter((c) => !c.ok).map((c) => `- ${c.name}: ${c.detail}`).join("\n"));
  store.setSetting("alert_state", JSON.stringify(state));
  return out;
}
