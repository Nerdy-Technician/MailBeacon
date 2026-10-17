import { sendGotify } from "./gotify.js";

export type TargetType = "gotify" | "ntfy" | "pushover" | "apprise";
export const TARGET_TYPES: TargetType[] = ["gotify", "ntfy", "pushover", "apprise"];

/** Non-secret settings per target type (stored as JSON in clear). */
export interface TargetConfig {
  // ntfy
  ntfyUrl?: string; ntfyTopic?: string; ntfyUsername?: string; ntfyPriority?: number; ntfyMarkdown?: boolean;
  // pushover
  pushoverPriority?: number; pushoverHtml?: boolean; pushoverApiUrl?: string;
  // apprise
  appriseUrl?: string; appriseConfigKey?: string;
}
/** Secret settings per target type (stored AES-256-GCM encrypted). */
export interface TargetSecrets {
  ntfyToken?: string; ntfyPassword?: string;
  pushoverToken?: string; pushoverUser?: string;
  appriseUrls?: string;
}
export const SECRET_KEYS: (keyof TargetSecrets)[] = ["ntfyToken", "ntfyPassword", "pushoverToken", "pushoverUser", "appriseUrls"];

export interface Notification { title: string; message: string; contentType: string }
export interface TargetRoute {
  name: string; targetType: TargetType; gotifyUrl: string | null; gotifyToken: string; gotifyPriority: number;
  target: TargetConfig; secrets: TargetSecrets;
}

const clamp = (n: unknown, lo: number, hi: number, d: number) => { const v = Number(n); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
const trim = (u: string) => u.replace(/\/+$/, "");
const isHttp = (u?: string) => !!u && /^https?:\/\//.test(u);
const markdownToHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

async function check(res: Response, name: string) {
  if (!res.ok) throw new Error(`${name} returned HTTP ${res.status}`);
}

/** Validate target settings; returns an error string or null. `existing` lets blank secrets mean "keep". */
export function validateTarget(type: TargetType, c: TargetConfig, s: TargetSecrets): string | null {
  switch (type) {
    case "gotify": return null;
    case "ntfy":
      if (!isHttp(c.ntfyUrl)) return "ntfy URL must start with http:// or https://";
      if (!c.ntfyTopic || !/^[\w-]{1,64}$/.test(c.ntfyTopic)) return "ntfy topic is required (letters, digits, - and _)";
      if (c.ntfyUsername && s.ntfyToken) return "use either an ntfy token or a username/password, not both";
      return null;
    case "pushover":
      if (!s.pushoverToken || !s.pushoverUser) return "Pushover app token and user key are required";
      if (c.pushoverApiUrl && !isHttp(c.pushoverApiUrl)) return "Pushover API URL must start with http:// or https://";
      return null;
    case "apprise":
      if (!isHttp(c.appriseUrl)) return "Apprise API URL must start with http:// or https://";
      if (!s.appriseUrls === !c.appriseConfigKey) return "Apprise needs either notification URLs or a config key (one of them)";
      if (c.appriseConfigKey && !/^[\w-]{1,64}$/.test(c.appriseConfigKey)) return "Apprise config key may only contain letters, digits, - and _";
      return null;
  }
}

export async function sendToTarget(r: TargetRoute, globalGotifyUrl: string, n: Notification, timeoutMs = 10000): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  const c = r.target, s = r.secrets;
  const md = n.contentType === "text/markdown";
  switch (r.targetType) {
    case "gotify":
      return sendGotify(r.gotifyUrl || globalGotifyUrl, r.gotifyToken, { ...n, priority: r.gotifyPriority }, timeoutMs);
    case "ntfy": {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (s.ntfyToken) headers.Authorization = `Bearer ${s.ntfyToken}`;
      else if (c.ntfyUsername) headers.Authorization = "Basic " + Buffer.from(`${c.ntfyUsername}:${s.ntfyPassword ?? ""}`).toString("base64");
      const res = await fetch(trim(c.ntfyUrl!) + "/", {
        method: "POST", headers, signal,
        body: JSON.stringify({ topic: c.ntfyTopic, title: n.title, message: n.message, priority: clamp(c.ntfyPriority, 1, 5, 3), markdown: c.ntfyMarkdown !== false && md }),
      });
      return check(res, "ntfy");
    }
    case "pushover": {
      const html = c.pushoverHtml !== false;
      const form = new URLSearchParams({
        token: s.pushoverToken!, user: s.pushoverUser!, title: n.title.slice(0, 250),
        message: (html && md ? markdownToHtml(n.message) : n.message).slice(0, 1024) || "(empty)",
        priority: String(clamp(c.pushoverPriority, -2, 1, 0)),
      });
      if (html) form.set("html", "1");
      const res = await fetch(trim(c.pushoverApiUrl || "https://api.pushover.net") + "/1/messages.json", { method: "POST", body: form, signal });
      return check(res, "Pushover");
    }
    case "apprise": {
      const base = trim(c.appriseUrl!);
      const body: Record<string, string> = { title: n.title, body: n.message, format: md ? "markdown" : "text" };
      const url = c.appriseConfigKey ? `${base}/notify/${encodeURIComponent(c.appriseConfigKey)}` : `${base}/notify/`;
      if (!c.appriseConfigKey) body.urls = s.appriseUrls!;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      return check(res, "Apprise");
    }
  }
}
