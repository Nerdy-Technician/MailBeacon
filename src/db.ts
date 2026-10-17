import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { decrypt, encrypt, hashPassword, verifyPassword } from "./crypto.js";
import type { TargetConfig, TargetSecrets, TargetType } from "./targets.js";

export type MatchType = "recipient" | "sender" | "subject" | "catchall";

export interface Route {
  id: number;
  name: string;
  matchType: MatchType;
  pattern: string;
  order: number;
  gotifyUrl: string | null;
  gotifyToken: string; // decrypted in memory only
  gotifyPriority: number;
  enabled: boolean;
  targetType: TargetType;
  target: TargetConfig;
  secrets: TargetSecrets; // decrypted in memory only
}

export interface MessageRow {
  id: number;
  receivedAt: string;
  sender: string;
  recipients: string;
  subject: string;
  routeId: number | null;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastError: string | null;
  title: string;
  body: string;
  contentType: string;
}

export class Store {
  db: Database.Database;
  constructor(dataDir: string, private key: Buffer) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "mailbeacon.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, match_type TEXT NOT NULL,
        pattern TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 100, gotify_url TEXT,
        gotify_token TEXT NOT NULL, gotify_priority INTEGER NOT NULL DEFAULT 5, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS smtp_users (username TEXT PRIMARY KEY, secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, received_at TEXT NOT NULL, sender TEXT, recipients TEXT,
        subject TEXT, route_id INTEGER, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, title TEXT, body TEXT, content_type TEXT);
      CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, msg TEXT NOT NULL);
    `);
    this.migrate();
  }

  /** Schema migrations keyed on PRAGMA user_version. Existing routes stay Gotify routes. */
  private migrate() {
    const v = this.db.pragma("user_version", { simple: true }) as number;
    if (v < 1) {
      this.db.transaction(() => {
        const cols = (this.db.prepare("PRAGMA table_info(routes)").all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes("target_type")) this.db.exec("ALTER TABLE routes ADD COLUMN target_type TEXT NOT NULL DEFAULT 'gotify'");
        if (!cols.includes("target_config")) this.db.exec("ALTER TABLE routes ADD COLUMN target_config TEXT NOT NULL DEFAULT '{}'");
        if (!cols.includes("target_secret")) this.db.exec("ALTER TABLE routes ADD COLUMN target_secret TEXT");
        this.db.pragma("user_version = 1");
      })();
    }
  }

  getSecretSetting(k: string): string | undefined { const v = this.getSetting(k); return v ? decrypt(v, this.key) : undefined; }
  setSecretSetting(k: string, v: string) { if (v) this.setSetting(k, encrypt(v, this.key)); else this.deleteSetting(k); }
  deleteSetting(k: string) { this.db.prepare("DELETE FROM settings WHERE k=?").run(k); }

  // settings
  getSetting(k: string): string | undefined {
    const r = this.db.prepare("SELECT v FROM settings WHERE k=?").get(k) as { v: string } | undefined;
    return r?.v;
  }
  setSetting(k: string, v: string) {
    this.db.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v);
  }
  get gotifyUrl(): string { return this.getSetting("gotify_url") ?? ""; }
  hasAdmin(): boolean { return !!this.getSetting("admin_hash"); }
  setAdminPassword(pw: string) { this.setSetting("admin_hash", hashPassword(pw)); }
  checkAdmin(pw: string): boolean { const h = this.getSetting("admin_hash"); return !!h && verifyPassword(pw, h); }

  // routes
  private toRoute(r: Record<string, unknown>): Route {
    return {
      id: r.id as number, name: r.name as string, matchType: r.match_type as MatchType, pattern: r.pattern as string,
      order: r.sort as number, gotifyUrl: (r.gotify_url as string) || null,
      gotifyToken: decrypt(r.gotify_token as string, this.key), gotifyPriority: r.gotify_priority as number,
      enabled: !!r.enabled,
      targetType: ((r.target_type as string) || "gotify") as TargetType,
      target: JSON.parse((r.target_config as string) || "{}") as TargetConfig,
      secrets: r.target_secret ? JSON.parse(decrypt(r.target_secret as string, this.key)) as TargetSecrets : {},
    };
  }
  listRoutes(): Route[] {
    return (this.db.prepare("SELECT * FROM routes ORDER BY sort, id").all() as Record<string, unknown>[]).map((r) => this.toRoute(r));
  }
  getRoute(id: number): Route | undefined {
    const r = this.db.prepare("SELECT * FROM routes WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return r ? this.toRoute(r) : undefined;
  }
  saveRoute(r: Omit<Route, "id" | "targetType" | "target" | "secrets"> & Partial<Pick<Route, "targetType" | "target" | "secrets">> & { id?: number }): number {
    const tok = encrypt(r.gotifyToken, this.key);
    const sec = Object.keys(r.secrets ?? {}).length ? encrypt(JSON.stringify(r.secrets), this.key) : null;
    const args = [r.name, r.matchType, r.pattern, r.order, r.gotifyUrl, tok, r.gotifyPriority, r.enabled ? 1 : 0,
      r.targetType ?? "gotify", JSON.stringify(r.target ?? {}), sec];
    if (r.id) {
      this.db.prepare("UPDATE routes SET name=?,match_type=?,pattern=?,sort=?,gotify_url=?,gotify_token=?,gotify_priority=?,enabled=?,target_type=?,target_config=?,target_secret=? WHERE id=?").run(...args, r.id);
      return r.id;
    }
    return Number(this.db.prepare("INSERT INTO routes(name,match_type,pattern,sort,gotify_url,gotify_token,gotify_priority,enabled,target_type,target_config,target_secret) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(...args).lastInsertRowid);
  }
  deleteRoute(id: number) { this.db.prepare("DELETE FROM routes WHERE id=?").run(id); }
  setRouteEnabled(id: number, enabled: boolean) { this.db.prepare("UPDATE routes SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id); }
  /** Renumber routes in the given order (10, 20, 30...). Unknown ids are ignored; unlisted routes keep their order after these. */
  reorderRoutes(ids: number[]) {
    const upd = this.db.prepare("UPDATE routes SET sort=? WHERE id=?");
    this.db.transaction(() => { ids.forEach((id, i) => upd.run((i + 1) * 10, id)); })();
  }
  /** Latest message status per route, for the route list badges. */
  lastDeliveries(): Map<number, { status: MessageRow["status"]; at: string; error: string | null }> {
    const rows = this.db.prepare(`SELECT m.route_id AS id, m.status, m.received_at AS at, m.last_error AS error FROM messages m
      JOIN (SELECT route_id, MAX(id) AS mid FROM messages WHERE route_id IS NOT NULL GROUP BY route_id) l ON l.mid = m.id`).all() as { id: number; status: MessageRow["status"]; at: string; error: string | null }[];
    return new Map(rows.map((r) => [r.id, { status: r.status, at: r.at, error: r.error }]));
  }

  // smtp users: username in clear, password hash encrypted at rest
  listSmtpUsers(): string[] {
    return (this.db.prepare("SELECT username FROM smtp_users ORDER BY username").all() as { username: string }[]).map((u) => u.username);
  }
  setSmtpUser(username: string, password: string) {
    const blob = encrypt(hashPassword(password), this.key);
    this.db.prepare("INSERT INTO smtp_users(username,secret) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET secret=excluded.secret").run(username, blob);
  }
  deleteSmtpUser(username: string) { this.db.prepare("DELETE FROM smtp_users WHERE username=?").run(username); }
  checkSmtpUser(username: string, password: string): boolean {
    const r = this.db.prepare("SELECT secret FROM smtp_users WHERE username=?").get(username) as { secret: string } | undefined;
    return !!r && verifyPassword(password, decrypt(r.secret, this.key));
  }

  // messages
  private toMsg(r: Record<string, unknown>): MessageRow {
    return {
      id: r.id as number, receivedAt: r.received_at as string, sender: r.sender as string, recipients: r.recipients as string,
      subject: r.subject as string, routeId: r.route_id as number | null, status: r.status as MessageRow["status"],
      attempts: r.attempts as number, lastError: r.last_error as string | null, title: r.title as string,
      body: r.body as string, contentType: r.content_type as string,
    };
  }
  addMessage(m: Omit<MessageRow, "id" | "receivedAt" | "attempts" | "lastError" | "status">): number {
    return Number(this.db.prepare("INSERT INTO messages(received_at,sender,recipients,subject,route_id,status,title,body,content_type) VALUES(?,?,?,?,?,'pending',?,?,?)")
      .run(new Date().toISOString(), m.sender, m.recipients, m.subject, m.routeId, m.title, m.body, m.contentType).lastInsertRowid);
  }
  getMessage(id: number): MessageRow | undefined {
    const r = this.db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return r ? this.toMsg(r) : undefined;
  }
  markMessage(id: number, status: MessageRow["status"], error: string | null) {
    this.db.prepare("UPDATE messages SET status=?, last_error=?, attempts=attempts+1 WHERE id=?").run(status, error, id);
  }
  recentMessages(limit = 100): MessageRow[] {
    return (this.db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map((r) => this.toMsg(r));
  }
  failedMessages(maxAttempts: number): MessageRow[] {
    return (this.db.prepare("SELECT * FROM messages WHERE status='failed' AND attempts < ? ORDER BY id").all(maxAttempts) as Record<string, unknown>[]).map((r) => this.toMsg(r));
  }

  log(level: "info" | "warn" | "error", msg: string) {
    this.db.prepare("INSERT INTO logs(at,level,msg) VALUES(?,?,?)").run(new Date().toISOString(), level, msg);
    this.db.prepare("DELETE FROM logs WHERE id <= (SELECT MAX(id) - 2000 FROM logs)").run();
  }
  recentLogs(limit = 200) {
    return this.db.prepare("SELECT at, level, msg FROM logs ORDER BY id DESC LIMIT ?").all(limit);
  }
  close() { this.db.close(); }
}
