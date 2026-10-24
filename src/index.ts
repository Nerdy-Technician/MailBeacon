import type { SMTPServer } from "smtp-server";
import { loadConfig } from "./config.js";
import { loadKey } from "./crypto.js";
import { Store } from "./db.js";
import { createSmtpServer, smtpSettings } from "./smtp.js";
import { ensureTls } from "./tls.js";
import { createWeb } from "./web.js";
import { isDryRun, startRetryLoop, startScheduler } from "./delivery.js";
import { checkAlerts } from "./alerts.js";
import { runSelfTest } from "./selftest.js";
import { retentionTick } from "./insights.js";

export async function start(cfg = loadConfig()) {
  const key = loadKey(cfg.dataDir, cfg.secret, (m) => console.warn("WARNING: " + m));
  const store = new Store(cfg.dataDir, key);
  if (process.env.MAILBEACON_GOTIFY_URL && !store.gotifyUrl) store.setSetting("gotify_url", process.env.MAILBEACON_GOTIFY_URL);

  const prepTls = async () => { if (smtpSettings(store).starttls) await ensureTls(cfg.dataDir, cfg.smtpHostname); };
  await prepTls();
  let smtp: SMTPServer = createSmtpServer(store, cfg);
  const listen = (s: SMTPServer) => new Promise<void>((res, rej) => { s.once("error", rej); s.listen(cfg.smtpPort, cfg.host, () => res()); });
  await listen(smtp);

  const web = createWeb(store, {
    smtpPort: cfg.smtpPort,
    smtpListening: () => smtp.server.listening,
    async onSmtpSettingsChanged() {
      await new Promise<void>((r) => smtp.close(() => r()));
      await prepTls();
      smtp = createSmtpServer(store, cfg);
      await listen(smtp);
      store.log("info", "SMTP listener restarted with new settings");
    },
  });
  await web.listen({ port: cfg.webPort, host: cfg.host });
  const retry = startRetryLoop(store, Number(process.env.MAILBEACON_RETRY_INTERVAL_MS) || 60000);
  const sched = startScheduler(store, Number(process.env.MAILBEACON_SCHEDULER_INTERVAL_MS) || 60000, [async () => { await checkAlerts(store); }, async () => { await retentionTick(store); }]);
  store.log("info", `MailBeacon started: SMTP :${cfg.smtpPort}, web :${cfg.webPort}`);
  console.log(`MailBeacon listening: SMTP ${cfg.host}:${cfg.smtpPort}, web http://${cfg.host}:${cfg.webPort}`);
  if (isDryRun()) console.log("DRY-RUN mode: mail is routed and recorded, but no notification is ever sent.");
  // startup self-test: logged to the Logs page and console, never blocks startup
  void runSelfTest(store).then((r) => console.log(`Self-test ${r.ok ? "passed" : "found problems"}: ` + r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ")))
    .catch((e) => console.error("Self-test crashed: " + (e as Error).message));
  if (!store.hasAdmin()) console.log("First run: open the web UI to create the first admin user.");

  return {
    store,
    async stop() {
      clearInterval(retry); clearInterval(sched);
      await web.close();
      await new Promise<void>((r) => smtp.close(() => r()));
      store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  start().then((app) => {
    const shutdown = () => app.stop().then(() => process.exit(0));
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }).catch((e) => { console.error(e); process.exit(1); });
}
