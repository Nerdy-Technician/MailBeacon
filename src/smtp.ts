import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import { simpleParser } from "mailparser";
import type { Store } from "./db.js";
import { canAcceptRecipient, matchRoute } from "./matcher.js";
import { mapMail } from "./mapper.js";
import { deliver } from "./delivery.js";
import { loadTls } from "./tls.js";
import type { Config } from "./config.js";

export function smtpSettings(store: Store) {
  return {
    starttls: store.getSetting("smtp_starttls") === "1",
    auth: store.getSetting("smtp_auth") === "1",
  };
}

function err(code: number, msg: string): Error {
  const e = new Error(msg) as Error & { responseCode: number };
  e.responseCode = code;
  return e;
}

export function createSmtpServer(store: Store, cfg: Config): SMTPServer {
  const s = smtpSettings(store);
  const opts: SMTPServerOptions = {
    name: cfg.smtpHostname,
    banner: "MailBeacon",
    size: cfg.maxSizeBytes,
    authOptional: !s.auth,
    disabledCommands: [...(s.starttls ? [] : ["STARTTLS"]), ...(s.auth ? [] : ["AUTH"])],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username && auth.password !== undefined && store.checkSmtpUser(auth.username, auth.password)) return cb(null, { user: auth.username });
      store.log("warn", `SMTP auth failed for "${auth.username ?? ""}"`);
      cb(err(535, "Authentication failed"));
    },
    onRcptTo(addr, session, cb) {
      const sender = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
      if (canAcceptRecipient(store.listRoutes(), sender, addr.address)) return cb();
      store.log("warn", `rejected RCPT ${addr.address} from ${sender || "<>"}: no matching route`);
      cb(err(550, "5.1.1 Recipient rejected: no matching route (relay denied)"));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", async () => {
        if ((stream as unknown as { sizeExceeded?: boolean }).sizeExceeded) return cb(err(552, "5.3.4 Message exceeds size limit"));
        try {
          const mail = await simpleParser(Buffer.concat(chunks), { skipHtmlToText: true });
          const sender = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
          const recipients = session.envelope.rcptTo.map((r) => r.address);
          const route = matchRoute(store.listRoutes(), { sender, recipients, subject: mail.subject ?? "" }, { includeSubject: true });
          if (!route) {
            store.log("warn", `rejected message from ${sender}: no route after subject check`);
            return cb(err(550, "5.7.1 No matching route"));
          }
          const mapped = mapMail(mail.subject, mail.text, mail.html);
          const id = store.addMessage({
            sender, recipients: recipients.join(", "), subject: mail.subject ?? "", routeId: route.id,
            title: mapped.title, body: mapped.message, contentType: mapped.contentType,
          });
          store.log("info", `accepted message ${id} from ${sender} to ${recipients.join(", ")} -> route "${route.name}"`);
          cb();
          void deliver(store, id);
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
