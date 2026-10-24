/** Per-route message formatting, priority rules, quiet hours and digests. */
import { patternError, trySafe } from "./saferegex.js";
import { trimBoth } from "./strings.js";

/** field: subject, body, any (both), or "var:<name>" to test an extracted value. */
export interface PriorityRule { field: string; pattern: string; priority: number }
/**
 * Pull values out of a message. kind "regex": a case-insensitive, multi-line regex whose named groups
 * become variables ((?<host>\S+)); without named groups, `name` takes group 1 or the whole match.
 * kind "field": `pattern` is a label such as "Hostname" and the value is the rest of a "Hostname: value" line.
 */
export interface ExtractRule { kind: "regex" | "field"; field: "subject" | "body" | "any"; pattern: string; name?: string }
export interface QuietHours {
  enabled: boolean; start: string; end: string; // "22:00" - "07:00" (may wrap midnight)
  days?: number[]; // 0 = Sunday … 6; blank = every day (the day the window starts)
  action: "digest" | "hold" | "drop"; // digest: one summary when it ends; hold: each one when it ends; drop: record only
  bypassPriority?: number; // messages at or above this generic level (0-10) are sent anyway; default 8
}
export interface RouteOptions {
  destinationIds?: number[];
  titleTemplate?: string; bodyTemplate?: string;
  priorityRules?: PriorityRule[];
  extract?: ExtractRule[];
  quiet?: QuietHours;
  digest?: { enabled: boolean; everyMinutes: number }; // batch every N minutes, always
  attachments?: { forward: boolean };
}

export interface TemplateVars {
  subject: string; from: string; to: string; body: string; route: string; date: Date; attachments: string[]; priority: number | null;
  /** extracted (or webhook) values; built-in names always win */
  extra?: Record<string, string>;
}
export const TEMPLATE_VARS = ["subject", "from", "to", "body", "route", "date", "time", "datetime", "attachments", "priority"];

/**
 * {{name}}, {{name:120}} (truncate to 120 chars) or {{name|fallback}} (used when the value is empty).
 * Unknown names stay as written, so typos are visible.
 * Plain text substitution only: no code runs, and values are not re-expanded.
 */
export function renderTemplate(tpl: string, v: TemplateVars, tz = "UTC"): string {
  const d = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(v.date);
  const vals: Record<string, string> = {
    ...(v.extra ?? {}),
    subject: v.subject, from: v.from, to: v.to, body: v.body, route: v.route,
    date: d({ year: "numeric", month: "2-digit", day: "2-digit" }), time: d({ hour: "2-digit", minute: "2-digit" }),
    datetime: d({ dateStyle: "medium", timeStyle: "short" }), attachments: v.attachments.join(", "),
    priority: v.priority === null ? "" : String(v.priority),
  };
  // Innermost first, so a fallback may itself use a variable: {{alert|{{subject}}}}. Values go into a side table
  // and are swapped in at the end, so text from a message is never parsed as a template.
  const out: string[] = [];
  // eslint-disable-next-line no-control-regex -- private placeholder/control characters are stripped on purpose
  const unref = (x: string) => x.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => out[Number(i)] ?? "");
  const RE = /\{\{\s*(\w+)(?::(\d{1,5}))?(?:\|([^{}]{0,200}))?\s*\}\}/g;
  // eslint-disable-next-line no-control-regex -- private placeholder/control characters are stripped on purpose
  let t = tpl.replace(/\u0000/g, "");
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    t = t.replace(RE, (m, k: string, n?: string, dflt?: string) => {
      const key = k.toLowerCase();
      const fb = dflt !== undefined ? unref(dflt).trim() : undefined;
      if (!(key in vals) && fb === undefined) return m.replace(/\{\{/, "\u0001").replace(/\}\}$/, "\u0002"); // unknown: keep as written
      changed = true;
      const v = (key in vals ? vals[key] : "") || fb || "";
      out.push(n && v.length > Number(n) ? v.slice(0, Number(n)) + "…" : v);
      return `\u0000${out.length - 1}\u0000`;
    });
    if (!changed) break;
  }
  // eslint-disable-next-line no-control-regex -- private placeholder/control characters are stripped on purpose
  return unref(t).replace(/\u0001/g, "{{").replace(/\u0002/g, "}}");
}

/** First matching rule wins; null when none match. Patterns are case-insensitive regexes. */
export function pickPriority(rules: PriorityRule[] | undefined, subject: string, body: string, extra: Record<string, string> = {}): number | null {
  for (const r of rules ?? []) {
    const re = trySafe(r.pattern, { ignoreCase: true });
    if (!re) continue;
    const hay = r.field === "subject" ? subject : r.field === "body" ? body : r.field.startsWith("var:") ? extra[r.field.slice(4).toLowerCase()] ?? "" : `${subject}\n${body}`;
    if (re.test(hay)) return r.priority;
  }
  return null;
}

export const VAR_NAME = /^[a-z_][a-z0-9_]{0,31}$/;
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slug = (x: string) => trimBoth(x.toLowerCase().replace(/[^a-z0-9]+/g, "_"), "_").replace(/^(\d)/, "_$1").slice(0, 32);
/** Name a rule will produce (for "field" rules without a name, the label in snake_case). */
export const extractNames = (r: ExtractRule): string[] => {
  if (r.kind === "field") return [r.name || slug(r.pattern)].filter(Boolean);
  const groups = [...r.pattern.matchAll(/\(\?P?<([A-Za-z_]\w*)>/g)].map((m) => m[1]!.toLowerCase());
  return groups.length ? groups : r.name ? [r.name] : [];
};
/**
 * Run extraction rules in order. Every declared name is present (empty when nothing matched),
 * so {{name|fallback}} works. Earlier rules win when two produce the same name. Values are trimmed and capped at 500 chars.
 */
export function extractValues(rules: ExtractRule[] | undefined, subject: string, body: string): Record<string, string> {
  const out = new Map<string, string>(); // a Map, so names like __proto__ are plain keys
  for (const r of rules ?? []) {
    for (const n of extractNames(r)) if (!out.has(n)) out.set(n, "");
    const hay = (r.field === "subject" ? subject : r.field === "body" ? body : `${subject}\n${body}`).slice(0, 64000);
    const re = trySafe(r.kind === "field" ? `^[ \\t*•-]*${escRe(r.pattern.trim())}[ \\t]*[:=][ \\t]*(.+?)[ \\t]*$` : r.pattern, { ignoreCase: true, multiline: true });
    if (!re) continue;
    const m = re.exec(hay);
    if (!m) continue;
    const put = (k: string, v: string | undefined) => { if (v !== undefined && !out.get(k)) out.set(k, v.trim().slice(0, 500)); };
    if (r.kind === "regex" && Object.keys(m.named).length) for (const [k, v] of Object.entries(m.named)) put(k.toLowerCase(), v);
    else { const n = extractNames(r)[0]; if (n) put(n, m.groups[0] ?? m.text); }
  }
  return Object.fromEntries(out);
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
function local(now: Date, tz: string): { minutes: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { minutes: Number(get("hour")) * 60 + Number(get("minute")), day };
}
const toMin = (s: string) => { const m = HM.exec(s)!; return Number(m[1]) * 60 + Number(m[2]); };

/** True while the quiet window is active. Windows that wrap midnight belong to the day they start. */
export function inQuietHours(q: QuietHours | undefined, now: Date, tz = "UTC"): boolean {
  if (!q?.enabled || !HM.test(q.start) || !HM.test(q.end)) return false;
  const { minutes, day } = local(now, tz);
  const s = toMin(q.start), e = toMin(q.end);
  const days = q.days?.length ? q.days : [0, 1, 2, 3, 4, 5, 6];
  if (s === e) return days.includes(day);
  if (s < e) return minutes >= s && minutes < e && days.includes(day);
  if (minutes >= s) return days.includes(day);
  if (minutes < e) return days.includes((day + 6) % 7);
  return false;
}

export function validateOptions(o: RouteOptions | undefined): string | null {
  if (!o) return null;
  if (o.destinationIds && (!Array.isArray(o.destinationIds) || !o.destinationIds.every((x) => Number.isInteger(x) && x > 0))) return "destinationIds must be an array of destination ids";
  if (o.destinationIds && o.destinationIds.length > 20) return "at most 20 destinations per route";
  for (const t of [o.titleTemplate, o.bodyTemplate]) if (t !== undefined && (typeof t !== "string" || t.length > 4000)) return "templates must be text up to 4000 characters";
  if (o.priorityRules) {
    if (!Array.isArray(o.priorityRules) || o.priorityRules.length > 50) return "priorityRules must be a list of up to 50 rules";
    for (const r of o.priorityRules) {
      if (!["subject", "body", "any"].includes(r.field) && !(typeof r.field === "string" && r.field.startsWith("var:") && VAR_NAME.test(r.field.slice(4)))) return "priority rule field must be subject, body, any or var:<extracted name>";
      if (typeof r.pattern !== "string" || !r.pattern || r.pattern.length > 500) return "priority rule pattern is required";
      { const err = patternError(r.pattern); if (err) return `priority rule pattern is not a valid regex: ${r.pattern} (${err})`; }
      if (!Number.isInteger(r.priority) || r.priority < 0 || r.priority > 10) return "priority rule priority must be 0-10";
    }
  }
  if (o.extract !== undefined) {
    if (!Array.isArray(o.extract) || o.extract.length > 20) return "extract must be a list of up to 20 rules";
    for (const r of o.extract) {
      if (!r || !["regex", "field"].includes(r.kind)) return "extract rule kind must be regex or field";
      if (!["subject", "body", "any"].includes(r.field)) return "extract rule field must be subject, body or any";
      if (typeof r.pattern !== "string" || !r.pattern.trim() || r.pattern.length > 500) return "extract rule pattern is required (up to 500 characters)";
      if (r.name !== undefined && r.name !== "" && !VAR_NAME.test(r.name)) return `extract name "${r.name}" must be lower-case letters, digits or _ (up to 32)`;
      if (r.kind === "regex") {
        { const err = patternError(r.pattern); if (err) return `extract regex is not valid: ${err}`; }
        if (!extractNames(r).length) return `extract regex needs a named group like (?<host>\\S+) or a name: ${r.pattern}`;
        for (const n of extractNames(r)) if (!VAR_NAME.test(n)) return `extract group name "${n}" is too long or invalid`;
      } else if (!extractNames(r).length) return `extract field "${r.pattern}" needs a name`;
    }
  }
  if (o.quiet) {
    const q = o.quiet;
    if (q.enabled && (!HM.test(q.start) || !HM.test(q.end))) return "quiet hours need start and end as HH:MM";
    if (!["digest", "hold", "drop"].includes(q.action)) return "quiet hours action must be digest, hold or drop";
    if (q.days && (!Array.isArray(q.days) || !q.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) return "quiet hours days must be 0-6";
    if (q.bypassPriority !== undefined && (!Number.isInteger(q.bypassPriority) || q.bypassPriority < 0 || q.bypassPriority > 11)) return "bypassPriority must be 0-11 (11 = never bypass)";
  }
  if (o.digest?.enabled && (!Number.isInteger(o.digest.everyMinutes) || o.digest.everyMinutes < 5 || o.digest.everyMinutes > 1440)) return "digest interval must be 5-1440 minutes";
  return null;
}
