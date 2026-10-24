import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import { simpleParser } from "mailparser";
import type { Store } from "./db.js";
import { canAcceptRecipient, matchRoute } from "./matcher.js";
import { mapMail } from "./mapper.js";
import { deliver, holdReason, timezone } from "./delivery.js";
import { extractValues, pickPriority, renderTemplate } from "./format.js";
import type { Route } from "./db.js";
import { readAttachmentLimits } from "./limits.js";
import { loadTls } from "./tls.js";
import { RateLimiter, readLimits } from "./limits.js";
import { counters, countReject } from "./metrics.js";
import type { Config } from "./config.js";

export function smtpSettings(store: Store) {
  return {
    starttls: store.getSetting("smtp_starttls") === "1",
    auth: store.getSetting("smtp_auth") === "1",
  };
}

type SmtpError = Error & { responseCode: number };
function err(code: number, msg: string): SmtpError {
  const e = new Error(msg) as SmtpError;
  e.responseCode = code;
  return e;
}

export interface IngestResult { ok: boolean; id?: number; code?: number; error?: string; route?: string; held?: string }

/**
 * Parse a raw message, pick its route and queue it for delivery. Shared by the SMTP listener
 * and the "send test email" endpoint, so a test takes exactly the same path as real mail.
 */
export async function ingest(store: Store, sender: string, recipients: string[], raw: Buffer, source = "smtp"): Promise<IngestResult> {
  const mail = await simpleParser(raw, { skipHtmlToText: true });
  return ingestParsed(store, { sender, recipients, source, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
}

export interface ParsedInput {
  sender: string; recipients: string[]; source: string;
  subject?: string; text?: string; html?: string | false;
  attachments?: { filename?: string; contentType?: string; content: Buffer }[];
  /** extra template variables (e.g. webhook JSON fields); extraction rules add to these */
  vars?: Record<string, string>;
  /** skip matching and use this route (HTTP API) */
  route?: Route;
  /** caller-set priority (0-10); priority rules still apply when absent */
  priority?: number | null;
}

/** Everything after parsing: routing, extraction, templates, priority, attachments, history, delivery. Shared by SMTP and the HTTP API. */
export async function ingestParsed(store: Store, input: ParsedInput): Promise<IngestResult> {
  const { sender, recipients, source } = input;
  const mail = { subject: input.subject, text: input.text, html: input.html, attachments: input.attachments ?? [] };
  const route = input.route ?? matchRoute(store.listRoutes(), { sender, recipients, subject: mail.subject ?? "" }, { includeSubject: true });
  if (!route) {
    countReject("no_route");
    store.log("warn", `rejected message from ${sender || "<>"}: no route after subject check`);
    return { ok: false, code: 550, error: "5.7.1 No matching route" };
  }
  const mapped = mapMail(mail.subject, mail.text, mail.html);
  const o = route.options ?? {};
  const tz = timezone(store);
  // attachments: keep what fits the limits, note the rest
  const lim = readAttachmentLimits(store);
  const kept: { filename: string; contentType: string; content: Buffer }[] = [];
  const notes: string[] = [];
  let total = 0;
  for (const [i, a] of (mail.attachments ?? []).entries()) {
    const name = (a.filename || `attachment-${i + 1}`).replace(/[\r\n"/\\]/g, "_").slice(0, 200);
    const size = a.content.length;
    if (!o.attachments?.forward) { notes.push(`${name}: not forwarded (attachments are off for this route)`); continue; }
    if (kept.length >= lim.maxCount) { notes.push(`${name}: skipped, over ${lim.maxCount} attachments`); continue; }
    if (size > lim.maxFileKb * 1024) { notes.push(`${name}: skipped, ${Math.ceil(size / 1024)} KB is over the ${lim.maxFileKb} KB file limit`); continue; }
    if (total + size > lim.maxTotalKb * 1024) { notes.push(`${name}: skipped, over the ${lim.maxTotalKb} KB total`); continue; }
    total += size;
    kept.push({ filename: name, contentType: a.contentType || "application/octet-stream", content: a.content });
  }
  const names = (mail.attachments ?? []).map((a, i) => a.filename || `attachment-${i + 1}`);
  const extracted = extractValues(o.extract, mail.subject ?? "", mapped.message);
  const extra = { ...(input.vars ?? {}), ...Object.fromEntries(Object.entries(extracted).filter(([k, v]) => v || !(input.vars ?? {})[k])) };
  const ruled = pickPriority(o.priorityRules, mail.subject ?? "", mapped.message, extra);
  const priority = input.priority ?? ruled;
  const vars = { subject: mail.subject ?? "", from: sender, to: recipients.join(", "), body: mapped.message, route: route.name, date: new Date(), attachments: names, priority, extra };
  const title = o.titleTemplate ? renderTemplate(o.titleTemplate, vars, tz).slice(0, 500) || mapped.title : mapped.title;
  const body = o.bodyTemplate ? renderTemplate(o.bodyTemplate, vars, tz).slice(0, 64000) || mapped.message : mapped.message;
  const hold = holdReason(route, priority, new Date(), tz);
  const id = store.addMessage({
    sender, recipients: recipients.join(", "), subject: mail.subject ?? "", routeId: route.id, ownerId: route.ownerId ?? null, priority,
    title, body, contentType: mapped.contentType, status: hold === "quiet-drop" ? "suppressed" : hold ? "held" : "pending",
  });
  for (const a of kept) store.addAttachment(id, a);
  counters.received++;
  store.addEvent(id, "received", `${source} from ${sender || "<>"} to ${recipients.join(", ")}; matched route "${route.name}"`);
  if (o.titleTemplate || o.bodyTemplate) store.addEvent(id, "template", "title/body template applied");
  const found = Object.entries(extracted).filter(([, v]) => v);
  if (o.extract?.length) store.addEvent(id, "extract", found.length ? found.map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 60) + "…" : v}`).join(", ").slice(0, 900) : "no values extracted");
  if (input.priority !== undefined && input.priority !== null) store.addEvent(id, "priority", `priority set by sender: ${priority}`);
  else if (priority !== null) store.addEvent(id, "priority", `priority rule matched: ${priority}`);
  if (kept.length) store.addEvent(id, "attachments", `${kept.length} attachment(s) stored (${Math.ceil(total / 1024)} KB)`);
  for (const nt of notes) store.addEvent(id, "attachments", nt);
  store.log("info", `accepted message ${id} from ${sender} to ${recipients.join(", ")} -> route "${route.name}"`);
  if (hold === "quiet-drop") { store.addEvent(id, "suppressed", "quiet hours: recorded but not sent"); return { ok: true, id, route: route.name, held: hold }; }
  if (hold) { store.addEvent(id, "held", hold === "digest" ? "waiting for the next digest" : `quiet hours: ${hold === "quiet-hold" ? "sent when they end" : "sent in a digest when they end"}`); return { ok: true, id, route: route.name, held: hold }; }
  void deliver(store, id);
  return { ok: true, id, route: route.name };
}

export function createSmtpServer(store: Store, cfg: Config, limiter = new RateLimiter()): SMTPServer {
  const s = smtpSettings(store);
  const perIp = new Map<string, number>();
  const reject = (reason: string, code: number, msg: string, log?: string) => {
    countReject(reason);
    if (log) store.log("warn", log);
    return err(code, msg);
  };
  const opts: SMTPServerOptions = {
    name: cfg.smtpHostname,
    banner: "MailBeacon",
    size: cfg.maxSizeBytes,
    authOptional: !s.auth,
    disabledCommands: [...(s.starttls ? [] : ["STARTTLS"]), ...(s.auth ? [] : ["AUTH"])],
    // AUTH is only ever offered after STARTTLS: credentials never cross the wire in clear text
    allowInsecureAuth: false,
    logger: false,
    onConnect(session, cb) {
      const l = readLimits(store);
      const ip = session.remoteAddress;
      if (l.maxConnections && counters.activeConnections >= l.maxConnections)
        return cb(reject("max_connections", 421, "4.7.0 Too many connections, try again later", `refused SMTP connection from ${ip}: server connection limit (${l.maxConnections}) reached`));
      if (l.maxConnectionsPerIp && (perIp.get(ip) ?? 0) >= l.maxConnectionsPerIp)
        return cb(reject("max_connections_per_ip", 421, "4.7.0 Too many connections from your address", `refused SMTP connection from ${ip}: per-IP limit (${l.maxConnectionsPerIp}) reached`));
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      counters.activeConnections++; counters.connections++;
      (session as unknown as { mbCounted?: boolean }).mbCounted = true;
      cb();
    },
    onClose(session) {
      if (!(session as unknown as { mbCounted?: boolean }).mbCounted) return;
      const ip = session.remoteAddress;
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
      counters.activeConnections = Math.max(0, counters.activeConnections - 1);
    },
    onAuth(auth, _session, cb) {
      if (auth.username && auth.password !== undefined && store.checkSmtpUser(auth.username, auth.password)) return cb(null, { user: auth.username });
      countReject("auth_failed");
      store.log("warn", `SMTP auth failed for "${auth.username ?? ""}"`);
      cb(err(535, "Authentication failed"));
    },
    onMailFrom(_addr, session, cb) {
      const l = readLimits(store);
      if (!limiter.take(session.remoteAddress, l.messagesPerMinutePerIp))
        return cb(reject("rate_limited", 450, "4.7.1 Rate limit exceeded, try again later", `rate limited ${session.remoteAddress}: over ${l.messagesPerMinutePerIp} messages per minute`));
      cb();
    },
    onRcptTo(addr, session, cb) {
      const l = readLimits(store);
      if (l.maxRecipients && session.envelope.rcptTo.length >= l.maxRecipients)
        return cb(reject("too_many_recipients", 452, `4.5.3 Too many recipients (limit ${l.maxRecipients})`));
      const sender = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
      if (canAcceptRecipient(store.listRoutes(), sender, addr.address)) return cb();
      cb(reject("no_route", 550, "5.1.1 Recipient rejected: no matching route (relay denied)", `rejected RCPT ${addr.address} from ${sender || "<>"}: no matching route`));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", async () => {
        if ((stream as unknown as { sizeExceeded?: boolean }).sizeExceeded) { countReject("too_large"); return cb(err(552, "5.3.4 Message exceeds size limit")); }
        try {
          const sender = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
          const r = await ingest(store, sender, session.envelope.rcptTo.map((x) => x.address), Buffer.concat(chunks));
          if (!r.ok) return cb(err(r.code ?? 550, r.error ?? "rejected"));
          cb();
        } catch (e) {
          cb(err(451, "4.3.0 Failed to process message: " + (e as Error).message));
        }
      });
    },
  };
  if (s.starttls) Object.assign(opts, loadTls(cfg.dataDir));
  const server = new SMTPServer(opts);
  server.on("error", (e) => store.log("error", `SMTP error: ${e.message}`));
  return server;
}
