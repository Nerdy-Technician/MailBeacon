import type { Role, Store, User } from "./db.js";

/** Permissions. A role grants a set; an API key is further limited to its scopes. */
export type Perm = "routes:read" | "routes:write" | "destinations:read" | "destinations:write" | "messages:read" | "messages:write" | "test:send" | "messages:send" | "account" | "admin";
/** Scopes an API key can carry ("account" is session-only: keys can't mint keys or change passwords). */
export const SCOPES: Exclude<Perm, "account">[] = ["routes:read", "routes:write", "destinations:read", "destinations:write", "messages:read", "messages:write", "test:send", "messages:send", "admin"];
const VIEWER: Perm[] = ["routes:read", "destinations:read", "messages:read", "account"];
const EDITOR: Perm[] = [...VIEWER, "routes:write", "destinations:write", "messages:write", "test:send", "messages:send"];
export const ROLE_PERMS: Record<Role, Perm[]> = { viewer: VIEWER, editor: EDITOR, admin: [...EDITOR, "admin"] };

export interface Principal { user: User; via: "session" | "key"; scopes?: string[]; keyId?: number; keyName?: string }

export function can(p: Principal | undefined, perm: Perm): boolean {
  if (!p || p.user.disabled) return false;
  if (!ROLE_PERMS[p.user.role].includes(perm)) return false;
  if (p.via === "session") return true;
  if (perm === "account") return false;
  return !!p.scopes && (p.scopes.includes(perm) || (perm.endsWith(":read") && p.scopes.includes(perm.replace(":read", ":write"))));
}
export const isAdmin = (p: Principal | undefined) => can(p, "admin");
/** undefined = see everything (admins); otherwise only rows owned by this user id. */
export const ownerScope = (p: Principal | undefined): number | undefined => (isAdmin(p) ? undefined : p?.user.id ?? -1);
export const owns = (p: Principal | undefined, ownerId: number | null | undefined) => isAdmin(p) || (!!p && ownerId === p.user.id);
export const actor = (p: Principal | undefined) => (!p ? "anonymous" : p.via === "key" ? `${p.user.username} (key "${p.keyName}")` : p.user.username);

/**
 * Who may call what. Keys are "METHOD /path" exactly as registered with Fastify. Any /api route
 * missing here needs "admin" (fail closed); a test checks every route in the OpenAPI spec is listed.
 */
export const PERMS: Record<string, Perm | "public" | "authed"> = {
  "GET /api/health": "public", "GET /api/status": "public", "POST /api/setup": "public", "POST /api/setup/complete": "admin", "POST /api/smtp/test": "admin", "POST /api/oidc/test": "admin", "POST /api/login": "public",
  "GET /api/oidc/login": "public", "GET /api/oidc/callback": "public",
  "POST /api/logout": "authed", "GET /api/me": "authed", "PUT /api/me": "account", "POST /api/me/avatar": "account", "DELETE /api/me/avatar": "account",
  "GET /api/users/:id/avatar": "authed", "GET /api/stats": "messages:read", "POST /api/password": "account",
  "GET /api/keys": "account", "POST /api/keys": "account", "DELETE /api/keys/:id": "account",
  "GET /api/users": "admin", "POST /api/users": "admin", "PUT /api/users/:id": "admin", "DELETE /api/users/:id": "admin", "POST /api/users/:id/password": "admin",
  "GET /api/audit": "admin",
  "GET /api/settings": "admin", "PUT /api/settings": "admin", "POST /api/smtp-users": "admin", "DELETE /api/smtp-users/:u": "admin",
  "GET /api/alerts": "admin", "PUT /api/alerts": "admin", "POST /api/alerts/test": "admin",
  "POST /api/config/export": "admin", "POST /api/config/import": "admin",
  "GET /api/selftest": "admin", "POST /api/selftest": "admin", "GET /api/logs": "admin",
  "GET /api/routes": "routes:read", "POST /api/routes": "routes:write", "PUT /api/routes/:id": "routes:write", "PATCH /api/routes/:id": "routes:write",
  "DELETE /api/routes/:id": "routes:write", "POST /api/routes/:id/test": "routes:write", "POST /api/routes/match-test": "routes:read",
  "POST /api/routes/reorder": "admin", "POST /api/routes/preview": "routes:read", "POST /api/templates/preview": "routes:read",
  "GET /api/destination-types": "destinations:read", "GET /api/destinations": "destinations:read", "POST /api/destinations": "destinations:write",
  "PUT /api/destinations/:id": "destinations:write", "DELETE /api/destinations/:id": "destinations:write", "POST /api/destinations/:id/test": "destinations:write",
  "POST /api/test-email": "test:send",
  "GET /api/messages": "messages:read", "GET /api/messages/export.csv": "messages:read", "GET /api/messages/filters": "messages:read", "GET /api/stats/report": "messages:read", "GET /api/retention": "admin", "PUT /api/retention": "admin", "POST /api/retention/purge": "admin", "GET /api/messages/:id": "messages:read", "DELETE /api/messages/:id": "messages:write",
  "POST /api/messages/:id/retry": "messages:write", "GET /api/messages/:id/attachments/:aid": "messages:read",
  "GET /api/dead-letters": "messages:read", "POST /api/dead-letters/retry": "messages:write",
  "POST /api/held/release": "messages:write",
  "GET /api/route-templates": "routes:read",
  "POST /api/send": "messages:send", "POST /api/webhook/:routeId": "messages:send",
  "GET /api/branding/logo": "public", "POST /api/branding/logo": "admin", "DELETE /api/branding/logo": "admin",
};

/** OIDC group → role mapping. Highest matching role wins. */
export interface RoleMapping { claim: string; admin: string[]; editor: string[]; viewer: string[]; defaultRole: Role | "none" }
const list = (v: string | undefined) => (v ?? "").split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
export function readRoleMapping(store: Store, env: NodeJS.ProcessEnv = process.env): RoleMapping {
  const m = {
    claim: env.MAILBEACON_OIDC_GROUPS_CLAIM || store.getSetting("oidc_groups_claim") || "groups",
    admin: list(env.MAILBEACON_OIDC_ADMIN_GROUPS ?? store.getSetting("oidc_admin_groups")),
    editor: list(env.MAILBEACON_OIDC_EDITOR_GROUPS ?? store.getSetting("oidc_editor_groups")),
    viewer: list(env.MAILBEACON_OIDC_VIEWER_GROUPS ?? store.getSetting("oidc_viewer_groups")),
  };
  const configured = m.admin.length + m.editor.length + m.viewer.length > 0;
  const def = (env.MAILBEACON_OIDC_DEFAULT_ROLE || store.getSetting("oidc_default_role") || "") as Role | "none" | "";
  // 0.2.0 compatibility: with no mapping at all, every allowed SSO user is an admin (as before). Once any group is mapped, unmatched users are refused.
  return { ...m, defaultRole: def || (configured ? "none" : "admin") };
}
export function claimGroups(claims: Record<string, unknown>, claim: string): string[] {
  const v = claim.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), claims);
  return Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[,\s]+/).filter(Boolean) : [];
}
export function roleFromClaims(claims: Record<string, unknown>, m: RoleMapping): Role | null {
  const g = new Set(claimGroups(claims, m.claim).map((x) => x.toLowerCase()));
  const hit = (l: string[]) => l.some((x) => g.has(x.toLowerCase()));
  if (hit(m.admin)) return "admin";
  if (hit(m.editor)) return "editor";
  if (hit(m.viewer)) return "viewer";
  return m.defaultRole === "none" ? null : m.defaultRole;
}
