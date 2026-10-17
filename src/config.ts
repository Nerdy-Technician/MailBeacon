import path from "node:path";

export interface Config {
  dataDir: string;
  smtpPort: number;
  webPort: number;
  host: string;
  maxSizeBytes: number;
  smtpHostname: string;
  secret?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dataDir: path.resolve(env.MAILBEACON_DATA_DIR ?? "/data"),
    smtpPort: Number(env.MAILBEACON_SMTP_PORT ?? 2525),
    webPort: Number(env.MAILBEACON_WEB_PORT ?? 8080),
    host: env.MAILBEACON_HOST ?? "0.0.0.0",
    maxSizeBytes: Number(env.MAILBEACON_MAX_SIZE_KB ?? 1024) * 1024,
    smtpHostname: env.MAILBEACON_SMTP_HOSTNAME ?? "mailbeacon",
    secret: env.MAILBEACON_SECRET || undefined,
  };
}
