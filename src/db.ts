import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
import { decrypt, encrypt, hashPassword, verifyPassword } from "./crypto.js";
import type { TargetConfig, TargetSecrets, TargetType } from "./targets.js";
import type { RouteOptions } from "./format.js";

export type Role = "admin" | "editor" | "viewer";
export const ROLES: Role[] = ["admin", "editor", "viewer"];
export interface User {
  id: number; username: string; displayName: string; email: string | null; role: Role; hasPassword: boolean;
  oidcSub: string | null; disabled: boolean; createdAt: string; lastLogin: string | null;
  hasAvatar: boolean; pictureUrl: string | null; avatarSource: AvatarSource | null; prefs: UserPrefs;
}
export type AvatarSource = "oidc" | "gravatar" | "upload" | "initials";
export interface UserPrefs { theme?: "dark" | "light" | "system"; timezone?: string }
export interface ApiKey { id: number; userId: number; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsed: string | null; expiresAt: string | null }
export interface AuditEntry { id: number; at: string; actor: string; action: string; target: string | null; detail: string | null; ip: string | null }
export interface Destination {
  id: number; ownerId: number | null; name: string; type: TargetType; config: TargetConfig; secrets: TargetSecrets; enabled: boolean; createdAt: string;
}
export interface AttachmentMeta { id: number; filename: string; contentType: string; size: number }

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
  /** "none": no inline target, only the saved destinations in options.destinationIds */
  targetType: TargetType | "none";
  target: TargetConfig;
  secrets: TargetSecrets; // decrypted in memory only
  ownerId?: number | null;
  options?: RouteOptions;
}

export type MessageStatus = "pending" | "delivered" | "failed" | "dead" | "held" | "suppressed";
export interface MessageEvent { at: string; event: string; detail: string | null }
export interface MessageQuery {
  status?: MessageStatus; q?: string; routeId?: number; ownerId?: number; limit?: number; offset?: number;
  /** sender contains (case-insensitive) */
  sender?: string;
  /** "dest:<id>" or "route:<id>" (a route's inline target): messages that were sent, or tried, to it */
  destination?: string;
  /** ISO timestamps, inclusive from / exclusive to */
  from?: string; to?: string;
}

export interface MessageRow {
  id: number;
  receivedAt: string;
  sender: string;
  recipients: string;
  subject: string;
  routeId: number | null;
  status: MessageStatus;
  attempts: number;
  lastError: string | null;
  title: string;
  body: string;
  contentType: string;
  ownerId?: number | null;
  /** generic 0-10 level picked by the route's priority rules, null = each target's default */
  priority?: number | null;
  /** destination ids already delivered (0 = the route's inline target), so fan-out retries skip them */
  deliveredTo?: number[];
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
    if (v < 2) {
      this.db.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS message_events (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL,
          at TEXT NOT NULL, event TEXT NOT NULL, detail TEXT);
          CREATE INDEX IF NOT EXISTS message_events_msg ON message_events(message_id);
          CREATE INDEX IF NOT EXISTS messages_status ON messages(status);`);
        // failed messages that already used every attempt become dead letters
        this.db.prepare("UPDATE messages SET status='dead' WHERE status='failed' AND attempts >= 5").run();
        this.db.pragma("user_version = 2");
      })();
    }
    if (v < 3) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL DEFAULT '', email TEXT, role TEXT NOT NULL, password_hash TEXT, oidc_sub TEXT UNIQUE,
            disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT,
            avatar BLOB, avatar_type TEXT, picture_url TEXT, avatar_source TEXT, prefs TEXT NOT NULL DEFAULT '{}');
          CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
            prefix TEXT NOT NULL, hash TEXT NOT NULL, scopes TEXT NOT NULL, created_at TEXT NOT NULL, last_used TEXT, expires_at TEXT);
          CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
            target TEXT, detail TEXT, ip TEXT);
          CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
          CREATE TABLE IF NOT EXISTS destinations (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER, name TEXT NOT NULL, type TEXT NOT NULL,
            config TEXT NOT NULL DEFAULT '{}', secret TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS message_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL,
            filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL);
          CREATE INDEX IF NOT EXISTS message_attachments_msg ON message_attachments(message_id);`);
        const add = (table: string, col: string, ddl: string) => {
          const cols = (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
          if (!cols.includes(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        };
        add("routes", "owner_id", "owner_id INTEGER");
        add("routes", "options", "options TEXT NOT NULL DEFAULT '{}'");
        add("messages", "owner_id", "owner_id INTEGER");
        add("messages", "priority", "priority INTEGER");
        add("messages", "delivered_to", "delivered_to TEXT NOT NULL DEFAULT '[]'");
        // the single 0.2.0 admin password becomes user "admin", who owns everything that exists today
        const hash = this.getSetting("admin_hash");
        if (hash) {
          const id = Number(this.db.prepare("INSERT INTO users(username,display_name,role,password_hash,created_at) VALUES('admin','Administrator','admin',?,?)").run(hash, new Date().toISOString()).lastInsertRowid);
          this.db.prepare("UPDATE routes SET owner_id=? WHERE owner_id IS NULL").run(id);
          this.db.prepare("UPDATE messages SET owner_id=? WHERE owner_id IS NULL").run(id);
          this.db.prepare("INSERT INTO audit(at,actor,action,target,detail) VALUES(?,?,?,?,?)").run(new Date().toISOString(), "system", "user.migrated", "user:admin", "single admin password migrated to user admin");
        }
        this.db.pragma("user_version = 3");
      })();
    }
    if (v < 4) {
      // per-destination outcome of every delivery attempt, for the Stats page and destination filters
      this.db.exec(`CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL,
          dest_key TEXT NOT NULL, dest_name TEXT NOT NULL, at TEXT NOT NULL, ok INTEGER NOT NULL, dry_run INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS deliveries_msg ON deliveries(message_id);
        CREATE INDEX IF NOT EXISTS deliveries_at ON deliveries(at);
        CREATE INDEX IF NOT EXISTS messages_received ON messages(received_at);`);
      this.db.pragma("user_version = 4");
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
  /** True once any admin user exists (first-run setup creates one). */
  hasAdmin(): boolean { return !!this.db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get(); }
  /** 0.2.0 compatibility: sets the password of user "admin", creating it if needed. */
  setAdminPassword(pw: string) {
    const u = this.getUserByName("admin");
    if (u) this.setUserPassword(u.id, pw); else this.createUser({ username: "admin", displayName: "Administrator", role: "admin", password: pw });
  }
  checkAdmin(pw: string): boolean { return !!this.checkLogin("admin", pw); }

  // users
  private toUser(r: Record<string, unknown>): User {
    return { id: r.id as number, username: r.username as string, displayName: (r.display_name as string) || (r.username as string), email: (r.email as string) || null,
      role: r.role as Role, hasPassword: !!r.password_hash, oidcSub: (r.oidc_sub as string) || null, disabled: !!r.disabled,
      createdAt: r.created_at as string, lastLogin: (r.last_login as string) || null,
      hasAvatar: !!r.avatar_type, pictureUrl: (r.picture_url as string) || null, avatarSource: (r.avatar_source as AvatarSource) || null,
      prefs: (() => { try { return JSON.parse((r.prefs as string) || "{}") as UserPrefs; } catch { return {}; } })() };
  }
  listUsers(): User[] { return (this.db.prepare("SELECT * FROM users ORDER BY username").all() as Record<string, unknown>[]).map((r) => this.toUser(r)); }
  getUser(id: number): User | undefined { const r = this.db.prepare("SELECT * FROM users WHERE id=?").get(id) as Record<string, unknown> | undefined; return r ? this.toUser(r) : undefined; }
  getUserByName(name: string): User | undefined { const r = this.db.prepare("SELECT * FROM users WHERE username=?").get(name) as Record<string, unknown> | undefined; return r ? this.toUser(r) : undefined; }
  getUserBySub(sub: string): User | undefined { const r = this.db.prepare("SELECT * FROM users WHERE oidc_sub=?").get(sub) as Record<string, unknown> | undefined; return r ? this.toUser(r) : undefined; }
  createUser(u: { username: string; displayName?: string; email?: string | null; role: Role; password?: string; oidcSub?: string | null }): number {
    return Number(this.db.prepare("INSERT INTO users(username,display_name,email,role,password_hash,oidc_sub,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(u.username, u.displayName ?? "", u.email ?? null, u.role, u.password ? hashPassword(u.password) : null, u.oidcSub ?? null, new Date().toISOString()).lastInsertRowid);
  }
  updateUser(id: number, u: Partial<{ displayName: string; email: string | null; role: Role; disabled: boolean; oidcSub: string | null }>) {
    const sets: string[] = [], args: unknown[] = [];
    const map: [keyof typeof u, string, (v: unknown) => unknown][] = [["displayName", "display_name", (v) => v], ["email", "email", (v) => v], ["role", "role", (v) => v], ["disabled", "disabled", (v) => (v ? 1 : 0)], ["oidcSub", "oidc_sub", (v) => v]];
    for (const [k, col, f] of map) if (u[k] !== undefined) { sets.push(`${col}=?`); args.push(f(u[k])); }
    if (sets.length) this.db.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).run(...args, id);
  }
  setUserPassword(id: number, pw: string | null) { this.db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(pw ? hashPassword(pw) : null, id); }
  setAvatar(id: number, a: { type: string; data: Buffer } | null) { this.db.prepare("UPDATE users SET avatar=?, avatar_type=? WHERE id=?").run(a?.data ?? null, a?.type ?? null, id); }
  getAvatar(id: number): { type: string; data: Buffer } | undefined {
    const r = this.db.prepare("SELECT avatar, avatar_type FROM users WHERE id=? AND avatar_type IS NOT NULL").get(id) as { avatar: Buffer; avatar_type: string } | undefined;
    return r ? { type: r.avatar_type, data: r.avatar } : undefined;
  }
  setPictureUrl(id: number, url: string | null) { this.db.prepare("UPDATE users SET picture_url=? WHERE id=?").run(url, id); }
  setAvatarSource(id: number, src: AvatarSource | null) { this.db.prepare("UPDATE users SET avatar_source=? WHERE id=?").run(src, id); }
  setPrefs(id: number, p: UserPrefs) { this.db.prepare("UPDATE users SET prefs=? WHERE id=?").run(JSON.stringify(p), id); }
  touchLogin(id: number) { this.db.prepare("UPDATE users SET last_login=? WHERE id=?").run(new Date().toISOString(), id); }
  deleteUser(id: number) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM api_keys WHERE user_id=?").run(id);
      this.db.prepare("DELETE FROM users WHERE id=?").run(id);
    })();
  }
  countAdmins(): number { return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").get() as { n: number }).n; }
  /** Returns the user when the password is right and the account is enabled. Runs scrypt even for unknown users. */
  checkLogin(username: string, pw: string): User | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE username=?").get(username) as Record<string, unknown> | undefined;
    const h = (r?.password_hash as string) || "scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";
    const ok = verifyPassword(pw, h);
    return r && ok && !r.disabled ? this.toUser(r) : undefined;
  }

  // api keys: only a SHA-256 of the key is stored; the key is shown once at creation
  createApiKey(userId: number, name: string, scopes: string[], expiresAt: string | null): { id: number; key: string } {
    const secret = crypto.randomBytes(24).toString("base64url");
    const prefix = secret.slice(0, 6);
    const id = Number(this.db.prepare("INSERT INTO api_keys(user_id,name,prefix,hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?,?)")
      .run(userId, name, prefix, sha256(secret), JSON.stringify(scopes), new Date().toISOString(), expiresAt).lastInsertRowid);
    return { id, key: `mbk_${id}_${secret}` };
  }
  private toKey(r: Record<string, unknown>): ApiKey {
    return { id: r.id as number, userId: r.user_id as number, name: r.name as string, prefix: r.prefix as string, scopes: JSON.parse(r.scopes as string) as string[],
      createdAt: r.created_at as string, lastUsed: (r.last_used as string) || null, expiresAt: (r.expires_at as string) || null };
  }
  listApiKeys(userId?: number): ApiKey[] {
    const rows = (userId === undefined ? this.db.prepare("SELECT * FROM api_keys ORDER BY id").all() : this.db.prepare("SELECT * FROM api_keys WHERE user_id=? ORDER BY id").all(userId)) as Record<string, unknown>[];
    return rows.map((r) => this.toKey(r));
  }
  getApiKey(id: number): ApiKey | undefined { const r = this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(id) as Record<string, unknown> | undefined; return r ? this.toKey(r) : undefined; }
  deleteApiKey(id: number): boolean { return this.db.prepare("DELETE FROM api_keys WHERE id=?").run(id).changes > 0; }
  /** Looks up "mbk_<id>_<secret>"; constant-time compare of the hash. */
  verifyApiKey(key: string): ApiKey | undefined {
    const m = /^mbk_(\d+)_([\w-]{20,64})$/.exec(key);
    if (!m) return undefined;
    const r = this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(Number(m[1])) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    const a = Buffer.from(sha256(m[2]), "hex"), b = Buffer.from(r.hash as string, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return undefined;
    const k = this.toKey(r);
    if (k.expiresAt && Date.parse(k.expiresAt) < Date.now()) return undefined;
    this.db.prepare("UPDATE api_keys SET last_used=? WHERE id=?").run(new Date().toISOString(), k.id);
    return k;
  }

  // audit log
  audit(actor: string, action: string, target: string | null = null, detail: string | null = null, ip: string | null = null) {
    this.db.prepare("INSERT INTO audit(at,actor,action,target,detail,ip) VALUES(?,?,?,?,?,?)").run(new Date().toISOString(), actor, action, target, detail, ip);
    this.db.prepare("DELETE FROM audit WHERE id <= (SELECT MAX(id) - 20000 FROM audit)").run();
  }
  queryAudit(f: { actor?: string; action?: string; q?: string; limit?: number; offset?: number } = {}): { total: number; items: AuditEntry[] } {
    const where: string[] = [], args: unknown[] = [];
    if (f.actor) { where.push("actor=?"); args.push(f.actor); }
    if (f.action) { where.push("action LIKE ?"); args.push(f.action.replace(/\*$/, "") + "%"); }
    if (f.q) { where.push("(target LIKE ? OR detail LIKE ? OR actor LIKE ?)"); const l = `%${f.q}%`; args.push(l, l, l); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const limit = Math.max(1, Math.min(500, f.limit ?? 100)), offset = Math.max(0, f.offset ?? 0);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM audit ${w}`).get(...args) as { n: number }).n;
    const items = this.db.prepare(`SELECT * FROM audit ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as AuditEntry[];
    return { total, items };
  }

  // destinations (saved targets a route can fan out to)
  private toDest(r: Record<string, unknown>): Destination {
    return { id: r.id as number, ownerId: (r.owner_id as number) ?? null, name: r.name as string, type: r.type as TargetType,
      config: JSON.parse((r.config as string) || "{}") as TargetConfig,
      secrets: r.secret ? JSON.parse(decrypt(r.secret as string, this.key)) as TargetSecrets : {},
      enabled: !!r.enabled, createdAt: r.created_at as string };
  }
  listDestinations(ownerId?: number): Destination[] {
    const rows = (ownerId === undefined ? this.db.prepare("SELECT * FROM destinations ORDER BY name, id").all() : this.db.prepare("SELECT * FROM destinations WHERE owner_id=? ORDER BY name, id").all(ownerId)) as Record<string, unknown>[];
    return rows.map((r) => this.toDest(r));
  }
  getDestination(id: number): Destination | undefined { const r = this.db.prepare("SELECT * FROM destinations WHERE id=?").get(id) as Record<string, unknown> | undefined; return r ? this.toDest(r) : undefined; }
  saveDestination(d: Omit<Destination, "id" | "createdAt"> & { id?: number }): number {
    const sec = Object.keys(d.secrets).length ? encrypt(JSON.stringify(d.secrets), this.key) : null;
    if (d.id) {
      this.db.prepare("UPDATE destinations SET owner_id=?,name=?,type=?,config=?,secret=?,enabled=? WHERE id=?").run(d.ownerId, d.name, d.type, JSON.stringify(d.config), sec, d.enabled ? 1 : 0, d.id);
      return d.id;
    }
    return Number(this.db.prepare("INSERT INTO destinations(owner_id,name,type,config,secret,enabled,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(d.ownerId, d.name, d.type, JSON.stringify(d.config), sec, d.enabled ? 1 : 0, new Date().toISOString()).lastInsertRowid);
  }
  deleteDestination(id: number) { this.db.prepare("DELETE FROM destinations WHERE id=?").run(id); }

  // attachments
  addAttachment(messageId: number, a: { filename: string; contentType: string; content: Buffer }) {
    this.db.prepare("INSERT INTO message_attachments(message_id,filename,content_type,size,data) VALUES(?,?,?,?,?)").run(messageId, a.filename, a.contentType, a.content.length, a.content);
  }
  attachments(messageId: number): AttachmentMeta[] {
    return (this.db.prepare("SELECT id, filename, content_type AS contentType, size FROM message_attachments WHERE message_id=? ORDER BY id").all(messageId)) as AttachmentMeta[];
  }
  attachmentData(messageId: number): { filename: string; contentType: string; content: Buffer }[] {
    return (this.db.prepare("SELECT filename, content_type AS contentType, data FROM message_attachments WHERE message_id=? ORDER BY id").all(messageId) as { filename: string; contentType: string; data: Buffer }[])
      .map((r) => ({ filename: r.filename, contentType: r.contentType, content: r.data }));
  }
  getAttachment(messageId: number, id: number): { filename: string; contentType: string; content: Buffer } | undefined {
    const r = this.db.prepare("SELECT filename, content_type AS contentType, data FROM message_attachments WHERE message_id=? AND id=?").get(messageId, id) as { filename: string; contentType: string; data: Buffer } | undefined;
    return r ? { filename: r.filename, contentType: r.contentType, content: r.data } : undefined;
  }

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
      ownerId: (r.owner_id as number) ?? null,
      options: JSON.parse((r.options as string) || "{}") as RouteOptions,
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
    const id = this.saveRouteCore(r);
    if (r.ownerId !== undefined) this.db.prepare("UPDATE routes SET owner_id=? WHERE id=?").run(r.ownerId, id);
    if (r.options !== undefined) this.db.prepare("UPDATE routes SET options=? WHERE id=?").run(JSON.stringify(r.options), id);
    return id;
  }
  private saveRouteCore(r: Omit<Route, "id" | "targetType" | "target" | "secrets"> & Partial<Pick<Route, "targetType" | "target" | "secrets">> & { id?: number }): number {
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
  lastDeliveries(): Map<number, { status: MessageStatus; at: string; error: string | null }> {
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
      ownerId: (r.owner_id as number) ?? null, priority: (r.priority as number) ?? null,
      deliveredTo: JSON.parse((r.delivered_to as string) || "[]") as number[],
    };
  }
  addMessage(m: Omit<MessageRow, "id" | "receivedAt" | "attempts" | "lastError" | "status"> & { status?: MessageStatus }): number {
    return Number(this.db.prepare("INSERT INTO messages(received_at,sender,recipients,subject,route_id,status,title,body,content_type,owner_id,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(new Date().toISOString(), m.sender, m.recipients, m.subject, m.routeId, m.status ?? "pending", m.title, m.body, m.contentType, m.ownerId ?? null, m.priority ?? null).lastInsertRowid);
  }
  setDeliveredTo(id: number, ids: number[]) { this.db.prepare("UPDATE messages SET delivered_to=? WHERE id=?").run(JSON.stringify(ids), id); }
  setStatus(id: number, status: MessageStatus) { this.db.prepare("UPDATE messages SET status=? WHERE id=?").run(status, id); }
  heldMessages(routeId?: number): MessageRow[] {
    const rows = (routeId === undefined ? this.db.prepare("SELECT * FROM messages WHERE status='held' ORDER BY id").all() : this.db.prepare("SELECT * FROM messages WHERE status='held' AND route_id=? ORDER BY id").all(routeId)) as Record<string, unknown>[];
    return rows.map((r) => this.toMsg(r));
  }
  getMessage(id: number): MessageRow | undefined {
    const r = this.db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return r ? this.toMsg(r) : undefined;
  }
  markMessage(id: number, status: MessageStatus, error: string | null, countAttempt = true) {
    this.db.prepare(`UPDATE messages SET status=?, last_error=?${countAttempt ? ", attempts=attempts+1" : ""} WHERE id=?`).run(status, error, id);
  }
  /** Put a message (usually a dead letter) back in the queue with a fresh attempt budget. */
  requeueMessage(id: number): boolean {
    return this.db.prepare("UPDATE messages SET status='failed', attempts=0 WHERE id=?").run(id).changes > 0;
  }
  /** One row per destination per attempt; dest_key is "dest:<id>" or "route:<id>" (inline target). */
  recordDelivery(messageId: number, destKey: string, destName: string, ok: boolean, dryRun = false) {
    this.db.prepare("INSERT INTO deliveries(message_id,dest_key,dest_name,at,ok,dry_run) VALUES(?,?,?,?,?,?)").run(messageId, destKey, destName, new Date().toISOString(), ok ? 1 : 0, dryRun ? 1 : 0);
  }
  /**
   * Retention: delete finished messages (delivered, dead, suppressed) received before `before`, with their
   * events, attachments and delivery rows. Pending, failed (still retrying) and held mail is never touched.
   * attachmentsOnly keeps the messages and drops just their attachments.
   */
  purgeBefore(before: string, attachmentsOnly = false): { messages: number; attachments: number } {
    const sel = "SELECT id FROM messages WHERE received_at < ? AND status IN ('delivered','dead','suppressed')";
    return this.db.transaction(() => {
      const attachments = this.db.prepare(`DELETE FROM message_attachments WHERE message_id IN (${sel})`).run(before).changes;
      if (attachmentsOnly) return { messages: 0, attachments };
      this.db.prepare(`DELETE FROM message_events WHERE message_id IN (${sel})`).run(before);
      this.db.prepare(`DELETE FROM deliveries WHERE message_id IN (${sel})`).run(before);
      const messages = this.db.prepare("DELETE FROM messages WHERE received_at < ? AND status IN ('delivered','dead','suppressed')").run(before).changes;
      return { messages, attachments };
    })();
  }
  deleteMessage(id: number): boolean {
    this.db.prepare("DELETE FROM deliveries WHERE message_id=?").run(id);
    this.db.prepare("DELETE FROM message_events WHERE message_id=?").run(id);
    this.db.prepare("DELETE FROM message_attachments WHERE message_id=?").run(id);
    return this.db.prepare("DELETE FROM messages WHERE id=?").run(id).changes > 0;
  }
  addEvent(messageId: number, event: string, detail: string | null = null) {
    this.db.prepare("INSERT INTO message_events(message_id,at,event,detail) VALUES(?,?,?,?)").run(messageId, new Date().toISOString(), event, detail);
  }
  messageEvents(messageId: number): MessageEvent[] {
    return this.db.prepare("SELECT at, event, detail FROM message_events WHERE message_id=? ORDER BY id").all(messageId) as MessageEvent[];
  }
  /** Filtered, paged history. q searches sender, recipients and subject. */
  queryMessages(f: MessageQuery = {}): { total: number; items: MessageRow[] } {
    const where: string[] = []; const args: unknown[] = [];
    if (f.status) { where.push("status=?"); args.push(f.status); }
    if (f.routeId) { where.push("route_id=?"); args.push(f.routeId); }
    if (f.ownerId !== undefined) { where.push("owner_id=?"); args.push(f.ownerId); }
    if (f.q) { where.push("(sender LIKE ? OR recipients LIKE ? OR subject LIKE ?)"); const l = `%${f.q}%`; args.push(l, l, l); }
    if (f.sender) { where.push("sender LIKE ? ESCAPE '\\'"); args.push(`%${f.sender.replace(/[\\%_]/g, (c) => "\\" + c)}%`); }
    if (f.from) { where.push("received_at >= ?"); args.push(f.from); }
    if (f.to) { where.push("received_at < ?"); args.push(f.to); }
    if (f.destination) {
      const [kind, id] = f.destination.split(":");
      const legacy = kind === "dest" ? Number(id) : 0; // delivered_to holds destination ids, 0 = inline target
      const inlineRoute = kind === "route" ? " AND messages.route_id=?" : "";
      where.push(`(EXISTS (SELECT 1 FROM deliveries d WHERE d.message_id=messages.id AND d.dest_key=?) OR (EXISTS (SELECT 1 FROM json_each(messages.delivered_to) j WHERE j.value=?)${inlineRoute}))`);
      args.push(f.destination, legacy); if (inlineRoute) args.push(Number(id));
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const limit = Math.max(1, Math.min(f.limit === Infinity ? 100000 : 500, f.limit ?? 50)), offset = Math.max(0, f.offset ?? 0);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM messages ${w}`).get(...args) as { n: number }).n;
    const items = (this.db.prepare(`SELECT * FROM messages ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as Record<string, unknown>[]).map((r) => this.toMsg(r));
    return { total, items };
  }
  statusCounts(ownerId?: number): Record<MessageStatus, number> {
    const out: Record<MessageStatus, number> = { pending: 0, delivered: 0, failed: 0, dead: 0, held: 0, suppressed: 0 };
    const rows = (ownerId === undefined ? this.db.prepare("SELECT status, COUNT(*) AS n FROM messages GROUP BY status").all()
      : this.db.prepare("SELECT status, COUNT(*) AS n FROM messages WHERE owner_id=? GROUP BY status").all(ownerId)) as { status: MessageStatus; n: number }[];
    for (const r of rows) out[r.status] = r.n;
    return out;
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
