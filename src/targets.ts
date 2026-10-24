import { sendGotify } from "./gotify.js";
import { stripSlashes } from "./strings.js";

export type TargetType = "gotify" | "ntfy" | "pushover" | "apprise" | "discord" | "slack" | "telegram" | "webhook";
export const TARGET_TYPES: TargetType[] = ["gotify", "ntfy", "pushover", "apprise", "discord", "slack", "telegram", "webhook"];

/** Non-secret settings per target type (stored as JSON in clear). */
export interface TargetConfig {
  // ntfy
  ntfyUrl?: string; ntfyTopic?: string; ntfyUsername?: string; ntfyPriority?: number; ntfyMarkdown?: boolean;
  // pushover
  pushoverPriority?: number; pushoverHtml?: boolean; pushoverApiUrl?: string;
  // apprise
  appriseUrl?: string; appriseConfigKey?: string;
  // gotify (saved destinations only; inline routes use the route columns)
  gotifyUrl?: string; gotifyPriority?: number;
  // discord / slack
  discordUsername?: string; slackUsername?: string;
  // telegram
  telegramChatId?: string; telegramApiUrl?: string;
  // generic webhook
  webhookUrl?: string; webhookMethod?: "POST" | "PUT"; webhookAttachments?: boolean;
}
/** Secret settings per target type (stored AES-256-GCM encrypted). */
export interface TargetSecrets {
  ntfyToken?: string; ntfyPassword?: string;
  pushoverToken?: string; pushoverUser?: string;
  appriseUrls?: string;
  gotifyToken?: string; discordWebhookUrl?: string; slackWebhookUrl?: string; telegramBotToken?: string; webhookAuthHeader?: string;
}
export const SECRET_KEYS: (keyof TargetSecrets)[] = ["ntfyToken", "ntfyPassword", "pushoverToken", "pushoverUser", "appriseUrls",
  "gotifyToken", "discordWebhookUrl", "slackWebhookUrl", "telegramBotToken", "webhookAuthHeader"];

export interface Attachment { filename: string; contentType: string; content: Buffer }
/** priority: optional generic level 0-10 (Gotify scale) from priority rules; mapped onto each service's own scale. */
export interface Notification { title: string; message: string; contentType: string; priority?: number; attachments?: Attachment[] }

/** Which services can receive files, and how many. */
export const ATTACHMENT_SUPPORT: Record<TargetType, number> = { gotify: 0, slack: 0, ntfy: 1, pushover: 1, apprise: 10, discord: 10, telegram: 10, webhook: 10 };

/** Form schema per type, served to the UI and used for the OpenAPI enum docs. Secret fields are never returned in clear. */
export interface FieldDef { key: string; label: string; secret?: boolean; required?: boolean; kind?: "text" | "url" | "number" | "bool" | "select"; options?: string[]; help?: string; placeholder?: string }
export const TARGET_FIELDS: Record<TargetType, { label: string; attachments: number; fields: FieldDef[] }> = {
  gotify: { label: "Gotify", attachments: 0, fields: [
    { key: "gotifyUrl", label: "Server URL", kind: "url", placeholder: "blank = Gotify URL from Settings" },
    { key: "gotifyToken", label: "App token", secret: true, required: true },
    { key: "gotifyPriority", label: "Default priority (0-10)", kind: "number" }] },
  ntfy: { label: "ntfy", attachments: 1, fields: [
    { key: "ntfyUrl", label: "Server URL", kind: "url", required: true, placeholder: "https://ntfy.sh" },
    { key: "ntfyTopic", label: "Topic", required: true },
    { key: "ntfyToken", label: "Access token", secret: true }, { key: "ntfyUsername", label: "Username" },
    { key: "ntfyPassword", label: "Password", secret: true }, { key: "ntfyPriority", label: "Default priority (1-5)", kind: "number" },
    { key: "ntfyMarkdown", label: "Markdown", kind: "bool" }] },
  pushover: { label: "Pushover", attachments: 1, fields: [
    { key: "pushoverToken", label: "App token", secret: true, required: true }, { key: "pushoverUser", label: "User key", secret: true, required: true },
    { key: "pushoverPriority", label: "Default priority (-2 to 1)", kind: "number" }, { key: "pushoverHtml", label: "HTML", kind: "bool" },
    { key: "pushoverApiUrl", label: "API URL", kind: "url", placeholder: "https://api.pushover.net" }] },
  apprise: { label: "Apprise", attachments: 10, fields: [
    { key: "appriseUrl", label: "Apprise API URL", kind: "url", required: true }, { key: "appriseUrls", label: "Notification URLs", secret: true },
    { key: "appriseConfigKey", label: "Config key" }] },
  discord: { label: "Discord", attachments: 10, fields: [
    { key: "discordWebhookUrl", label: "Webhook URL", secret: true, required: true, placeholder: "https://discord.com/api/webhooks/…" },
    { key: "discordUsername", label: "Bot name", placeholder: "MailBeacon" }] },
  slack: { label: "Slack", attachments: 0, fields: [
    { key: "slackWebhookUrl", label: "Incoming webhook URL", secret: true, required: true, placeholder: "https://hooks.slack.com/services/…" },
    { key: "slackUsername", label: "Bot name", placeholder: "MailBeacon" }] },
  telegram: { label: "Telegram", attachments: 10, fields: [
    { key: "telegramBotToken", label: "Bot token", secret: true, required: true }, { key: "telegramChatId", label: "Chat ID", required: true, placeholder: "-1001234567890" },
    { key: "telegramApiUrl", label: "API URL", kind: "url", placeholder: "https://api.telegram.org" }] },
  webhook: { label: "Webhook", attachments: 10, fields: [
    { key: "webhookUrl", label: "URL", kind: "url", required: true }, { key: "webhookMethod", label: "Method", kind: "select", options: ["POST", "PUT"] },
    { key: "webhookAuthHeader", label: "Authorization header", secret: true, placeholder: "Bearer …" },
    { key: "webhookAttachments", label: "Include attachments (base64)", kind: "bool" }] },
};

/** Map a generic 0-10 level onto each service. */
export function mapPriority(type: TargetType, p: number): number {
  switch (type) {
    case "ntfy": return Math.max(1, Math.min(5, 1 + Math.round(p * 4 / 10)));
    case "pushover": return p <= 1 ? -2 : p <= 3 ? -1 : p <= 7 ? 0 : 1;
    default: return Math.max(0, Math.min(10, Math.round(p)));
  }
}
export interface TargetRoute {
  name: string; targetType: TargetType; gotifyUrl: string | null; gotifyToken: string; gotifyPriority: number;
  target: TargetConfig; secrets: TargetSecrets;
}

const clamp = (n: unknown, lo: number, hi: number, d: number) => { const v = Number(n); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
const trim = (u: string) => stripSlashes(u);
const isHttp = (u?: string) => !!u && /^https?:\/\//.test(u);
const markdownToHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

const escHtml = (t: string) => t.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

async function check(res: Response, name: string) {
  if (!res.ok) throw new Error(`${name} returned HTTP ${res.status}`);
}

/** Validate target settings; returns an error string or null. `existing` lets blank secrets mean "keep". */
export function validateTarget(type: TargetType, c: TargetConfig, s: TargetSecrets): string | null {
  switch (type) {
    case "gotify":
      if (c.gotifyUrl && !isHttp(c.gotifyUrl)) return "Gotify URL must start with http:// or https://";
      return null;
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
    case "discord":
      if (!isHttp(s.discordWebhookUrl)) return "Discord webhook URL is required";
      return null;
    case "slack":
      if (!isHttp(s.slackWebhookUrl)) return "Slack incoming webhook URL is required";
      return null;
    case "telegram":
      if (!s.telegramBotToken || !/^\d+:[\w-]{20,}$/.test(s.telegramBotToken)) return "Telegram bot token is required (looks like 123456:ABC…)";
      if (!c.telegramChatId || !/^(-?\d{1,20}|@\w{4,64})$/.test(c.telegramChatId)) return "Telegram chat ID must be a number or @channelname";
      if (c.telegramApiUrl && !isHttp(c.telegramApiUrl)) return "Telegram API URL must start with http:// or https://";
      return null;
    case "webhook":
      if (!isHttp(c.webhookUrl)) return "webhook URL must start with http:// or https://";
      if (c.webhookMethod && !["POST", "PUT"].includes(c.webhookMethod)) return "webhook method must be POST or PUT";
      if (s.webhookAuthHeader && /[\r\n]/.test(s.webhookAuthHeader)) return "Authorization header may not contain line breaks";
      return null;
  }
}

/**
 * Send one notification. Resolves to a note when attachments could not all be forwarded
 * (the service doesn't take files, or takes fewer), so the delivery log can say so.
 */
export async function sendToTarget(r: TargetRoute, globalGotifyUrl: string, n: Notification, timeoutMs = 10000): Promise<string | void> {
  const signal = AbortSignal.timeout(timeoutMs);
  const c = { ...r.target }, s = r.secrets;
  const md = n.contentType === "text/markdown";
  const files = n.attachments ?? [];
  const max = ATTACHMENT_SUPPORT[r.targetType];
  const sent = files.slice(0, max);
  const note = files.length > max ? `${files.length - max} of ${files.length} attachment(s) not forwarded: ${r.targetType} ${max ? `takes ${max}` : "doesn't take files"}` : undefined;
  if (n.priority !== undefined) {
    const p = mapPriority(r.targetType, n.priority);
    if (r.targetType === "ntfy") c.ntfyPriority = p;
    if (r.targetType === "pushover") c.pushoverPriority = p;
  }
  const blob = (a: Attachment) => new Blob([new Uint8Array(a.content)], { type: a.contentType || "application/octet-stream" });
  switch (r.targetType) {
    case "gotify":
      await sendGotify(r.gotifyUrl || globalGotifyUrl, r.gotifyToken, { ...n, priority: n.priority ?? r.gotifyPriority }, timeoutMs);
      return note;
    case "discord": {
      const payload = { username: c.discordUsername || "MailBeacon", content: `**${n.title}**\n${n.message}`.slice(0, 2000), allowed_mentions: { parse: [] } };
      let res: Response;
      if (sent.length) {
        const fd = new FormData();
        fd.set("payload_json", JSON.stringify(payload));
        sent.forEach((a, i) => fd.set(`files[${i}]`, blob(a), a.filename));
        res = await fetch(s.discordWebhookUrl!, { method: "POST", body: fd, signal });
      } else res = await fetch(s.discordWebhookUrl!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
      await check(res, "Discord");
      return note;
    }
    case "slack": {
      const text = `*${n.title}*\n${n.message}`.slice(0, 39000);
      const res = await fetch(s.slackWebhookUrl!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, username: c.slackUsername || undefined, mrkdwn: true }), signal });
      await check(res, "Slack");
      return note;
    }
    case "telegram": {
      const base = `${trim(c.telegramApiUrl || "https://api.telegram.org")}/bot${s.telegramBotToken}`;
      const quiet = n.priority !== undefined && n.priority <= 3;
      const text = `<b>${escHtml(n.title)}</b>\n${escHtml(n.message)}`.slice(0, 4096);
      await check(await fetch(`${base}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c.telegramChatId, text, parse_mode: "HTML", disable_notification: quiet }), signal }), "Telegram");
      for (const a of sent) {
        const fd = new FormData();
        fd.set("chat_id", c.telegramChatId!); fd.set("document", blob(a), a.filename); if (quiet) fd.set("disable_notification", "true");
        await check(await fetch(`${base}/sendDocument`, { method: "POST", body: fd, signal }), "Telegram");
      }
      return note;
    }
    case "webhook": {
      const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "MailBeacon" };
      if (s.webhookAuthHeader) headers.Authorization = s.webhookAuthHeader;
      const body = { title: n.title, message: n.message, contentType: n.contentType, priority: n.priority ?? null, source: "mailbeacon",
        attachments: c.webhookAttachments ? sent.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.content.length, base64: a.content.toString("base64") }))
          : files.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.content.length })) };
      await check(await fetch(c.webhookUrl!, { method: c.webhookMethod || "POST", headers, body: JSON.stringify(body), signal }), "webhook");
      return c.webhookAttachments ? note : files.length ? `${files.length} attachment(s) listed by name only (file forwarding is off for this webhook)` : undefined;
    }
    case "ntfy": {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (s.ntfyToken) headers.Authorization = `Bearer ${s.ntfyToken}`;
      else if (c.ntfyUsername) headers.Authorization = "Basic " + Buffer.from(`${c.ntfyUsername}:${s.ntfyPassword ?? ""}`).toString("base64");
      if (sent.length) {
        // ntfy takes one file per message: PUT the bytes, the text goes in headers (RFC 2047 so non-ASCII survives)
        const h2 = (v: string) => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString("base64")}?=`;
        const fh: Record<string, string> = { ...headers, "Content-Type": sent[0].contentType || "application/octet-stream",
          Filename: h2(sent[0].filename), Title: h2(n.title.slice(0, 250)), Message: h2(n.message.slice(0, 3000).replace(/\r?\n/g, "\\n")), Priority: String(clamp(c.ntfyPriority, 1, 5, 3)) };
        await check(await fetch(`${trim(c.ntfyUrl!)}/${encodeURIComponent(c.ntfyTopic!)}`, { method: "PUT", headers: fh, body: new Uint8Array(sent[0].content), signal }), "ntfy");
        return note;
      }
      const res = await fetch(trim(c.ntfyUrl!) + "/", {
        method: "POST", headers, signal,
        body: JSON.stringify({ topic: c.ntfyTopic, title: n.title, message: n.message, priority: clamp(c.ntfyPriority, 1, 5, 3), markdown: c.ntfyMarkdown !== false && md }),
      });
      await check(res, "ntfy");
      return note;
    }
    case "pushover": {
      const html = c.pushoverHtml !== false;
      const form = new URLSearchParams({
        token: s.pushoverToken!, user: s.pushoverUser!, title: n.title.slice(0, 250),
        message: (html && md ? markdownToHtml(n.message) : n.message).slice(0, 1024) || "(empty)",
        priority: String(clamp(c.pushoverPriority, -2, 1, 0)),
      });
      if (html) form.set("html", "1");
      const url = trim(c.pushoverApiUrl || "https://api.pushover.net") + "/1/messages.json";
      // Pushover takes one image up to 5 MB
      const img = files.find((a) => /^image\//.test(a.contentType) && a.content.length <= 5 * 1024 * 1024);
      if (img) {
        const fd = new FormData();
        for (const [k, v] of form) fd.set(k, v);
        fd.set("attachment", blob(img), img.filename);
        await check(await fetch(url, { method: "POST", body: fd, signal }), "Pushover");
        return files.length > 1 ? `${files.length - 1} of ${files.length} attachment(s) not forwarded: Pushover takes one image` : undefined;
      }
      await check(await fetch(url, { method: "POST", body: form, signal }), "Pushover");
      return files.length ? `${files.length} attachment(s) not forwarded: Pushover only takes images up to 5 MB` : undefined;
    }
    case "apprise": {
      const base = trim(c.appriseUrl!);
      const body: Record<string, string> = { title: n.title, body: n.message, format: md ? "markdown" : "text" };
      const url = c.appriseConfigKey ? `${base}/notify/${encodeURIComponent(c.appriseConfigKey)}` : `${base}/notify/`;
      if (!c.appriseConfigKey) body.urls = s.appriseUrls!;
      if (n.priority !== undefined && n.priority >= 8) body.type = "warning";
      if (sent.length) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(body)) fd.set(k, v);
        sent.forEach((a) => fd.append("attach", blob(a), a.filename));
        await check(await fetch(url, { method: "POST", body: fd, signal }), "Apprise");
        return note;
      }
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      await check(res, "Apprise");
      return note;
    }
  }
}
