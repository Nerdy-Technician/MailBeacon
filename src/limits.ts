import type { Store } from "./db.js";

/** SMTP abuse limits, editable in Settings. 0 means "no limit". */
export interface Limits { maxConnections: number; maxConnectionsPerIp: number; messagesPerMinutePerIp: number; maxRecipients: number; apiPerMinute: number }
export const DEFAULT_LIMITS: Limits = { maxConnections: 50, maxConnectionsPerIp: 10, messagesPerMinutePerIp: 60, maxRecipients: 20, apiPerMinute: 60 };
const KEYS: Record<keyof Limits, string> = {
  maxConnections: "limit_max_connections", maxConnectionsPerIp: "limit_max_connections_per_ip",
  messagesPerMinutePerIp: "limit_messages_per_minute_per_ip", maxRecipients: "limit_max_recipients", apiPerMinute: "limit_api_per_minute",
};
const MAX = 100000;

export function readLimits(store: Store): Limits {
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(KEYS) as (keyof Limits)[]) {
    const v = store.getSetting(KEYS[k]);
    if (v !== undefined && Number.isInteger(Number(v))) out[k] = Number(v);
  }
  return out;
}

/** Validate and store any limits present in body. Returns an error message or null. */
export function writeLimits(store: Store, body: Partial<Record<keyof Limits, unknown>>): string | null {
  const updates: [string, number][] = [];
  for (const k of Object.keys(KEYS) as (keyof Limits)[]) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 0 || n > MAX) return `${k} must be a whole number from 0 (no limit) to ${MAX}`;
    updates.push([KEYS[k], n]);
  }
  for (const [k, n] of updates) store.setSetting(k, String(n));
  return null;
}

/** Sliding one-minute window of message counts per client IP. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private windowMs = 60000, private now = () => Date.now()) {}
  /** Record one hit; returns false if this hit goes over the limit (the hit is not recorded then). */
  take(key: string, limit: number): boolean {
    if (limit <= 0) return true;
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    if (arr.length >= limit) { this.hits.set(key, arr); return false; }
    arr.push(t); this.hits.set(key, arr);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some((x) => x > t - this.windowMs)) this.hits.delete(k);
    return true;
  }
}

/** Attachment limits: files over maxFileKb, past maxCount, or past maxTotalKb are not stored or forwarded. */
export interface AttachmentLimits { maxFileKb: number; maxTotalKb: number; maxCount: number }
export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = { maxFileKb: 1024, maxTotalKb: 5120, maxCount: 5 };
export function readAttachmentLimits(store: Store): AttachmentLimits {
  try { return { ...DEFAULT_ATTACHMENT_LIMITS, ...(JSON.parse(store.getSetting("attachment_limits") ?? "{}") as Partial<AttachmentLimits>) }; } catch { return { ...DEFAULT_ATTACHMENT_LIMITS }; }
}
export function writeAttachmentLimits(store: Store, b: Partial<Record<keyof AttachmentLimits, unknown>>): string | null {
  const cur = readAttachmentLimits(store);
  for (const k of Object.keys(DEFAULT_ATTACHMENT_LIMITS) as (keyof AttachmentLimits)[]) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0 || n > 51200) return `${k} must be a whole number from 0 to 51200`;
    cur[k] = n;
  }
  store.setSetting("attachment_limits", JSON.stringify(cur));
  return null;
}
