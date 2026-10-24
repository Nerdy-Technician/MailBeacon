import type { MessageRow, Store } from "./db.js";

// ---------- CSV export ----------

/**
 * One CSV cell. Cells a spreadsheet would treat as a formula (=, +, -, @, tab, CR, and full-width
 * variants) get a leading apostrophe, so opening an export of attacker-controlled subjects runs nothing.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[\s]*[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export const CSV_MAX_ROWS = 10000;

export function messagesCsv(store: Store, rows: MessageRow[]): string {
  const routeName = new Map<number, string>();
  const nameOf = (id: number | null) => {
    if (!id) return "";
    if (!routeName.has(id)) routeName.set(id, store.getRoute(id)?.name ?? `(deleted route #${id})`);
    return routeName.get(id)!;
  };
  const destNames = store.db.prepare("SELECT dest_name FROM deliveries WHERE message_id=? GROUP BY dest_key ORDER BY MIN(id)");
  const head = ["id", "received_at", "status", "sender", "recipients", "subject", "route", "destinations", "priority", "attempts", "last_error"];
  const lines = [head.map(csvCell).join(",")];
  for (const m of rows) {
    const dests = (destNames.all(m.id) as { dest_name: string }[]).map((d) => d.dest_name).join("; ");
    lines.push([m.id, m.receivedAt, m.status, m.sender, m.recipients, m.subject, nameOf(m.routeId), dests, m.priority ?? "", m.attempts, m.lastError ?? ""].map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

// ---------- Stats ----------

export const STATS_RANGES = [7, 30, 90] as const;
export interface Series { key: string; name: string; total: number; failed: number; perDay: number[]; failedPerDay: number[] }
export interface StatsReport {
  days: string[]; rangeDays: number;
  totals: { total: number; delivered: number; failed: number; dead: number; held: number; suppressed: number; pending: number; failureRate: number };
  routes: Series[]; destinations: (Series & { dryRun: number })[];
  topSenders: { sender: string; total: number; failed: number; failureRate: number }[];
}

/** Everything is computed from stored history (UTC days); ownerId scopes it to one user's messages. */
export function statsReport(store: Store, rangeDays: number, ownerId?: number, now = new Date()): StatsReport {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - rangeDays * 86400000);
  const days = Array.from({ length: rangeDays }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
  const idx = new Map(days.map((d, i) => [d, i]));
  const own = ownerId === undefined ? "" : " AND m.owner_id=?";
  const args: unknown[] = [start.toISOString(), end.toISOString(), ...(ownerId === undefined ? [] : [ownerId])];
  const failedSql = "SUM(CASE WHEN m.status IN ('failed','dead') THEN 1 ELSE 0 END)";

  const totals = { total: 0, delivered: 0, failed: 0, dead: 0, held: 0, suppressed: 0, pending: 0, failureRate: 0 };
  for (const r of store.db.prepare(`SELECT m.status AS status, COUNT(*) AS n FROM messages m WHERE m.received_at >= ? AND m.received_at < ?${own} GROUP BY m.status`).all(...args) as { status: keyof typeof totals; n: number }[]) {
    if (r.status in totals) totals[r.status] += r.n; totals.total += r.n;
  }
  totals.failureRate = totals.total ? (totals.failed + totals.dead) / totals.total : 0;

  const series = new Map<string, Series>();
  const get = (key: string, name: string) => {
    let s = series.get(key);
    if (!s) { s = { key, name, total: 0, failed: 0, perDay: days.map(() => 0), failedPerDay: days.map(() => 0) }; series.set(key, s); }
    return s;
  };
  for (const r of store.db.prepare(`SELECT m.route_id AS rid, substr(m.received_at,1,10) AS day, COUNT(*) AS n, ${failedSql} AS f FROM messages m WHERE m.received_at >= ? AND m.received_at < ?${own} GROUP BY rid, day`).all(...args) as { rid: number | null; day: string; n: number; f: number }[]) {
    const i = idx.get(r.day); if (i === undefined) continue;
    const s = get(`route:${r.rid ?? 0}`, r.rid ? store.getRoute(r.rid)?.name ?? `(deleted route #${r.rid})` : "(no route matched)");
    s.perDay[i] += r.n; s.failedPerDay[i] += r.f; s.total += r.n; s.failed += r.f;
  }
  const routes = [...series.values()].sort((a, b) => b.total - a.total);

  const dseries = new Map<string, Series & { dryRun: number }>();
  for (const r of store.db.prepare(`SELECT d.dest_key AS k, MAX(d.dest_name) AS name, substr(d.at,1,10) AS day, COUNT(*) AS n, SUM(1-d.ok) AS f, SUM(d.dry_run) AS dry FROM deliveries d JOIN messages m ON m.id=d.message_id WHERE d.at >= ? AND d.at < ?${own} GROUP BY k, day`).all(...args) as { k: string; name: string; day: string; n: number; f: number; dry: number }[]) {
    const i = idx.get(r.day); if (i === undefined) continue;
    let s = dseries.get(r.k);
    if (!s) {
      const [kind, id] = r.k.split(":");
      const cur = kind === "dest" ? store.getDestination(Number(id))?.name : undefined;
      s = { key: r.k, name: cur ?? r.name, total: 0, failed: 0, dryRun: 0, perDay: days.map(() => 0), failedPerDay: days.map(() => 0) };
      dseries.set(r.k, s);
    }
    s.perDay[i] += r.n; s.failedPerDay[i] += r.f; s.total += r.n; s.failed += r.f; s.dryRun += r.dry;
  }
  const destinations = [...dseries.values()].sort((a, b) => b.total - a.total);

  const topSenders = (store.db.prepare(`SELECT m.sender AS sender, COUNT(*) AS n, ${failedSql} AS f FROM messages m WHERE m.received_at >= ? AND m.received_at < ?${own} GROUP BY m.sender ORDER BY n DESC, sender LIMIT 10`).all(...args) as { sender: string; n: number; f: number }[])
    .map((r) => ({ sender: r.sender || "(empty)", total: r.n, failed: r.f, failureRate: r.n ? r.f / r.n : 0 }));
  return { days, rangeDays, totals, routes, destinations, topSenders };
}

// ---------- Retention ----------

export interface Retention { historyDays: number; attachmentDays: number }
/** 0 = keep forever. History is kept forever by default (as before); attachments, the bulk of the database, for 30 days. */
export const DEFAULT_RETENTION: Retention = { historyDays: 0, attachmentDays: 30 };
export const MAX_RETENTION_DAYS = 3650;

export function getRetention(store: Store): Retention {
  const n = (k: string, d: number) => { const v = store.getSetting(k); return v === undefined ? d : Number(v); };
  return { historyDays: n("retention_history_days", DEFAULT_RETENTION.historyDays), attachmentDays: n("retention_attachment_days", DEFAULT_RETENTION.attachmentDays) };
}
export function validateRetention(b: Partial<Retention>): string | null {
  for (const k of ["historyDays", "attachmentDays"] as const) {
    const v = b[k];
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > MAX_RETENTION_DAYS)) return `${k} must be a whole number of days from 0 (keep forever) to ${MAX_RETENTION_DAYS}`;
  }
  return null;
}
export function setRetention(store: Store, b: Partial<Retention>) {
  if (b.historyDays !== undefined) store.setSetting("retention_history_days", String(b.historyDays));
  if (b.attachmentDays !== undefined) store.setSetting("retention_attachment_days", String(b.attachmentDays));
}
export const cutoff = (days: number, now = Date.now()) => new Date(now - days * 86400000).toISOString();

export function countPurge(store: Store, before: string, attachmentsOnly: boolean) {
  const sel = "FROM messages WHERE received_at < ? AND status IN ('delivered','dead','suppressed')";
  const attachments = (store.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS b FROM message_attachments WHERE message_id IN (SELECT id ${sel})`).get(before) as { n: number; b: number });
  const messages = attachmentsOnly ? 0 : (store.db.prepare(`SELECT COUNT(*) AS n ${sel}`).get(before) as { n: number }).n;
  return { messages, attachments: attachments.n, attachmentBytes: attachments.b };
}

/** Applies the retention settings; called by the scheduler at most once an hour. */
export function applyRetention(store: Store, now = Date.now()) {
  const r = getRetention(store);
  const out = { messages: 0, attachments: 0 };
  if (r.historyDays > 0) { const x = store.purgeBefore(cutoff(r.historyDays, now)); out.messages += x.messages; out.attachments += x.attachments; }
  if (r.attachmentDays > 0) out.attachments += store.purgeBefore(cutoff(r.attachmentDays, now), true).attachments;
  if (out.messages || out.attachments) {
    store.log("info", `retention: deleted ${out.messages} message(s) and ${out.attachments} attachment(s)`);
    store.audit("system", "retention.applied", null, `${out.messages} messages, ${out.attachments} attachments (history ${r.historyDays || "forever"} d, attachments ${r.attachmentDays || "forever"} d)`, null);
  }
  return out;
}
let lastRun = 0;
export async function retentionTick(store: Store, everyMs = 3600000) {
  if (Date.now() - lastRun < everyMs) return;
  lastRun = Date.now();
  applyRetention(store);
}
