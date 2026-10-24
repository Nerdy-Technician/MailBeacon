// MailBeacon web UI. Plain JS, no build step. Every value from the server goes through esc().
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Lucide icons (ISC licence, see fonts/NOTICE), drawn at 1.75 stroke. */
const ICONS = {
  home: "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/> <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>",
  routes: "<circle cx=\"6\" cy=\"19\" r=\"3\"/> <path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\"/> <circle cx=\"18\" cy=\"5\" r=\"3\"/>",
  dest: "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\"/> <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\"/>",
  history: "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M12 6v6l4 2\"/>",
  dead: "<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\"/> <path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"/>",
  test: "<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\"/> <path d=\"m21.854 2.147-10.94 10.939\"/>",
  audit: "<path d=\"M3 5h.01\"/> <path d=\"M3 12h.01\"/> <path d=\"M3 19h.01\"/> <path d=\"M8 5h13\"/> <path d=\"M8 12h13\"/> <path d=\"M8 19h13\"/>",
  logs: "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/> <path d=\"M10 9H8\"/> <path d=\"M16 13H8\"/> <path d=\"M16 17H8\"/>",
  settings: "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"/> <circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  user: "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/> <circle cx=\"12\" cy=\"7\" r=\"4\"/>",
  key: "<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\"/> <circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>",
  out: "<path d=\"m16 17 5-5-5-5\"/> <path d=\"M21 12H9\"/> <path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"/>",
  plus: "<path d=\"M5 12h14\"/> <path d=\"M12 5v14\"/>",
  x: "<path d=\"M18 6 6 18\"/> <path d=\"m6 6 12 12\"/>",
  retry: "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/> <path d=\"M3 3v5h5\"/>",
  theme: "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\"/>",
  stats: "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/> <path d=\"M18 17V9\"/> <path d=\"M13 17V5\"/> <path d=\"M8 17v-3\"/>",
  download: "<path d=\"M12 15V3\"/> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/> <path d=\"m7 10 5 5 5-5\"/>",
  check: "<path d=\"M20 6 9 17l-5-5\"/>",
  clock: "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M12 6v6l4 2\"/>",
  pause: "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/> <rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\"/>",
  alert: "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/> <path d=\"M12 9v4\"/> <path d=\"M12 17h.01\"/>",
  chev: "<path d=\"m9 18 6-6-6-6\"/>",
  eye: "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"/> <circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  search: "<path d=\"m21 21-4.34-4.34\"/> <circle cx=\"11\" cy=\"11\" r=\"8\"/>",
  filter: "<path d=\"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z\"/>",
  mail: "<path d=\"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7\"/> <rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/>",
  belloff: "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\"/> <path d=\"M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742\"/> <path d=\"m2 2 20 20\"/> <path d=\"M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05\"/>",
  activity: "<path d=\"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2\"/>",
  xc: "<path d=\"M18 6 6 18\"/> <path d=\"m6 6 12 12\"/>",
  shield: "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/>",
  sun: "<circle cx=\"12\" cy=\"12\" r=\"4\"/> <path d=\"M12 2v2\"/> <path d=\"M12 20v2\"/> <path d=\"m4.93 4.93 1.41 1.41\"/> <path d=\"m17.66 17.66 1.41 1.41\"/> <path d=\"M2 12h2\"/> <path d=\"M20 12h2\"/> <path d=\"m6.34 17.66-1.41 1.41\"/> <path d=\"m19.07 4.93-1.41 1.41\"/>",
  monitor: "<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\"/> <line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\"/> <line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\"/>",
  menu: "<path d=\"M4 5h16\"/> <path d=\"M4 12h16\"/> <path d=\"M4 19h16\"/>",
  trash: "<path d=\"M10 11v6\"/> <path d=\"M14 11v6\"/> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/> <path d=\"M3 6h18\"/> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>",
  edit: "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/> <path d=\"m15 5 4 4\"/>",
  copy: "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"/> <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>",
  upload: "<path d=\"M12 3v12\"/> <path d=\"m17 8-5-5-5 5\"/> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/>",
  book: "<path d=\"M12 5v16\"/> <path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\"/>",
  code: "<path d=\"m16 18 6-6-6-6\"/> <path d=\"m8 6-6 6 6 6\"/>",
  zap: "<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\"/>",
  play: "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\"/>",
  arrow: "<path d=\"M5 12h14\"/> <path d=\"m12 5 7 7-7 7\"/>",
  info: "<circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M12 16v-4\"/> <path d=\"M12 8h.01\"/>",
  lock: "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\"/> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/>",
  users: "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/> <path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/> <path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/> <circle cx=\"9\" cy=\"7\" r=\"4\"/>",
  palette: "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"/> <circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/> <circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/> <circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/> <circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>",
  database: "<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"/> <path d=\"M3 5V19A9 3 0 0 0 21 19V5\"/> <path d=\"M3 12A9 3 0 0 0 21 12\"/>",
  sliders: "<path d=\"M10 5H3\"/> <path d=\"M12 19H3\"/> <path d=\"M14 3v4\"/> <path d=\"M16 17v4\"/> <path d=\"M21 12h-9\"/> <path d=\"M21 19h-5\"/> <path d=\"M21 5h-7\"/> <path d=\"M8 10v4\"/> <path d=\"M8 12H3\"/>",
  layout: "<rect width=\"18\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\"/> <rect width=\"9\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\"/> <rect width=\"5\" height=\"7\" x=\"16\" y=\"14\" rx=\"1\"/>",
  gauge: "<path d=\"m12 14 4-4\"/> <path d=\"M3.34 19a10 10 0 1 1 17.32 0\"/>",
};
/** Service logos (selfh.st icons, bundled in /icons; see icons/NOTICE.md). */
const SERVICES = ["gotify", "ntfy", "pushover", "discord", "slack", "telegram", "apprise", "webhook"];
const SERVICE_ICON = (type, cls = "") => SERVICES.includes(type) ? `<img class="svc ${cls}" src="/icons/${type}.svg" alt="" width="16" height="16">` : "";
const SERVICE_LIST = "Gotify, ntfy, Pushover, Discord, Slack, Telegram, Apprise (100+ more services) and webhooks";
/** Card-style service picker; the radios are named "type". */
const servicePicker = (types, sel, disabled = false) => `<div class="svc-pick" role="radiogroup" aria-label="Service">${Object.entries(types).map(([k, v]) => `<label class="svc-card"><input type="radio" name="type" value="${k}" ${k === sel ? "checked" : ""} ${disabled ? "disabled" : ""}>${SERVICE_ICON(k, "lg")}<span>${esc(v.label)}</span><small>${v.attachments ? `${v.attachments === 1 ? "1 file" : "files"}` : "text"}</small></label>`).join("")}</div>`;
const icon = (n, cls = "") => `<svg class="i${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;

async function apiRaw(method, url, body, headers = {}) {
  const isJson = body !== undefined && !(body instanceof Blob);
  const res = await fetch(url, { method, headers: { "X-MailBeacon": "1", ...(isJson ? { "Content-Type": "application/json" } : {}), ...headers }, body: isJson ? JSON.stringify(body) : body });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/login") && !url.startsWith("/api/password")) { boot(); throw new Error("unauthorised"); }
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return { data, total: Number(res.headers.get("X-Total-Count") || 0) };
}
const api = async (m, u, b, h) => (await apiRaw(m, u, b, h)).data;
function toast(msg, bad = false) {
  const box = $("#toasts");
  while (box.children.length >= 4) box.firstElementChild.remove();
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : ""); t.setAttribute("role", bad ? "alert" : "status");
  t.innerHTML = `<span class="mk" aria-hidden="true"></span><span class="tm"></span><button type="button" class="tx" aria-label="Dismiss">${icon("x")}</button>`;
  $(".tm", t).textContent = msg;
  let timer;
  const arm = () => { timer = setTimeout(() => t.remove(), bad ? 8000 : 5000); };
  t.addEventListener("mouseenter", () => clearTimeout(timer)); t.addEventListener("mouseleave", arm);
  t.addEventListener("focusin", () => clearTimeout(timer));
  $(".tx", t).addEventListener("click", () => t.remove());
  box.append(t); arm();
}
/** Wraps a handler: stops form submits, shows errors as toasts, and marks the clicked or submitting button busy. */
const run = (fn) => async (e) => {
  if (e?.type === "submit") e.preventDefault();
  const btn = e?.type === "submit" ? (e.submitter || $("[type=submit]", e.target) || (e.target.id && $(`[form="${e.target.id}"][type=submit]`))) : e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null;
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
  try { await fn(e); } catch (err) { if (err.message !== "unauthorised") toast(err.message, true); }
  finally { if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); } }
};
/** Empty state: what this is, why it's empty, and what to do next (only if this user can). */
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const kpi = (label, value, sub, crit, ic = "activity", tone = "") => `<div class="stat"><div class="ki ${crit ? "crit" : tone}">${icon(ic)}</div><div class="value${crit ? " crit" : ""}">${value}</div><div class="label">${label}</div><div class="sub">${sub}</div></div>`;
const emptyState = (title, text = "", action = "") => `<div class="empty"><div class="et">${esc(title)}</div>${text ? `<div class="ed">${text}</div>` : ""}${action ? `<div class="ea">${action}</div>` : ""}</div>`;
const loadingState = () => '<div class="panel" aria-busy="true"><div class="empty"><span class="spinner" aria-hidden="true"></span><div class="et">Loading…</div></div></div>';

let ME = null, STATUS = null;
function setStatus(s) { STATUS = s; ME = s ? s.user : null; }
window.setStatus = setStatus; // used by wizard.js
const tz = () => ME?.prefs?.timezone || undefined;
const fmtTime = (iso) => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso)) : "";
const fmtDate = (iso) => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz(), day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`; if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
const STATUS_MAP = { delivered: ["ok", "Delivered"], pending: ["info", "Pending"], failed: ["warn", "Failed"], dead: ["crit", "Dead letter"], held: ["info", "Held"], suppressed: ["", "Suppressed"] };
const status = (s) => { const [c, w] = STATUS_MAP[s] || ["", s]; return `<span class="st ${c}"><span class="mk"></span>${esc(w)}</span>`; };
const healthSt = (h, enabled = true) => !enabled ? `<span class="st"><span class="mk"></span>Disabled</span>`
  : !h ? `<span class="st"><span class="mk"></span>No deliveries yet</span>`
  : h.failures >= 3 ? `<span class="st crit"><span class="mk"></span>Unreachable</span>`
  : h.failures > 0 ? `<span class="st warn"><span class="mk"></span>Failing</span>` : `<span class="st ok"><span class="mk"></span>Healthy</span>`;
const can = (p) => !!ME?.perms?.includes(p);
const isAdmin = () => can("admin");

function avatarHtml(a, cls = "") {
  const ini = esc(a?.initials || "?");
  if (!a?.url) return `<span class="avatar ${cls}" aria-hidden="true">${ini}</span>`;
  return `<span class="avatar ${cls}">${ini}<img src="${esc(a.url)}" alt="" referrerpolicy="no-referrer" loading="lazy"></span>`;
}
// Gravatar d=404 or a dead OIDC picture: drop the image, the initials underneath show through
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.parentElement?.classList.contains("avatar")) img.remove();
}, true);

function applyTheme() {
  const pref = ME?.prefs?.theme || STATUS?.defaultTheme || localStorage.getItem("mb-theme") || "dark";
  const t = pref === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = t;
  localStorage.setItem("mb-theme", pref);
}
applyTheme();
/** White-label: app name and logo from /api/status, used in every .brand, the page title and the favicon. */
const appName = () => STATUS?.appName || "MailBeacon";
const brandHtml = () => `<img src="${esc(STATUS?.logoUrl || "/favicon.svg")}" alt=""> ${esc(appName())}`;
function applyBrand() {
  $$(".brand").forEach((b) => (b.innerHTML = brandHtml()));
  $$('link[rel="icon"]').forEach((l) => { if (STATUS?.logoUrl) { l.href = STATUS.logoUrl; l.type = "image/png"; } else { l.href = l.sizes?.value ? "/favicon.ico" : "/favicon.svg"; l.type = l.sizes?.value ? "" : "image/svg+xml"; } });
  if (!/ · /.test(document.title)) document.title = appName();
}

const PAGES = [
  { id: "home", label: "Home", icon: "home", perm: "messages:read", group: "Overview" },
  { id: "routes", label: "Routes", icon: "routes", perm: "routes:read", group: "Mail" },
  { id: "destinations", label: "Destinations", icon: "dest", perm: "destinations:read", group: "Mail" },
  { id: "history", label: "History", icon: "history", perm: "messages:read", group: "Mail" },
  { id: "stats", label: "Stats", icon: "stats", perm: "messages:read", group: "Mail" },
  { id: "dead", label: "Dead letters", icon: "dead", perm: "messages:read", group: "Mail" },
  { id: "test", label: "Test email", icon: "test", perm: "test:send", group: "Mail" },
  { id: "audit", label: "Audit log", icon: "audit", perm: "admin", group: "System" },
  { id: "logs", label: "Logs", icon: "logs", perm: "admin", group: "System" },
  { id: "settings", label: "Settings", icon: "settings", perm: "admin", group: "System" },
];
let navCounts = {};
function renderNav(active) {
  let html = "", group = "";
  for (const p of PAGES.filter((x) => can(x.perm))) {
    if (p.group !== group) { if (group) html += "</div>"; group = p.group; html += `<div class="nav-group"><div class="nav-label">${esc(group)}</div>`; }
    const c = navCounts[p.id];
    html += `<a class="item${p.id === active ? " active" : ""}" href="#/${p.id}"${p.id === active ? ' aria-current="page"' : ""}>${icon(p.icon)}<span>${esc(p.label)}</span>${c ? `<span class="count${p.id === "dead" ? " crit" : ""}">${c}</span>` : ""}</a>`;
  }
  $("#navItems").innerHTML = html + "</div>";
}
function renderAvatarBtn() {
  $("#avatarBtn").innerHTML = `${avatarHtml(ME.avatar)}<span class="who"><span>${esc(ME.displayName)}</span><small>${esc(ME.role)}</small></span>`;
}
function setHeader(title, statusLine = "", actions = "") {
  $("#pageTitle").textContent = title;
  $("#pageStatus").innerHTML = statusLine ? "· " + statusLine : "";
  $("#pageActions").innerHTML = actions;
  fitHeader();
  document.title = `${title} · ${appName()}`;
}
/** Phone widths: page actions collapse into a "⋯" menu; the primary action stays visible as an icon button. */
const PHONE = window.matchMedia("(max-width: 600px)");
function fitHeader() {
  const acts = $$("#pageActions > .btn, #pageActions > a.btn, #pageActions .seg .btn");
  const phone = PHONE.matches && acts.length > 0;
  const keep = phone ? acts.find((b) => b.classList.contains("primary")) : null;
  $("#app").classList.toggle("hdr-compact", phone);
  $$("#pageActions .keep").forEach((b) => b.classList.remove("keep"));
  keep?.classList.add("keep");
  $("#moreBtn").hidden = !phone || acts.every((b) => b === keep);
}
PHONE.addEventListener("change", fitHeader);
$("#moreBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const m = $("#menu");
  if (!m.hidden && m.dataset.kind === "more") { m.hidden = true; return; }
  const acts = $$("#pageActions > .btn:not(.keep), #pageActions > a.btn:not(.keep), #pageActions .seg .btn");
  m.dataset.kind = "more";
  m.innerHTML = acts.map((b, i) => `<button type="button" role="menuitem" data-i="${i}"${b.disabled ? " disabled" : ""}${b.classList.contains("on") ? ' aria-current="true"' : ""}>${b.querySelector("svg")?.outerHTML || icon(b.classList.contains("on") ? "check" : "chev")}${esc(b.textContent.trim())}</button>`).join("");
  m.classList.add("more-menu"); m.hidden = false;
  $$("button", m).forEach((x) => x.addEventListener("click", () => { m.hidden = true; acts[Number(x.dataset.i)].click(); }));
  m.querySelector("button:not([disabled])")?.focus();
});
function setTabs(tabs, active, base) {
  $("#tabs").innerHTML = tabs ? `<div class="tabbar"><div class="tabs">${tabs.map(([id, l]) => `<button type="button" data-href="#/${base}/${id}" class="${id === active ? "active" : ""}">${esc(l)}</button>`).join("")}</div></div>` : "";
  $$("#tabs .tabs button").forEach((b) => b.addEventListener("click", () => (location.hash = b.dataset.href)));
}
$("#avatarBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const m = $("#menu");
  if (!m.hidden && m.dataset.kind === "account") { m.hidden = true; return; }
  m.dataset.kind = "account"; m.classList.remove("more-menu");
  m.innerHTML = `<div class="mh"><div style="display:flex;gap:8px;align-items:center">${avatarHtml(ME.avatar)}<div><div>${esc(ME.displayName)}</div><div class="faint small">${esc(ME.username)} · ${esc(ME.role)}${ME.sso ? " · SSO" : ""}</div></div></div></div>
    <button type="button" data-a="profile">${icon("user")}Profile</button>
    <button type="button" data-a="keys">${icon("key")}API keys</button>
    <button type="button" data-a="theme">${icon("theme")}Theme: ${esc(ME.prefs?.theme || "dark")}</button>
    <hr><button type="button" data-a="logout">${icon("out")}Sign out</button>`;
  m.hidden = false;
  $$("button", m).forEach((b) => b.addEventListener("click", run(async () => {
    m.hidden = true;
    if (b.dataset.a === "profile") openProfile("profile");
    if (b.dataset.a === "keys") openProfile("keys");
    if (b.dataset.a === "theme") { const order = ["dark", "light", "system"]; const next = order[(order.indexOf(ME.prefs?.theme || STATUS?.defaultTheme || "dark") + 1) % 3]; ME = await api("PUT", "/api/me", { prefs: { theme: next } }); applyTheme(); }
    if (b.dataset.a === "logout") signOut();
  })));
});
document.addEventListener("click", (e) => { if (!$("#menu").contains(e.target)) $("#menu").hidden = true; });
async function signOut() { await api("POST", "/api/logout").catch(() => {}); ME = null; location.hash = ""; boot(); }

async function boot() {
  try { STATUS = await fetch("/api/status").then((r) => { if (!r.ok) throw new Error(); return r.json(); }); }
  catch {
    // offline (the service worker served the shell): say so instead of a blank page
    $("#app").hidden = true; $("#wizard").hidden = true; $("#auth").hidden = false;
    $("#authTitle").textContent = "You're offline"; $("#authHelp").textContent = "The app will load when the connection is back."; $("#authForm").hidden = true; $("#ssoWrap").hidden = true;
    window.addEventListener("online", () => location.reload(), { once: true });
    return;
  }
  applyBrand(); applyTheme();
  const v = await fetch("/api/health").then((r) => r.json()).catch(() => ({}));
  $("#footVersion").textContent = v.version ? "v" + v.version : "";
  registerSW(v.version);
  if (!STATUS.authed) return showAuth();
  ME = STATUS.user; applyTheme();
  $("#auth").hidden = true; $("#wizard").hidden = true; $("#app").hidden = false;
  renderAvatarBtn();
  api("GET", "/api/stats").then((s) => ($("#dryRunBanner").hidden = !s.dryRun)).catch(() => {});
  refreshFooter(); route();
}
function showAuth() {
  $("#app").hidden = true; $("#wizard").hidden = true;
  // A fresh install (no users at all) gets the first-run wizard. Never once any user exists: the server refuses /api/setup then too.
  if (STATUS.needsSetup) { $("#auth").hidden = true; return startWizard({ fresh: true }); }
  $("#auth").hidden = false;
  const setup = !STATUS.setupDone;
  $("#authTitle").textContent = setup ? "Create the first admin" : "Sign in";
  $("#authHelp").textContent = setup ? "This account manages users, routes and settings. Choose a password of at least 8 characters." : "";
  $("#authForm").dataset.mode = setup ? "setup" : "login";
  $("#authForm button").textContent = setup ? "Create admin" : "Sign in";
  $("#authPw").autocomplete = setup ? "new-password" : "current-password";
  $("#ssoWrap").hidden = !STATUS.oidc || setup;
  $("#authForm").hidden = !setup && STATUS.localLogin === false;
  $("#authMsg").textContent = new URLSearchParams(location.search).get("login_error") || "";
}
$("#authForm").addEventListener("submit", run(async (e) => {
  const f = e.target; const mode = f.dataset.mode;
  try { await api("POST", mode === "setup" ? "/api/setup" : "/api/login", { username: f.username.value.trim(), password: f.password.value }); }
  catch (err) { $("#authMsg").textContent = err.message === "unauthorised" ? "Wrong user name or password." : err.message; return; }
  f.password.value = ""; history.replaceState(null, "", "/"); boot();
}));
async function refreshFooter() {
  try {
    const s = await api("GET", "/api/stats?range=24h");
    const all = [...s.destinations, ...s.routes];
    const bad = s.deadLetters.total > 0 || all.some((d) => d.enabled && d.health?.failures >= 3) || (s.selfTest && !s.selfTest.ok);
    const warn = s.counts.failed > 0 || all.some((d) => d.enabled && d.health?.failures > 0);
    $("#footHealth").className = "st " + (bad ? "crit" : warn ? "warn" : "ok");
    $("#footHealth").innerHTML = `<span class="mk"></span><span>${bad ? "Needs attention" : warn ? "Degraded" : "Healthy"}</span>`;
    $("#footHealth").title = `${s.counts.delivered} delivered · ${s.counts.failed} failed · ${s.deadLetters.total} dead letters`;
    navCounts = { dead: s.deadLetters.total || 0 };
    renderNav(currentPage);
  } catch { /* best effort */ }
}
setInterval(() => { if (ME) refreshFooter(); }, 30000);

let currentPage = "home", routeSeq = 0;
const VIEWS = {};
function route() {
  if (!ME) return;
  const [page = "home", sub = ""] = location.hash.replace(/^#\/?/, "").split("/");
  const p = PAGES.find((x) => x.id === page && can(x.perm)) || PAGES.find((x) => can(x.perm));
  currentPage = p.id; renderNav(p.id); setTabs(null);
  $("#content").innerHTML = loadingState();
  window.scrollTo(0, 0); $("#app").classList.remove("nav-open");
  const seq = ++routeSeq;
  VIEWS[p.id](sub).catch((err) => {
    if (err.message === "unauthorised" || seq !== routeSeq) return;
    $("#content").innerHTML = `<div class="panel">${emptyState(`Couldn't load ${p.label.toLowerCase()}`, esc(err.message), '<button class="btn" type="button" id="retryView">' + icon("retry") + "Try again</button>")}</div>`;
    $("#retryView").addEventListener("click", route);
  });
}
let LAST_HASH = location.hash, SKIP_GUARD = false;
window.addEventListener("hashchange", async () => {
  if (SKIP_GUARD) { SKIP_GUARD = false; LAST_HASH = location.hash; return; }
  if (dirtyForms().length) {
    const target = location.hash;
    SKIP_GUARD = true; location.hash = LAST_HASH; // stay put while asking
    if (!(await confirmDlg("Leave without saving?", "You have unsaved changes on this page. They will be lost.", "Leave without saving"))) return;
    $$("form[data-track]").forEach((f) => { delete f.dataset.track; });
    SKIP_GUARD = false; location.hash = target; return;
  }
  LAST_HASH = location.hash; route();
});

let homeRange = "24h";
function chartSvg(buckets, range) {
  const W = Math.max(400, ($("#content")?.clientWidth || 900) - 58), H = 180, pl = 28, pb = 18, pt = 8;
  const max = Math.max(1, ...buckets.map((b) => b.delivered + b.failed));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const bw = (W - pl) / buckets.length;
  const y = (v) => H - pb - (v / nice) * (H - pb - pt);
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = Math.round((nice / 4) * i); const yy = y(v); g += `<line x1="${pl}" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--divider)"/><text x="${pl - 6}" y="${yy + 3}" text-anchor="end" font-size="10" fill="var(--text-3)">${v}</text>`; }
  buckets.forEach((b, i) => {
    const x = pl + i * bw + bw * 0.18, w = bw * 0.64;
    const yd = y(b.delivered), yf = y(b.delivered + b.failed);
    if (b.delivered) g += `<rect x="${x}" y="${yd}" width="${w}" height="${H - pb - yd}" fill="var(--chart-ok)"><title>${b.delivered} delivered</title></rect>`;
    if (b.failed) g += `<rect x="${x}" y="${yf}" width="${w}" height="${yd - yf}" fill="var(--crit)"><title>${b.failed} failed</title></rect>`;
    const d = new Date(b.start);
    const lbl = range === "24h" ? (i % 3 === 0 ? new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit" }).format(d) : "") : new Intl.DateTimeFormat("en-GB", { timeZone: tz(), weekday: "short" }).format(d);
    if (lbl) g += `<text x="${x + w / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--text-3)">${lbl}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Delivered and failed messages">${g}</svg>`;
}
VIEWS.home = async () => {
  const [s, hRoutes] = await Promise.all([api("GET", `/api/stats?range=${homeRange}`), can("routes:read") ? api("GET", "/api/routes").catch(() => []) : []]);
  const c = s.counts;
  const sum = s.buckets.reduce((a, b) => ({ d: a.d + b.delivered, f: a.f + b.failed }), { d: 0, f: 0 });
  const rate = sum.d + sum.f ? Math.round((sum.d / (sum.d + sum.f)) * 1000) / 10 : null;
  const targets = [...s.destinations.map((d) => ({ ...d, kind: "Destination" })), ...s.routes.map((r) => ({ ...r, kind: "Inline on a route" }))];
  const unhealthy = targets.filter((t) => t.enabled && t.health?.failures >= 3).length;
  setHeader("Home", `${plural(s.routeCount, "route")} · ${plural(targets.length, "destination")} · updated ${fmtTime(new Date().toISOString())}`,
    `${can("test:send") ? `<a class="btn" href="#/test">${icon("test")}Send test email</a>` : ""}${can("routes:write") ? `<a class="btn primary" href="#/routes/new">${icon("plus")}Add route</a>` : ""}`);
  const dl = s.deadLetters;
  $("#content").innerHTML = `
    ${dl.total ? `<div class="crit-banner" role="alert">${icon("alert")}<span class="t"><b>${dl.total} dead letter${dl.total === 1 ? "" : "s"}.</b> These used every retry and were not delivered. Latest: ${esc(dl.items[0]?.subject || "(no subject)")} — ${esc(dl.items[0]?.lastError || "")}</span><a class="btn sm" href="#/dead">Review ${icon("chev")}</a></div>` : ""}
    <div class="stats">
      ${kpi("Delivered", c.delivered, `${sum.d} in last ${homeRange}`, false, "check", "ok")}
      ${kpi("Failed (retrying)", c.failed, "retried every minute", false, "clock", "warn")}
      ${kpi("Dead letters", c.dead, c.dead ? "action needed" : "none", c.dead > 0, "alert")}
      ${kpi("Held", c.held, "quiet hours / digests", false, "pause", "held")}
      ${kpi("Success rate", rate === null ? "—" : rate + "%", `last ${homeRange}`, rate !== null && rate < 90, "gauge")}
      ${kpi("Unreachable destinations", unhealthy, `${targets.length} total`, unhealthy > 0, "zap")}
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Delivered and failed</h2><span class="count">${sum.d} delivered · ${sum.f} failed</span>
        <div class="right"><div class="seg">${["24h", "7d"].map((r) => `<button type="button" data-range="${r}" class="btn sm${r === homeRange ? " on" : " quiet"}">${r === "24h" ? "24 hours" : "7 days"}</button>`).join("")}</div></div></div>
      <div class="chart">${chartSvg(s.buckets, homeRange)}<div class="legend"><span><span class="sw" style="background:var(--chart-ok)"></span>Delivered</span><span><span class="sw" style="background:var(--crit)"></span>Failed or dead</span><span class="faint">Times in ${esc(tz() || Intl.DateTimeFormat().resolvedOptions().timeZone)}</span></div></div>
    </div>
    <div class="grid-55">
      <div class="panel"><div class="panel-head"><h2>Recent deliveries</h2><span class="count">${s.recent.length}</span><a class="link" href="#/history">History ›</a></div>
        ${s.recent.length ? `<table class="t"><thead><tr><th>Status</th><th>Subject</th><th>Route</th><th class="num">Received</th><th class="num">Age</th></tr></thead><tbody>
        ${s.recent.map((m) => `<tr class="click" data-msg="${m.id}"><td>${status(m.status)}</td><td class="clip">${esc(m.subject || "(no subject)")}<div class="faint small">${esc(m.sender || "")}</div></td><td class="clip">${esc(m.route || "—")}</td><td class="num nowrap">${fmtDate(m.receivedAt)}</td><td class="num">${ago(m.receivedAt)}</td></tr>`).join("")}
        </tbody></table>` : emptyState("No mail received yet", "Point a device's SMTP settings at MailBeacon and its mail shows up here.", can("test:send") ? '<a class="btn sm" href="#/test">Send a test email</a>' : "")}</div>
      <div class="panel"><div class="panel-head"><h2>Destination health</h2><span class="count">${targets.length}</span>${can("destinations:read") ? '<a class="link" href="#/destinations">Destinations ›</a>' : ""}</div>
        ${targets.length ? `<table class="t"><thead><tr><th>Destination</th><th>Service</th><th>Status</th><th class="num">Failures</th><th class="num">Last OK</th></tr></thead><tbody>
        ${targets.map((t) => `<tr><td class="clip">${esc(t.name)}<div class="faint small">${t.kind}</div></td><td class="nowrap">${SERVICE_ICON(t.type)} ${esc(t.type)}</td><td>${healthSt(t.health, t.enabled)}</td><td class="num">${t.health?.failures ?? 0}</td><td class="num">${t.health?.lastOk ? ago(t.health.lastOk) : "—"}</td></tr>`).join("")}
        </tbody></table>` : emptyState("No destinations yet", can("destinations:write") ? "A destination is a saved notification target: " + SERVICE_LIST + ". One route can forward to several." : "", can("destinations:write") ? '<a class="btn sm" href="#/destinations">Add a destination</a>' : "")}</div>
    </div>
    ${forwardsTo(s, hRoutes)}
    <div class="panel qa">
      <a href="#/routes">${icon("routes")}<span>Routes<small>Which mail goes where</small></span></a>
      <a href="#/destinations">${icon("dest")}<span>Destinations<small>Gotify, ntfy, Discord, Slack, Telegram…</small></span></a>
      <a href="#/dead">${icon("dead")}<span>Dead letters<small>${dl.total} waiting</small></span></a>
      <a href="${isAdmin() ? "#/settings/general" : "#/history"}">${icon(isAdmin() ? "settings" : "history")}<span>${isAdmin() ? "Settings<small>SMTP, auth, backup</small>" : "History<small>Everything received</small>"}</span></a>
    </div>`;
  $$("[data-range]").forEach((b) => b.addEventListener("click", () => { homeRange = b.dataset.range; route(); }));
  bindMsgRows();
};

/** Home: which services mail is forwarded to, and how routes fan out. */
function forwardsTo(s, routes) {
  const byType = {};
  for (const d of s.destinations) (byType[d.type] ??= []).push(d);
  for (const r of s.routes) (byType[r.type] ??= []).push(r);
  const fanned = routes.filter((r) => (r.options?.destinationIds?.length || 0) + (r.targetType !== "none" ? 1 : 0) > 1).length;
  const types = SERVICES.filter((t) => byType[t]);
  return `<div class="panel"><div class="panel-head"><h2>Forwards to</h2><span class="count">${types.length} service${types.length === 1 ? "" : "s"}</span>${can("destinations:read") ? '<a class="link" href="#/destinations">Destinations ›</a>' : ""}</div>
    <div class="panel-body fwd">${types.length ? types.map((t) => `<a class="fwd-chip" href="#/destinations" title="${esc(byType[t].map((x) => x.name).join(", "))}">${SERVICE_ICON(t, "lg")}<span>${esc(t === "ntfy" ? "ntfy" : t[0].toUpperCase() + t.slice(1))}<small>${byType[t].length} destination${byType[t].length === 1 ? "" : "s"}</small></span></a>`).join("")
      : `<span class="muted">Nothing yet. MailBeacon forwards to ${SERVICE_LIST}.</span>`}
    ${routes.length ? `<div class="help fwd-note">${routes.length} route${routes.length === 1 ? "" : "s"}${fanned ? ` · <strong>${fanned}</strong> fan out to several destinations at once` : " · each route can forward to several destinations at once"}</div>` : ""}</div></div>`;
}

// ---------- shared dialog helpers ----------
function dialog(html, cls = "", id = "dlg") {
  const d = $("#" + id); d.className = cls; d.innerHTML = html;
  $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => d.close()));
  if (!d.open) d.showModal();
  return d;
}
const dlgHead = (t) => `<div class="dlg-head"><span>${esc(t)}</span><button type="button" class="btn quiet sm x" data-close aria-label="Close">${icon("x")}</button></div>`;
function confirmDlg(title, text, action) {
  return new Promise((resolve) => {
    const d = dialog(`<div class="dlg">${dlgHead(title)}<div class="dlg-body"><p style="margin:0">${esc(text)}</p></div><div class="dlg-foot"><button class="btn quiet" type="button" data-no>Cancel</button><button class="btn danger" type="button" data-yes>${esc(action)}</button></div></div>`, "w480", "dlg2");
    let v = false;
    $("[data-yes]", d).addEventListener("click", () => { v = true; d.close(); });
    $("[data-no]", d).addEventListener("click", () => d.close());
    d.addEventListener("close", () => resolve(v), { once: true });
  });
}
const field = (label, input, help = "") => `<label class="f"><span>${label}</span>${input}${help ? `<span class="help">${help}</span>` : ""}</label>`;
function fieldInput(f, value, prefix, secretSet) {
  const name = `${prefix}.${f.key}`;
  if (f.kind === "bool") return `<label class="check"><input type="checkbox" name="${name}" ${value ? "checked" : ""}> ${esc(f.label)}</label>`;
  if (f.kind === "select") return field(esc(f.label), `<select name="${name}">${f.options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`, esc(f.help || ""));
  const ph = f.secret ? (secretSet ? "stored — leave blank to keep" : f.placeholder || "") : f.placeholder || "";
  return field(`${esc(f.label)}${f.required && !(f.secret && secretSet) ? " *" : ""}`, `<input name="${name}" ${f.secret ? 'type="password" autocomplete="new-password"' : f.kind === "number" ? 'type="number"' : ""} value="${f.secret ? "" : esc(value ?? "")}" placeholder="${esc(ph)}">`, esc(f.help || ""));
}
function readFields(form, prefix, fields) {
  const config = {}, secrets = {};
  for (const f of fields) {
    const el = form.elements[`${prefix}.${f.key}`]; if (!el) continue;
    if (f.kind === "bool") config[f.key] = el.checked;
    else if (f.secret) { if (el.value) secrets[f.key] = el.value; }
    else if (el.value !== "") config[f.key] = f.kind === "number" ? Number(el.value) : el.value;
  }
  return { config, secrets };
}

// ---------- Routes ----------
let DEST_TYPES = null;
const destTypes = async () => (DEST_TYPES ??= await api("GET", "/api/destination-types"));
const MATCH = {
  recipient: { label: "Recipient", help: "Exact address, or * as a wildcard (e.g. *@alerts.local). Not case-sensitive.", ph: "proxmox@alerts.local" },
  sender: { label: "Sender", help: "Regular expression on the sender address, e.g. ^proxmox@", ph: "^proxmox@example\\.com$" },
  subject: { label: "Subject", help: "Regular expression on the subject, checked after the message arrives.", ph: "^\\[PVE\\]" },
  catchall: { label: "Catch-all", help: "Takes every message that no earlier route matched. Admins only.", ph: "" },
};
VIEWS.routes = async (sub) => {
  const [routes, dests] = await Promise.all([api("GET", "/api/routes"), can("destinations:read") ? api("GET", "/api/destinations") : []]);
  const dn = Object.fromEntries(dests.map((d) => [d.id, d]));
  setHeader("Routes", `${plural(routes.length, "route")} · ${routes.filter((r) => r.enabled).length} enabled · first match wins`, can("routes:write") ? `<button class="btn" id="fromTpl" type="button">${icon("routes")}From template</button><button class="btn primary" id="addRoute" type="button">${icon("plus")}Add route</button>` : "");
  const tgt = (r) => {
    const parts = [];
    if (r.targetType !== "none") parts.push(`<span class="tag">${SERVICE_ICON(r.targetType)} ${esc(r.targetType)}</span>`);
    for (const id of r.options?.destinationIds || []) parts.push(`<span class="tag">${SERVICE_ICON(dn[id]?.type)} ${esc(dn[id]?.name || "#" + id)}</span>`);
    return parts.length ? (parts.length > 1 ? `<span class="faint small">${parts.length}×</span> ` : "") + parts.join(" ") : '<span class="faint">none</span>';
  };
  const extras = (r) => [r.options?.quiet?.enabled ? `quiet ${esc(r.options.quiet.start)}–${esc(r.options.quiet.end)}` : "", r.options?.digest?.enabled ? `digest ${r.options.digest.everyMinutes}m` : "", r.options?.titleTemplate || r.options?.bodyTemplate ? "template" : "", r.options?.extract?.length ? `extracts ${r.options.extract.length}` : "", r.options?.priorityRules?.length ? `${r.options.priorityRules.length} priority rule(s)` : "", r.options?.attachments?.forward ? "attachments" : ""].filter(Boolean).join(" · ");
  $("#content").innerHTML = `<div class="panel"><div class="panel-head"><h2>Routes</h2><span class="count">${routes.length}</span><span class="help" style="margin-left:auto">Checked top to bottom. Mail matching no route is refused (550), so MailBeacon is never an open relay.</span></div>
    ${routes.length ? `<table class="t"><thead><tr><th class="num">#</th><th>Name</th><th>Match</th><th>Sends to</th><th>Options</th>${isAdmin() ? "<th>Owner</th>" : ""}<th>Last mail</th><th>On</th><th></th></tr></thead><tbody>
    ${routes.map((r, i) => `<tr>
      <td class="num nowrap">${isAdmin() ? `<button class="btn quiet sm" type="button" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button><button class="btn quiet sm" type="button" data-down="${i}" ${i === routes.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>` : ""}${i + 1}</td>
      <td>${esc(r.name)}</td>
      <td class="clip">${esc(MATCH[r.matchType]?.label)} ${r.pattern ? `<span class="mono">${esc(r.pattern)}</span>` : ""}</td>
      <td>${tgt(r)}</td><td class="faint small">${extras(r) || "—"}</td>
      ${isAdmin() ? `<td>${esc(r.owner || "—")}</td>` : ""}
      <td class="nowrap">${r.lastDelivery ? `${status(r.lastDelivery.status)} <span class="faint">${ago(r.lastDelivery.at)}</span>` : '<span class="faint">never</span>'}</td>
      <td>${can("routes:write") ? `<label class="toggle"><input type="checkbox" data-toggle="${r.id}" ${r.enabled ? "checked" : ""} aria-label="Enabled"><span></span></label>` : r.enabled ? "On" : "Off"}</td>
      <td class="actions">${can("routes:write") ? `${r.targetType !== "none" || r.options?.destinationIds?.length ? `<button class="btn sm" type="button" data-test="${r.id}">Send test</button>` : ""}<button class="btn sm" type="button" data-edit="${r.id}">Edit</button><button class="btn sm danger" type="button" data-del="${r.id}">Delete</button>` : ""}</td></tr>`).join("")}
    </tbody></table>` : (can("routes:write") ? emptyState("No routes yet", "A route matches incoming mail and sends it to a destination. Until there is one, all mail is refused.", `<button class="btn primary sm" type="button" id="addRoute2">${icon("plus")}Add route</button>`)
      : emptyState("No routes to show", "Routes are created by an editor or admin. Ask one to share a route with you, or to set one up."))}</div>`;
  $("#addRoute")?.addEventListener("click", run(() => openRoute(null, dests)));
  $("#addRoute2")?.addEventListener("click", run(() => openRoute(null, dests)));
  $("#fromTpl")?.addEventListener("click", run(() => openTemplateGallery(dests)));
  $$("[data-edit]").forEach((b) => b.addEventListener("click", run(() => openRoute(routes.find((r) => r.id === Number(b.dataset.edit)), dests))));
  $$("[data-del]").forEach((b) => b.addEventListener("click", run(async () => { const r = routes.find((x) => x.id === Number(b.dataset.del)); if (await confirmDlg(`Delete route "${r.name}"`, "Mail that only this route matched will be refused from now on.", "Delete route")) { await api("DELETE", `/api/routes/${r.id}`); toast("Route deleted"); route(); } })));
  $$("[data-test]").forEach((b) => b.addEventListener("click", run(async () => { const x = await api("POST", `/api/routes/${b.dataset.test}/test`); toast(x.dryRun ? "Dry-run mode: test recorded, nothing sent" : "Test notification sent"); })));
  $$("[data-toggle]").forEach((c) => c.addEventListener("change", run(async () => { await api("PATCH", `/api/routes/${c.dataset.toggle}`, { enabled: c.checked }); toast(c.checked ? "Route enabled" : "Route disabled"); })));
  const move = async (i, d) => { const ids = routes.map((r) => r.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; await api("POST", "/api/routes/reorder", { ids }); route(); };
  $$("[data-up]").forEach((b) => b.addEventListener("click", run(() => move(Number(b.dataset.up), -1))));
  $$("[data-down]").forEach((b) => b.addEventListener("click", run(() => move(Number(b.dataset.down), 1))));
  if (sub === "templates" && can("routes:write")) { history.replaceState(null, "", "#/routes"); run(() => openTemplateGallery(dests))(); }
  if (sub === "new" && can("routes:write")) { history.replaceState(null, "", "#/routes"); run(() => openRoute(null, dests))(); }
};

const CONFIDENCE = { known: ["ok", "Known format"], partial: ["warn", "Partly known"], guess: ["warn", "Format guessed"] };
async function openTemplateGallery(dests) {
  const list = await api("GET", "/api/route-templates");
  const d = dialog(`<div class="dlg">${dlgHead("Start from a template")}<div class="dlg-body">
    <p class="help" style="margin-top:0">Ready-made routes for common homelab senders. Each pulls the useful values (host, status, …) out of the mail, sets a title and priority rules, and opens in the editor so you can pick destinations and check it against a real message before saving.</p>
    <div class="tpl-grid">${list.map((t) => `<div class="tpl-card"><div class="tpl-top"><span class="tpl-badge" aria-hidden="true">${esc(t.service.slice(0, 2))}</span><div><div class="tpl-name">${esc(t.name)}</div><div class="faint small">${esc(t.service)}</div></div>
      <span class="st ${CONFIDENCE[t.confidence][0]}" style="margin-left:auto" title="${esc(t.notes)}"><span class="mk"></span>${CONFIDENCE[t.confidence][1]}</span></div>
      <p class="small" style="margin:8px 0">${esc(t.description)}</p>
      <div class="faint small mono tpl-vars">${(t.options.extract || []).flatMap((x) => x.kind === "field" ? [x.name] : [...x.pattern.matchAll(/\(\?<([a-zA-Z_]\w*)>/g)].map((m) => m[1])).map((n) => `{{${esc(n.toLowerCase())}}}`).join(" ")}</div>
      <details class="small"><summary>Format notes</summary><p class="help" style="margin:6px 0 0">${esc(t.notes)}</p></details>
      <div style="margin-top:auto;padding-top:10px"><button class="btn sm primary" type="button" data-tpl="${esc(t.id)}">Use template</button></div></div>`).join("")}</div>
  </div><div class="dlg-foot"><button class="btn quiet" type="button" data-close>Close</button></div></div>`, "w880");
  $$("[data-tpl]", d).forEach((b) => b.addEventListener("click", run(async () => { d.close(); await openRoute(null, dests, list.find((t) => t.id === b.dataset.tpl)); })));
}
function paneTabs(d, list, active) {
  return `<div class="tabs inner">${list.map(([id, l]) => `<button type="button" data-pane="${id}" class="${id === active ? "active" : ""}">${l}</button>`).join("")}</div>`;
}
function bindPanes(d, onShow) {
  const show = (t) => { $$("[data-pane]", d).forEach((x) => x.classList.toggle("active", x.dataset.pane === t)); $$("[data-p]", d).forEach((p) => (p.hidden = p.dataset.p !== t)); onShow?.(t); };
  $$("[data-pane]", d).forEach((b) => b.addEventListener("click", () => show(b.dataset.pane)));
  return show;
}
async function openRoute(r, dests, tpl) {
  const types = await destTypes();
  // a template prefills a new route; r stays null so it is created, not updated
  const T = r || (tpl ? { name: tpl.name, matchType: tpl.matchType, pattern: tpl.pattern, enabled: true, order: 100, options: tpl.options } : null);
  const o = T?.options || {};
  const tt = r ? r.targetType : "none";
  const q = o.quiet || { enabled: false, start: "22:00", end: "07:00", action: "digest", bypassPriority: 8 };
  const inlineVals = (t) => (t === "gotify" ? { gotifyUrl: r?.gotifyUrl, gotifyPriority: r?.gotifyPriority } : r?.target || {});
  const inlineSet = (t, k) => (t === "gotify" ? !!r?.gotifyToken : !!r?.secrets?.[k]);
  const inlineFields = (t) => t === "none" ? '<p class="help full" style="margin:0">Only the destinations ticked above.</p>' : types[t].fields.map((f) => `<div>${fieldInput(f, inlineVals(t)[f.key], "inl", r?.targetType === t && inlineSet(t, f.key))}</div>`).join("");
  const extNames = (list) => [...new Set(list.flatMap((x) => x.kind === "field" ? [String(x.name || "").toLowerCase()] : [...String(x.pattern || "").matchAll(/\(\?<([a-zA-Z_]\w*)>/g)].map((m) => m[1].toLowerCase())).filter(Boolean))];
  const fieldOpts = (sel, names) => [...["subject", "body", "any"].map((v) => [v, v]), ...[...new Set([...names, ...(sel.startsWith("var:") ? [sel.slice(4)] : [])])].map((n) => ["var:" + n, `{{${n}}}`])].map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  const ruleRow = (x = { field: "subject", pattern: "", priority: 8 }) => `<div class="rule"><select name="rf" aria-label="Field">${fieldOpts(x.field, extNames(o.extract || []))}</select><input name="rp" value="${esc(x.pattern)}" placeholder="regex, e.g. fail|error" aria-label="Pattern"><input name="rv" type="number" min="0" max="10" value="${x.priority}" aria-label="Priority 0-10"><button type="button" class="btn quiet sm" data-rm aria-label="Remove rule">${icon("x")}</button></div>`;
  const extRow = (x = { kind: "regex", field: "subject", pattern: "", name: "" }) => `<div class="rule ext"><select name="ek" aria-label="Kind">${[["regex", "Regex"], ["field", "Field"]].map(([v, l]) => `<option value="${v}" ${v === x.kind ? "selected" : ""}>${l}</option>`).join("")}</select><select name="ef" aria-label="Look in">${["subject", "body", "any"].map((v) => `<option ${v === x.field ? "selected" : ""}>${v}</option>`).join("")}</select><input name="ep" class="mono" value="${esc(x.pattern)}" placeholder="${x.kind === "field" ? "label, e.g. Host" : "regex with (?<name>…)"}" aria-label="Pattern or label"><input name="en" class="mono" value="${esc(x.name || "")}" placeholder="name" maxlength="32" aria-label="Variable name"${x.kind === "field" ? "" : ' title="Optional for regex: the first group is stored under this name"'}><button type="button" class="btn quiet sm" data-rm aria-label="Remove extraction">${icon("x")}</button></div>`;
  const sampleRaw = tpl ? `From: ${tpl.sample.from}\nTo: ${tpl.sample.to}\nSubject: ${tpl.sample.subject}\n\n${tpl.sample.body}` : "";
  const d = dialog(`<form class="dlg" id="routeForm">${dlgHead(r ? `Edit route "${r.name}"` : tpl ? `Add route from template: ${tpl.name}` : "Add route")}
    ${paneTabs(null, [["match", "Match"], ["deliver", "Deliver to"], ["format", "Template and priority"], ["schedule", "Quiet hours and digest"]], "match")}
    <div class="dlg-body">
      <div data-p="match"><div class="form">
        ${field("Name *", `<input name="name" required maxlength="100" value="${esc(T?.name || "")}" placeholder="Proxmox backups">`)}
        ${field("Match on", `<select name="matchType">${Object.entries(MATCH).filter(([k]) => k !== "catchall" || isAdmin()).map(([k, m]) => `<option value="${k}" ${k === (T?.matchType || "recipient") ? "selected" : ""}>${m.label}</option>`).join("")}</select>`)}
        <label class="f full"><span>Pattern</span><input name="pattern" class="mono" value="${esc(T?.pattern || "")}"><span class="help" id="matchHelp"></span></label>
        ${field("Order", `<input name="order" type="number" value="${r?.order ?? 100}">`, `Lower runs first.${isAdmin() ? "" : " Your routes always run after the admin's."}`)}
        <label class="check" style="align-self:end"><input type="checkbox" name="enabled" ${r?.enabled === false ? "" : "checked"}> Enabled</label>
        <div class="full section"><h3>Try the pattern</h3><div class="btn-row"><input id="mtSample" placeholder="sample address or subject" style="flex:1" value="${esc(tpl ? (tpl.matchType === "recipient" ? tpl.sample.to : tpl.sample.subject) : "")}"><button class="btn" type="button" id="mtBtn">Check</button><span id="mtOut" class="small"></span></div></div>
      </div></div>
      <div data-p="deliver" hidden>
        <div class="section"><h3>Destinations <span class="faint" id="fanCount" style="font-weight:400"></span></h3><p class="help">Tick as many as you like: this route forwards every matching email to <strong>each</strong> ticked destination (fan-out), on any mix of services. A failed one is retried on its own; the others are not sent twice.</p>
          ${dests.length ? `<div class="dest-pick">${dests.map((x) => `<label class="check"><input type="checkbox" name="dest" value="${x.id}" ${(o.destinationIds || []).includes(x.id) ? "checked" : ""}> ${SERVICE_ICON(x.type)} ${esc(x.name)} <span class="faint small">${esc(x.type)}${x.enabled ? "" : " · disabled"}</span></label>`).join("")}</div>` : `<p class="faint">No destinations yet.${can("destinations:write") ? ' Create them on the <a href="#/destinations">Destinations</a> page.' : ""}</p>`}</div>
        <div class="section"><h3>Inline target</h3><p class="help">Optional: a target stored on this route only (how 0.2.0 routes worked).</p>
          ${field("Type", `<select name="targetType"><option value="none">None — destinations only</option>${Object.keys(types).map((t) => `<option value="${t}" ${t === tt ? "selected" : ""}>${esc(types[t].label)}</option>`).join("")}</select>`)}
          <div class="form" id="inlineFields" style="margin-top:8px">${inlineFields(tt)}</div></div>
        <div class="section"><h3>Attachments</h3><label class="check"><input type="checkbox" name="fwdAtt" ${o.attachments?.forward ? "checked" : ""}> Forward attachments where the service supports files</label>
          <p class="help">ntfy and Pushover take one file; Discord, Telegram, Apprise and webhooks up to ten; Gotify and Slack none. Size limits are in Settings › SMTP and limits.</p></div>
      </div>
      <div data-p="format" hidden>
        <div class="form">
          ${tpl ? `<div class="full note ${tpl.confidence === "known" ? "" : "warn"}"><strong>${esc(CONFIDENCE[tpl.confidence][1])}.</strong> ${esc(tpl.notes)}</div>` : ""}
          <label class="f full"><span>Title template</span><input name="titleTemplate" value="${esc(o.titleTemplate || "")}" placeholder="blank = the email subject, e.g. [{{route}}] {{subject:80}}"></label>
          <label class="f full"><span>Body template</span><textarea name="bodyTemplate" rows="4" placeholder="blank = the email body">${esc(o.bodyTemplate || "")}</textarea>
            <span class="help">Variables: {{subject}} {{from}} {{to}} {{body}} {{route}} {{date}} {{time}} {{datetime}} {{attachments}} {{priority}}, plus any value extracted below and any field of a webhook's JSON. Add :N to cut to N characters, e.g. {{body:200}}, and |text for a fallback when empty, e.g. {{host|unknown}} or {{host|{{from}}}}.</span></label>
        </div>
        <div class="section"><h3>Extract values</h3><p class="help">Pull values out of the subject or body and use them as {{name}} in the templates and priority rules. <strong>Regex</strong>: named groups become variables, e.g. <code>\\((?&lt;host&gt;[^)]+)\\)</code> gives {{host}}. <strong>Field</strong>: the value after a label on its own line, e.g. <code>Host: pve1</code>. The first rule that finds a value wins.</p>
          <div class="rules" id="extRules">${(o.extract || []).map(extRow).join("")}</div><button class="btn sm" type="button" id="addExt">${icon("plus")}Add extraction</button></div>
        <div class="section"><h3>Priority rules</h3><p class="help">The first rule whose pattern matches sets the priority, 0 (silent) to 10 (urgent). It is mapped to each service's scale: ntfy 1–5, Pushover −2 to 1, Telegram silent at 3 or below.</p>
          <div class="rules" id="rules">${(o.priorityRules || []).map(ruleRow).join("")}</div><button class="btn sm" type="button" id="addRule">${icon("plus")}Add rule</button></div>
        <div class="section"><h3>Live preview</h3><p class="help">Paste a real email (with its headers, e.g. from your mail client's “show original”), or just the body and type a subject. Updates as you type; nothing is sent.</p>
          <div class="form" style="grid-template-columns:1fr">
            <input id="pvSubject" value="${esc(tpl ? "" : "[PVE] vzdump backup failed on pve1")}" placeholder="Subject (ignored when the pasted email has headers)" aria-label="Sample subject">
            <textarea id="pvRaw" rows="6" class="mono" placeholder="From: proxmox@pve1.lan&#10;Subject: vzdump backup status (pve1): backup failed&#10;&#10;Backup of VM 101 failed …" aria-label="Sample email">${esc(sampleRaw)}</textarea></div>
          <div class="preview-box" id="pvOut" aria-live="polite"><span class="faint">Type or paste a sample to see the result.</span></div></div>
      </div>
      <div data-p="schedule" hidden>
        <div class="section"><h3>Quiet hours</h3><p class="help">During the window, messages wait instead of notifying. Messages at or above the bypass priority are sent anyway. Times use the time zone in Settings › General.</p>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" name="qOn" ${q.enabled ? "checked" : ""}> Enable quiet hours</label>
          <div class="form c4">
            ${field("From", `<input name="qStart" type="time" value="${esc(q.start)}">`)}
            ${field("Until", `<input name="qEnd" type="time" value="${esc(q.end)}">`)}
            ${field("Afterwards", `<select name="qAction">${[["digest", "Send one digest"], ["hold", "Send each message"], ["drop", "Record only"]].map(([v, l]) => `<option value="${v}" ${v === q.action ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
            ${field("Bypass at priority", `<input name="qBypass" type="number" min="0" max="11" value="${q.bypassPriority ?? 8}">`)}
            <div class="full"><span class="help">Days (none ticked = every day):</span> ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((n, i) => `<label class="check" style="margin-right:8px"><input type="checkbox" name="qDay" value="${i}" ${(q.days || []).includes(i) ? "checked" : ""}> ${n}</label>`).join("")}</div>
          </div></div>
        <div class="section"><h3>Digest</h3><p class="help">Batch every message on this route into one notification at a fixed interval, all day.</p>
          <div class="btn-row"><label class="check"><input type="checkbox" name="dOn" ${o.digest?.enabled ? "checked" : ""}> Send a digest every</label><input name="dEvery" type="number" min="5" max="1440" value="${o.digest?.everyMinutes || 60}" style="width:80px" aria-label="Minutes"> <span class="muted">minutes</span></div></div>
      </div>
    </div>
    <div class="dlg-foot"><span id="routeErr" class="err-text" style="margin-right:auto"></span><button class="btn quiet" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${r ? "Save route" : "Add route"}</button></div></form>`, "w880");
  bindPanes(d);
  const f = $("#routeForm");
  const syncMatch = () => { const m = MATCH[f.matchType.value]; $("#matchHelp").textContent = m.help; f.pattern.placeholder = m.ph; f.pattern.disabled = f.matchType.value === "catchall"; };
  f.matchType.addEventListener("change", syncMatch); syncMatch();
  const fan = () => { const n = $$("[name=dest]:checked", d).length + (f.targetType.value !== "none" ? 1 : 0); $("#fanCount").textContent = n ? `· forwards to ${n} destination${n === 1 ? "" : "s"}` : "· nothing ticked"; };
  d.addEventListener("change", (e) => { if (e.target.name === "dest" || e.target.name === "targetType") fan(); }); fan();
  f.targetType.addEventListener("change", () => ($("#inlineFields").innerHTML = inlineFields(f.targetType.value)));
  const bindRm = () => $$("[data-rm]", d).forEach((b) => (b.onclick = () => { b.parentElement.remove(); syncVars(); preview(); }));
  $("#addRule").addEventListener("click", () => { $("#rules").insertAdjacentHTML("beforeend", ruleRow()); bindRm(); syncVars(); });
  $("#addExt").addEventListener("click", () => { $("#extRules").insertAdjacentHTML("beforeend", extRow()); bindRm(); }); bindRm();
  const extract = () => $$(".rule.ext", d).map((el) => ({ kind: $("[name=ek]", el).value, field: $("[name=ef]", el).value, pattern: $("[name=ep]", el).value, ...($("[name=en]", el).value.trim() ? { name: $("[name=en]", el).value.trim().toLowerCase() } : {}) })).filter((x) => x.pattern);
  // keep the priority rules' {{var}} choices in step with the extraction rules
  const syncVars = () => { const names = extNames(extract()); $$("[name=rf]", d).forEach((s) => { const v = s.value; s.innerHTML = fieldOpts(v, names); s.value = v; }); };
  $("#mtBtn").addEventListener("click", run(async () => { const x = await api("POST", "/api/routes/match-test", { matchType: f.matchType.value, pattern: f.pattern.value, sample: $("#mtSample").value }); $("#mtOut").innerHTML = x.error ? `<span class="err-text">${esc(x.error)}</span>` : x.matches ? '<span class="st ok"><span class="mk"></span>Matches</span>' : '<span class="st"><span class="mk"></span>No match</span>'; }));
  const rules = () => $$(".rule:not(.ext)", d).map((el) => ({ field: $("[name=rf]", el).value, pattern: $("[name=rp]", el).value, priority: Number($("[name=rv]", el).value) })).filter((x) => x.pattern);
  let pvTimer, pvSeq = 0;
  const preview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(async () => {
    const seq = ++pvSeq;
    try {
      const x = await api("POST", "/api/templates/preview", { titleTemplate: f.titleTemplate.value || undefined, bodyTemplate: f.bodyTemplate.value || undefined, priorityRules: rules(), extract: extract(), raw: $("#pvRaw").value || undefined, sample: { subject: $("#pvSubject").value, body: $("#pvRaw").value ? undefined : "", route: f.name.value || "Example route" } });
      if (seq !== pvSeq) return;
      const ex = Object.entries(x.extracted || {});
      $("#pvOut").innerHTML = `${ex.length ? `<div class="pv-vars">${ex.map(([k, v]) => `<span class="tag ${v ? "" : "empty"}"><span class="mono">${esc(k)}</span> = ${v ? esc(v.length > 80 ? v.slice(0, 80) + "…" : v) : "<em>not found</em>"}</span>`).join(" ")}</div>` : ""}
        <div class="faint small">Title</div><div class="pt">${esc(x.title)}</div><div class="faint small" style="margin-top:6px">Body</div><div class="pv-body">${esc(x.body.length > 1500 ? x.body.slice(0, 1500) + "…" : x.body)}</div>
        <div class="faint small" style="margin-top:6px">Priority: <strong>${x.priority === null ? "route default" : x.priority}</strong></div>`;
    } catch (err) { if (seq === pvSeq) $("#pvOut").innerHTML = `<span class="err-text">${esc(err.message)}</span>`; }
  }, 350); };
  $("[data-p=format]", d).addEventListener("input", () => { syncVars(); preview(); });
  $("[data-p=format]", d).addEventListener("change", preview);
  preview();
  f.addEventListener("submit", run(async () => {
    const t = f.targetType.value;
    const { config, secrets } = t === "none" ? { config: {}, secrets: {} } : readFields(f, "inl", types[t].fields);
    const body = {
      name: f.name.value.trim(), matchType: f.matchType.value, pattern: f.pattern.value.trim(), order: Number(f.order.value), enabled: f.enabled.checked, targetType: t,
      options: {
        destinationIds: $$("[name=dest]:checked", d).map((c) => Number(c.value)),
        titleTemplate: f.titleTemplate.value || undefined, bodyTemplate: f.bodyTemplate.value || undefined, priorityRules: rules(), extract: extract(),
        quiet: f.qOn.checked || o.quiet ? { enabled: f.qOn.checked, start: f.qStart.value, end: f.qEnd.value, action: f.qAction.value, bypassPriority: Number(f.qBypass.value), days: $$("[name=qDay]:checked", d).map((c) => Number(c.value)) } : undefined,
        digest: f.dOn.checked ? { enabled: true, everyMinutes: Number(f.dEvery.value) } : undefined,
        attachments: { forward: f.fwdAtt.checked },
      },
    };
    if (t === "gotify") { body.gotifyUrl = config.gotifyUrl || null; body.gotifyPriority = config.gotifyPriority ?? 5; if (secrets.gotifyToken) body.gotifyToken = secrets.gotifyToken; }
    else if (t !== "none") { body.target = config; body.secrets = secrets; }
    try { await api(r ? "PUT" : "POST", r ? `/api/routes/${r.id}` : "/api/routes", body); }
    catch (err) { $("#routeErr").textContent = err.message; return; }
    d.close(); toast(r ? "Route saved" : "Route added"); route();
  }));
}

// ---------- Destinations ----------
VIEWS.destinations = async () => {
  const [dests, types] = await Promise.all([api("GET", "/api/destinations"), destTypes()]);
  setHeader("Destinations", `${dests.length} saved · ${dests.filter((x) => x.health?.failures >= 3).length} unreachable`, can("destinations:write") ? `<button class="btn primary" type="button" id="addDest">${icon("plus")}Add destination</button>` : "");
  $("#content").innerHTML = `<div class="panel"><div class="panel-head"><h2>Destinations</h2><span class="count">${dests.length}</span><span class="help" style="margin-left:auto">Where mail is forwarded. One route can fan out to several destinations, on different services.</span></div>
    ${dests.length ? `<table class="t"><thead><tr><th>Name</th><th>Service</th><th>Status</th><th class="num">Files</th><th>Used by</th>${isAdmin() ? "<th>Owner</th>" : ""}<th>Last error</th><th></th></tr></thead><tbody>
    ${dests.map((x) => `<tr><td>${esc(x.name)}</td><td class="nowrap">${SERVICE_ICON(x.type)} ${esc(types[x.type]?.label || x.type)}</td><td>${healthSt(x.health, x.enabled)}</td><td class="num">${types[x.type]?.attachments ?? 0}</td>
      <td>${x.usedBy?.length ? x.usedBy.map((r) => `<span class="tag">${esc(r.name)}</span>`).join(" ") : '<span class="faint">unused</span>'}</td>${isAdmin() ? `<td>${esc(x.owner || "—")}</td>` : ""}
      <td class="clip faint small">${esc(x.health?.lastError || "")}</td>
      <td class="actions">${can("destinations:write") ? `<button class="btn sm" type="button" data-test="${x.id}">Send test</button><button class="btn sm" type="button" data-edit="${x.id}">Edit</button><button class="btn sm danger" type="button" data-del="${x.id}">Delete</button>` : ""}</td></tr>`).join("")}
    </tbody></table>` : (can("destinations:write") ? emptyState("No destinations yet", "Add where notifications should go: " + SERVICE_LIST + ". A route can then forward each email to several destinations at once.", `<button class="btn primary sm" type="button" id="addDest2">${icon("plus")}Add destination</button>`)
      : emptyState("No destinations to show", "Destinations are managed by an editor or admin."))}</div>
    <div class="panel"><div class="panel-head"><h2>Supported services</h2><span class="count">${Object.keys(types).length}</span></div><table class="t"><thead><tr><th>Service</th><th class="num">Attachments</th><th>Needs</th></tr></thead><tbody>
    ${Object.entries(types).map(([k, t]) => `<tr><td class="nowrap">${SERVICE_ICON(k)} ${esc(t.label)}</td><td class="num">${t.attachments}</td><td class="faint small">${t.fields.filter((f) => f.required).map((f) => esc(f.label)).join(", ") || "—"}</td></tr>`).join("")}</tbody></table></div>`;
  $("#addDest")?.addEventListener("click", () => openDest(null, types));
  $("#addDest2")?.addEventListener("click", () => openDest(null, types));
  $$("[data-edit]").forEach((b) => b.addEventListener("click", () => openDest(dests.find((x) => x.id === Number(b.dataset.edit)), types)));
  $$("[data-test]").forEach((b) => b.addEventListener("click", run(async () => { const x = await api("POST", `/api/destinations/${b.dataset.test}/test`); toast(x.dryRun ? "Dry-run mode: test recorded, nothing sent" : "Test notification sent"); route(); })));
  $$("[data-del]").forEach((b) => b.addEventListener("click", run(async () => {
    const x = dests.find((y) => y.id === Number(b.dataset.del));
    if (!(await confirmDlg(`Delete destination "${x.name}"`, x.usedBy?.length ? `Used by ${x.usedBy.map((r) => r.name).join(", ")}; it will be removed from those routes.` : "This can't be undone.", "Delete destination"))) return;
    await api("DELETE", `/api/destinations/${x.id}?force=1`); toast("Destination deleted"); route();
  })));
};
function openDest(x, types) {
  const t0 = x?.type || "ntfy";
  const fields = (t) => types[t].fields.map((f) => `<div class="${f.kind === "bool" ? "full" : ""}">${fieldInput(f, x?.type === t ? x.config[f.key] : undefined, "d", x?.type === t && !!x.secrets?.[f.key])}</div>`).join("");
  const d = dialog(`<form class="dlg" id="destForm">${dlgHead(x ? `Edit destination "${x.name}"` : "Add destination")}<div class="dlg-body"><div class="form">
      ${field("Name *", `<input name="name" required maxlength="100" value="${esc(x?.name || "")}" placeholder="Phone (ntfy)">`)}
      <div class="f full"><span>Service${x ? " (fixed once saved)" : ""}</span>${servicePicker(types, t0, !!x)}</div>
      <label class="check full"><input type="checkbox" name="enabled" ${x?.enabled === false ? "" : "checked"}> Enabled</label>
      <div class="full section"><h3>Connection</h3><p class="help">Secrets are encrypted at rest and never shown again. Leave a secret blank to keep the stored value.</p></div>
      <div class="full form" id="destFields" style="padding:0">${fields(t0)}</div></div></div>
    <div class="dlg-foot"><span id="destErr" class="err-text" style="margin-right:auto"></span><button class="btn quiet" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${x ? "Save destination" : "Add destination"}</button></div></form>`);
  const f = $("#destForm");
  f.addEventListener("change", (e) => { if (e.target.name === "type") $("#destFields").innerHTML = fields(e.target.value); });
  f.addEventListener("submit", run(async () => {
    const type = x?.type || $("[name=type]:checked", f).value;
    const { config, secrets } = readFields(f, "d", types[type].fields);
    try { await api(x ? "PUT" : "POST", x ? `/api/destinations/${x.id}` : "/api/destinations", { name: f.name.value.trim(), type, config, secrets, enabled: f.enabled.checked }); }
    catch (err) { $("#destErr").textContent = err.message; return; }
    d.close(); toast(x ? "Destination saved" : "Destination added"); route();
  }));
}

// ---------- History / dead letters ----------
const HIST0 = { status: "", q: "", sender: "", routeId: "", destination: "", from: "", to: "", offset: 0 };
let histQ = { ...HIST0 };
let HIST_FILTERS = null;
const ST_ICON = { ok: "check", warn: "clock", info: "pause", crit: "alert", "": "belloff" };
const msgTable = (rows, empty = emptyState("Nothing here")) => rows.length ? `<div class="mlist" role="list">${rows.map((m) => { const [c] = STATUS_MAP[m.status] || [""]; return `<div class="mrow" role="listitem" data-msg="${m.id}">
  <span class="sic ${c}" title="${esc((STATUS_MAP[m.status] || ["", m.status])[1])}">${icon(ST_ICON[c] || "mail")}</span>
  <span class="mb0" style="min-width:0"><div class="ms">${esc(m.subject || "(no subject)")}</div><div class="mm">${esc(m.sender || "")} → ${esc(m.recipients || "")}${m.route ? ` · ${esc(m.route)}` : ""}</div></span>
  <span class="mc">${status(m.status)}${m.lastError ? `<span class="chip bad" title="${esc(m.lastError)}">${esc(m.lastError)}</span>` : ""}${m.priority != null ? `<span class="chip">prio ${m.priority}</span>` : ""}${m.attempts ? `<span class="chip">${m.attempts} ${m.attempts === 1 ? "try" : "tries"}</span>` : ""}</span>
  <span class="mt" title="${esc(m.receivedAt)}">${fmtDate(m.receivedAt)}</span>${icon("chev")}</div>`; }).join("")}</div>` : empty;
const bindMsgRows = () => $$("[data-msg]").forEach((tr) => {
  tr.tabIndex = 0; tr.setAttribute("aria-label", "Open message " + tr.dataset.msg);
  tr.addEventListener("click", run(() => openMessage(Number(tr.dataset.msg))));
  tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tr.click(); } });
});
const pager = (off, size, total, prevId, nextId) => `<div class="t-foot"><span>${total ? `${off + 1}–${Math.min(total, off + size)} of ${total}` : "0"}</span><span style="flex:1"></span><button class="btn sm" type="button" id="${prevId}" ${off ? "" : "disabled"}>Previous</button><button class="btn sm" type="button" id="${nextId}" ${off + size < total ? "" : "disabled"}>Next</button></div>`;
const histParams = () => { const p = new URLSearchParams(); for (const k of ["status", "q", "sender", "routeId", "destination", "from", "to"]) if (histQ[k]) p.set(k, histQ[k]); return p; };
VIEWS.history = async () => {
  HIST_FILTERS ??= await api("GET", "/api/messages/filters").catch(() => ({ routes: [], destinations: [] }));
  const qs = histParams(); qs.set("limit", "50"); qs.set("offset", String(histQ.offset));
  const { data: rows, total } = await apiRaw("GET", "/api/messages?" + qs);
  const filtered = ["status", "q", "sender", "routeId", "destination", "from", "to"].some((k) => histQ[k]);
  setHeader("History", `${total} messages${filtered ? " match" : ""}`, `<button class="btn" type="button" id="hCsv" ${total ? "" : "disabled"}>${icon("download")}Export CSV</button>${can("messages:write") ? `<button class="btn" type="button" id="relHeld">Release held now</button>` : ""}`);
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
  const cq = histParams(); cq.delete("status"); cq.set("limit", "1");
  const CHIPS = [["", "All", "all"], ["delivered", "Delivered", "ok"], ["failed", "Retrying", "warn"], ["held", "Held", "info"], ["dead", "Dead", "crit"], ["pending", "Pending", "info"], ["suppressed", "Suppressed", ""]];
  const counts = await Promise.all(CHIPS.map(([st]) => { const q = new URLSearchParams(cq); if (st) q.set("status", st); return apiRaw("GET", "/api/messages?" + q).then((x) => x.total).catch(() => null); }));
  const chips = CHIPS.map(([st, l, c], i) => (!st || ["delivered", "failed", "held", "dead"].includes(st) || counts[i] || histQ.status === st) ? `<button type="button" class="fchip ${c}${histQ.status === st ? " on" : ""}" data-st="${st}" aria-pressed="${histQ.status === st}">${c && c !== "all" ? '<span class="mk"></span>' : ""}${l}${counts[i] != null ? ` <span class="mono">${counts[i]}</span>` : ""}</button>` : "").join("");
  const dests = [...HIST_FILTERS.destinations.map((d) => [d.key, d.name]), ...HIST_FILTERS.routes.filter((r) => r.inline).map((r) => [`route:${r.id}`, `${r.name} (inline ${r.inline})`])];
  $("#content").innerHTML = `<div class="panel filter-card">
    <form class="filters" id="hForm" role="search" aria-label="Filter history">
      <label class="f"><span>Search</span><input name="q" placeholder="Sender, recipient, subject" value="${esc(histQ.q)}"></label>
      <label class="f"><span>Sender</span><input name="sender" placeholder="e.g. proxmox@" value="${esc(histQ.sender)}"></label>
      <label class="f"><span>Route</span><select name="routeId">${opt("", "All routes", histQ.routeId)}${HIST_FILTERS.routes.map((r) => opt(r.id, r.name, histQ.routeId)).join("")}</select></label>
      <label class="f"><span>Destination</span><select name="destination">${opt("", "All destinations", histQ.destination)}${dests.map(([k, n]) => opt(k, n, histQ.destination)).join("")}</select></label>
      <label class="f"><span>Status</span><select name="status">${opt("", "All statuses", histQ.status)}${Object.entries(STATUS_MAP).map(([k, [, w]]) => opt(k, w, histQ.status)).join("")}</select></label>
      <label class="f"><span>Received from</span><input name="from" type="date" aria-label="Received from" value="${esc(histQ.from)}"></label>
      <label class="f"><span>Received to</span><input name="to" type="date" value="${esc(histQ.to)}"></label>
      <div class="f f-btns"><span>&nbsp;</span><div class="btn-row"><button class="btn primary" type="submit">${icon("filter")}Apply</button>${filtered ? '<button class="btn quiet" type="button" id="hReset">Clear</button>' : ""}</div></div>
    </form>
    <p class="help filters-help">Dates are whole days in UTC. Destination finds messages that were sent, or tried, to it.</p></div>
    <div class="fchips" id="hChips" role="group" aria-label="Filter by status">${chips}</div>
    <div class="panel">${msgTable(rows, filtered ? emptyState("No messages match", "Try other filters or a wider date range.", '<button class="btn sm" type="button" id="hClear">Clear filters</button>') : emptyState("No messages yet", "Mail that MailBeacon receives is listed here, delivered or not."))}${pager(histQ.offset, 50, total, "hPrev", "hNext")}</div>`;
  bindMsgRows();
  const f = $("#hForm");
  f.addEventListener("submit", (e) => { e.preventDefault(); histQ = { ...HIST0, ...Object.fromEntries([...new window.FormData(f)].map(([k, v]) => [k, String(v).trim()])), offset: 0 }; route(); });
  $$("select", f).forEach((el) => el.addEventListener("change", () => f.requestSubmit()));
  const clear = () => { histQ = { ...HIST0 }; route(); };
  $$("#hChips [data-st]").forEach((b) => b.addEventListener("click", () => { histQ = { ...histQ, status: b.dataset.st, offset: 0 }; route(); }));
  $("#hReset")?.addEventListener("click", clear); $("#hClear")?.addEventListener("click", clear);
  $("#hPrev").addEventListener("click", () => { histQ.offset = Math.max(0, histQ.offset - 50); route(); });
  $("#hNext").addEventListener("click", () => { histQ.offset += 50; route(); });
  $("#hCsv").addEventListener("click", run(async () => {
    const r = await fetch("/api/messages/export.csv?" + histParams(), { credentials: "same-origin" });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `export failed (${r.status})`);
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob());
    a.download = `mailbeacon-history-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(r.headers.get("X-Truncated") === "1" ? `Exported the newest 10,000 of ${r.headers.get("X-Total-Count")} messages` : `Exported ${r.headers.get("X-Total-Count")} messages`);
  }));
  $("#relHeld")?.addEventListener("click", run(async () => { const x = await api("POST", "/api/held/release"); toast(`Released ${x.released ?? 0} held message(s)`); route(); }));
};

// ---------- Stats ----------
let statsDays = 30;
const pct = (x) => (x * 100 >= 10 || x === 0 ? Math.round(x * 100) : Math.round(x * 1000) / 10) + "%";
const PALETTE = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
/** Stacked daily bars, one colour per series (top 5 + "Everything else"). */
function stackChart(days, series, label) {
  const W = Math.max(400, ($("#content")?.clientWidth || 900) - 58), H = 200, pl = 30, pb = 18, pt = 8;
  const totals = days.map((_, i) => series.reduce((a, s) => a + s.perDay[i], 0));
  const max = Math.max(1, ...totals), nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const bw = (W - pl) / days.length, y = (v) => H - pb - (v / nice) * (H - pb - pt);
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = Math.round((nice / 4) * i), yy = y(v); g += `<line x1="${pl}" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--divider)"/><text x="${pl - 6}" y="${yy + 3}" text-anchor="end" font-size="10" fill="var(--text-3)">${v}</text>`; }
  const every = Math.ceil(days.length / 10);
  days.forEach((d, i) => {
    const x = pl + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7); let acc = 0;
    series.forEach((s, k) => { const v = s.perDay[i]; if (!v) return; const y1 = y(acc + v), y0 = y(acc); acc += v; g += `<rect x="${x}" y="${y1}" width="${w}" height="${y0 - y1}" fill="${PALETTE[k % PALETTE.length]}"><title>${esc(d)} · ${esc(s.name)}: ${v}</title></rect>`; });
    if (i % every === 0) g += `<text x="${x + w / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--text-3)">${esc(d.slice(5))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${g}</svg>
    <div class="legend">${series.map((s, k) => `<span><span class="sw" style="background:${PALETTE[k % PALETTE.length]}"></span>${esc(s.name)}</span>`).join("")}<span class="faint">UTC days</span></div>`;
}
const topN = (list, n = 5) => {
  if (list.length <= n) return list;
  const rest = list.slice(n), days = rest[0].perDay.length;
  return [...list.slice(0, n), { name: `Everything else (${rest.length})`, total: rest.reduce((a, s) => a + s.total, 0), perDay: Array.from({ length: days }, (_, i) => rest.reduce((a, s) => a + s.perDay[i], 0)) }];
};
const spark = (s) => { const m = Math.max(1, ...s.perDay), w = 120, h = 22, bw = w / s.perDay.length; return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${s.perDay.map((v, i) => { const hh = v ? Math.max(1.5, (v / m) * h) : 0; const f = s.failedPerDay[i]; return hh ? `<rect x="${i * bw}" y="${h - hh}" width="${Math.max(1, bw - 1)}" height="${hh}" fill="${f ? "var(--crit)" : "var(--chart-ok)"}"/>` : ""; }).join("")}</svg>`; };
const rateCell = (failed, total) => `<td class="num${total && failed / total >= 0.1 ? " err-text" : ""}">${total ? pct(failed / total) : "—"}</td>`;
VIEWS.stats = async () => {
  const r = await api("GET", `/api/stats/report?days=${statsDays}`);
  const t = r.totals;
  setHeader("Stats", `last ${statsDays} days · ${plural(t.total, "message")}${isAdmin() ? "" : " · your messages only"}`, `<div class="seg">${[7, 30, 90].map((d) => `<button type="button" data-days="${d}" class="btn sm${d === statsDays ? " on" : " quiet"}">${d} days</button>`).join("")}</div>`);
  const none = (what) => emptyState(`No ${what} in the last ${statsDays} days`, "Numbers here come from stored history only; nothing is estimated.");
  $("#content").innerHTML = `
    <div class="stats">
      ${kpi("Received", t.total, `last ${statsDays} days`, false, "mail")}
      ${kpi("Delivered", t.delivered, t.total ? pct(t.delivered / t.total) + " of received" : "—", false, "check", "ok")}
      ${kpi("Failed or dead", t.failed + t.dead, `${t.failed} retrying · ${t.dead} dead`, t.dead > 0, "alert", "warn")}
      ${kpi("Failure rate", t.total ? pct(t.failureRate) : "—", "failed or dead ÷ received", t.failureRate >= 0.1, "gauge")}
      ${kpi("Held or suppressed", t.held + t.suppressed, "quiet hours, digests, drops", false, "pause", "held")}
      ${kpi("Routes used", r.routes.length, `${r.destinations.length} destinations`, false, "routes")}
    </div>
    <div class="panel"><div class="panel-head"><h2>Volume per route</h2><span class="count">${t.total}</span></div>
      <div class="chart">${t.total ? stackChart(r.days, topN(r.routes), "Messages per route per day") : none("mail")}</div></div>
    <div class="panel"><div class="panel-head"><h2>Volume per destination</h2><span class="count">${r.destinations.reduce((a, d) => a + d.total, 0)} attempts</span><span class="help" style="margin-left:auto">Each delivery attempt to each destination, counted from 0.3.0 on.</span></div>
      <div class="chart">${r.destinations.length ? stackChart(r.days, topN(r.destinations), "Delivery attempts per destination per day") : none("deliveries")}</div></div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h2>Failure rate by route</h2></div>
        ${r.routes.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Route</th><th>Per day</th><th class="num">Received</th><th class="num">Failed</th><th class="num">Rate</th></tr></thead><tbody>${r.routes.map((s) => `<tr><td class="clip">${esc(s.name)}</td><td>${spark(s)}</td><td class="num">${s.total}</td><td class="num">${s.failed}</td>${rateCell(s.failed, s.total)}</tr>`).join("")}</tbody></table></div>` : none("mail")}</div>
      <div class="panel"><div class="panel-head"><h2>Failure rate by destination</h2></div>
        ${r.destinations.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Destination</th><th>Per day</th><th class="num">Attempts</th><th class="num">Failed</th><th class="num">Rate</th></tr></thead><tbody>${r.destinations.map((s) => `<tr><td class="clip">${esc(s.name)}${s.dryRun ? ` <span class="pill">${s.dryRun === s.total ? "dry-run" : s.dryRun + " dry-run"}</span>` : ""}</td><td>${spark(s)}</td><td class="num">${s.total}</td><td class="num">${s.failed}</td>${rateCell(s.failed, s.total)}</tr>`).join("")}</tbody></table></div>` : none("deliveries")}</div>
    </div>
    <div class="panel"><div class="panel-head"><h2>Top senders</h2><span class="count">${r.topSenders.length}</span></div>
      ${r.topSenders.length ? `<div class="tscroll"><table class="t"><thead><tr><th>Sender</th><th class="num">Messages</th><th class="num">Share</th><th class="num">Failed</th><th class="num">Failure rate</th><th></th></tr></thead><tbody>${r.topSenders.map((x) => `<tr><td class="mono clip">${esc(x.sender)}</td><td class="num">${x.total}</td><td class="num">${pct(x.total / t.total)}</td><td class="num">${x.failed}</td>${rateCell(x.failed, x.total)}<td><a class="link" href="#/history" data-sender="${esc(x.sender)}">History ›</a></td></tr>`).join("")}</tbody></table></div>` : none("mail")}</div>`;
  $$("[data-days]").forEach((b) => b.addEventListener("click", () => { statsDays = Number(b.dataset.days); route(); }));
  $$("[data-sender]").forEach((a) => a.addEventListener("click", () => { histQ = { ...HIST0, sender: a.dataset.sender }; }));
};
async function openMessage(id) {
  const m = await api("GET", `/api/messages/${id}`);
  const d = dialog(`<div class="dlg">${dlgHead(`Message #${m.id}`)}<div class="dlg-body">
    <dl class="kv"><dt>Status</dt><dd>${status(m.status)}</dd><dt>Received</dt><dd>${fmtDate(m.receivedAt)}</dd><dt>From</dt><dd>${esc(m.sender)}</dd><dt>To</dt><dd>${esc(m.recipients)}</dd><dt>Subject</dt><dd>${esc(m.subject)}</dd><dt>Route</dt><dd>${esc(m.routeName || "—")}</dd>${m.owner ? `<dt>Owner</dt><dd>${esc(m.owner)}</dd>` : ""}<dt>Priority</dt><dd>${m.priority ?? "route default"}</dd><dt>Attempts</dt><dd>${m.attempts}</dd>${m.lastError ? `<dt>Last error</dt><dd class="err-text">${esc(m.lastError)}</dd>` : ""}</dl>
    <div class="section"><h3>Notification</h3><div class="preview-box"><div class="pt">${esc(m.title)}</div><div style="white-space:pre-wrap;margin-top:4px">${esc(m.body)}</div></div></div>
    ${m.attachments?.length ? `<div class="section"><h3>Attachments</h3><table class="t"><tbody>${m.attachments.map((a) => `<tr><td><a href="/api/messages/${m.id}/attachments/${a.id}">${esc(a.filename)}</a></td><td class="faint">${esc(a.contentType)}</td><td class="num">${Math.ceil(a.size / 1024)} KB</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="section"><h3>Delivery log</h3><table class="t"><tbody>${m.events.map((e) => `<tr><td class="num nowrap" style="width:90px">${fmtTime(e.at)}</td><td style="width:120px">${esc(e.event)}</td><td class="faint">${esc(e.detail || "")}</td></tr>`).join("")}</tbody></table></div>
  </div><div class="dlg-foot">${can("messages:write") ? `<button class="btn danger" type="button" id="mDel" style="margin-right:auto">Discard</button>${["failed", "dead"].includes(m.status) ? '<button class="btn primary" type="button" id="mRetry">Retry now</button>' : ""}` : ""}<button class="btn quiet" type="button" data-close>Close</button></div></div>`, "w880");
  $("#mRetry")?.addEventListener("click", run(async () => { await api("POST", `/api/messages/${m.id}/retry`); d.close(); toast("Retried"); route(); }));
  $("#mDel")?.addEventListener("click", run(async () => { await api("DELETE", `/api/messages/${m.id}`); d.close(); toast("Discarded"); route(); }));
}
VIEWS.dead = async () => {
  const p = await api("GET", "/api/dead-letters");
  setHeader("Dead letters", `${p.total} messages used every retry`, can("messages:write") && p.total ? `<button class="btn primary" id="retryAll" type="button">${icon("retry")}Retry all</button>` : "");
  $("#content").innerHTML = `<div class="panel"><div class="panel-head"><h2>Dead letters</h2><span class="count">${p.total}</span><span class="help" style="margin-left:auto">After 5 failed attempts a message stops retrying. Fix the target, then retry.</span></div>${msgTable(p.items, emptyState("No dead letters", "Every message was delivered or is still being retried."))}</div>`;
  bindMsgRows();
  $("#retryAll")?.addEventListener("click", run(async () => { const x = await api("POST", "/api/dead-letters/retry"); toast(`Requeued ${x.requeued}`); route(); refreshFooter(); }));
};

// ---------- Test ----------
VIEWS.test = async () => {
  setHeader("Test email", "inject a message through the normal pipeline");
  $("#content").innerHTML = `<div class="grid-2"><div class="panel"><div class="panel-head"><h2>Message</h2></div><div class="panel-body"><form id="testForm" class="form">
      ${field("From", '<input name="from" value="test@mailbeacon.local">')}${field("To *", '<input name="to" required placeholder="proxmox@alerts.local">')}
      <label class="f full"><span>Subject</span><input name="subject" value="MailBeacon test"></label><label class="f full"><span>Body</span><textarea name="body" rows="5">This is a test message.</textarea></label>
      <div class="full btn-row"><button class="btn" type="button" id="previewBtn">Preview route</button><button class="btn primary" type="submit">Send test email</button></div></form></div></div>
    <div class="panel"><div class="panel-head"><h2>Result</h2></div><div class="panel-body" id="testOut"><span class="faint">Preview shows which route would take the mail. Nothing is sent until you click Send.</span></div></div></div>`;
  const f = $("#testForm"); const env = () => ({ from: f.from.value, to: f.to.value, subject: f.subject.value, body: f.body.value });
  $("#previewBtn").addEventListener("click", run(async () => {
    const p = await api("POST", "/api/routes/preview", env());
    $("#testOut").innerHTML = `<p style="margin-top:0">${p.accepted ? '<span class="st ok"><span class="mk"></span>Accepted</span>' : '<span class="st crit"><span class="mk"></span>Rejected</span>'} · ${esc(p.reason)}</p>
      <table class="t"><thead><tr><th>Route</th><th>Match</th><th>Result</th></tr></thead><tbody>${p.trace.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.matchType)}</td><td>${t.matches === true ? '<span class="st ok"><span class="mk"></span>Matches</span>' : t.matches === false ? '<span class="faint">no match</span>' : `<span class="faint">${esc(t.note || "")}</span>`}</td></tr>`).join("")}</tbody></table>`;
  }));
  f.addEventListener("submit", run(async () => {
    let x; try { x = await api("POST", "/api/test-email", env()); } catch (err) { $("#testOut").innerHTML = `<span class="st crit"><span class="mk"></span>${esc(err.message)}</span>`; return; }
    $("#testOut").innerHTML = `<p style="margin-top:0"><span class="st ok"><span class="mk"></span>Accepted</span>${x.route ? ` by route <strong>${esc(x.route)}</strong>` : ""}${x.dryRun ? " · dry-run: recorded only" : ""}.</p>${x.id ? `<button class="btn sm" type="button" id="openIt">Open message #${x.id}</button>` : ""}`;
    $("#openIt")?.addEventListener("click", run(() => openMessage(x.id)));
  }));
};

// ---------- Audit / logs ----------
let auditQ = { actor: "", action: "", q: "", offset: 0 };
VIEWS.audit = async () => {
  const qs = new URLSearchParams({ limit: "100", offset: String(auditQ.offset), ...Object.fromEntries(Object.entries(auditQ).filter(([k, v]) => v && k !== "offset")) });
  const p = await api("GET", "/api/audit?" + qs);
  setHeader("Audit log", `${p.total} entries · who changed what, and when`);
  $("#content").innerHTML = `<div class="panel"><div class="panel-head"><h2>Entries</h2><span class="count">${p.total}</span><div class="right">
      <input id="aActor" placeholder="User" value="${esc(auditQ.actor)}" style="width:140px" aria-label="User"><input id="aAction" placeholder="Action, e.g. route." value="${esc(auditQ.action)}" style="width:160px" aria-label="Action"><input id="aQ" placeholder="Search" value="${esc(auditQ.q)}" style="width:200px" aria-label="Search"></div></div>
    ${p.items.length ? `<table class="t"><thead><tr><th class="num">Time</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead><tbody>
    ${p.items.map((a) => `<tr><td class="num nowrap">${fmtDate(a.at)}</td><td class="nowrap">${esc(a.actor)}</td><td class="nowrap mono">${esc(a.action)}</td><td class="mono nowrap">${esc(a.target || "")}</td><td class="clip">${esc(a.detail || "")}</td><td class="mono faint">${esc(a.ip || "")}</td></tr>`).join("")}</tbody></table>` : emptyState("No audit entries match", "Changes to routes, destinations, users and settings are recorded here.")}
    ${pager(auditQ.offset, 100, p.total, "aPrev", "aNext")}</div>`;
  for (const [id, k] of [["aActor", "actor"], ["aAction", "action"], ["aQ", "q"]]) $("#" + id).addEventListener("change", (e) => { auditQ = { ...auditQ, [k]: e.target.value, offset: 0 }; route(); });
  $("#aPrev").addEventListener("click", () => { auditQ.offset = Math.max(0, auditQ.offset - 100); route(); });
  $("#aNext").addEventListener("click", () => { auditQ.offset += 100; route(); });
};
VIEWS.logs = async () => {
  const logs = await api("GET", "/api/logs");
  setHeader("Logs", `${logs.length} recent lines`);
  $("#content").innerHTML = `<div class="panel">${logs.length ? `<table class="t"><thead><tr><th class="num">Time</th><th>Level</th><th>Message</th></tr></thead><tbody>${logs.map((l) => `<tr><td class="num nowrap">${fmtDate(l.at)}</td><td><span class="sev ${l.level === "error" ? "crit" : l.level === "warn" ? "warn" : "info"}">${esc(l.level)}</span></td><td>${esc(l.msg)}</td></tr>`).join("")}</tbody></table>` : emptyState("No log lines", "Nothing at this level yet.")}</div>`;
};

// ---------- Settings ----------
const SETTINGS_TABS = [["general", "General"], ["smtp", "SMTP and limits"], ["auth", "Sign-in and SSO"], ["destinations", "Alerts and tests"], ["users", "Users"], ["backup", "Backup and retention"]];
const SETTINGS = {};
// Hand-made index so the search box can point at settings on other tabs.
const SETTINGS_INDEX = {
  general: "time zone|public address url|gravatar pictures avatars|gotify server default|dry-run|setup wizard|self-test",
  smtp: "smtp port|starttls encryption tls certificate|require login smtp auth|smtp users password|attachment size largest|attachments per message|connections at once|per device ip|emails per minute rate|recipients|limits flood|test smtp",
  auth: "single sign-on sso oidc openid|issuer url|client id|client secret|who may sign in allowed|password sign-in local|scopes|admin groups|editor groups|viewer groups|roles default role|groups claim|authentik keycloak authelia|test oidc|redirect uri",
  destinations: "self-alerts|send alerts to|self-test fails|dead letters|failures in a row down unreachable|quiet time cool-down|test alert|test destination send test|destination health|recent alerts",
  users: "users|invite|roles|api keys tokens|reset password|disable",
  backup: "backup export|restore import|download|database|retention keep history days|attachments delete purge clean-up old data",
};
const SAVED_AT = {};
let LAST_SUBMIT = null, SETTINGS_Q = "";
const formSig = (f) => JSON.stringify([...f.elements].filter((el) => el.name && el.type !== "password").map((el) => [el.name, el.type === "checkbox" ? el.checked : el.value]));
const dirtyForms = () => $$("form[data-track]").filter((f) => f.dataset.sig !== formSig(f) || [...f.elements].some((el) => el.type === "password" && el.value));
function paintSaveState(f) {
  const el = $(`.save-state[data-for="${f.id}"]`); if (!el) return;
  const dirty = dirtyForms().includes(f);
  f.closest(".panel")?.classList.toggle("dirty", dirty);
  el.className = `save-state small ${dirty ? "is-dirty" : SAVED_AT[f.id] ? "is-saved" : ""}`;
  const dis = el.nextElementSibling; if (dis?.classList.contains("discard")) dis.hidden = !dirty;
  el.textContent = dirty ? "Unsaved change" + (dirtyForms().length > 1 ? "s" : "") : SAVED_AT[f.id] ? `Saved ${SAVED_AT[f.id]}` : "No changes";
}
function trackForms() {
  $$(".save-state[data-for]").forEach((el) => {
    const f = document.getElementById(el.dataset.for); if (!f) return;
    f.dataset.track = "1"; f.dataset.sig = formSig(f);
    if (!el.nextElementSibling?.classList.contains("discard")) el.insertAdjacentHTML("afterend", `<button type="button" class="btn quiet discard" hidden>Discard</button>`);
    const dis = el.nextElementSibling;
    dis.onclick = () => { f.reset(); f.dispatchEvent(new window.Event("change")); paintSaveState(f); };
    const upd = () => paintSaveState(f);
    f.addEventListener("input", upd); f.addEventListener("change", upd);
    f.addEventListener("submit", () => { LAST_SUBMIT = f; }, true);
    upd();
  });
}
/** Called after a settings form saved successfully. */
function settingsSaved() {
  const f = LAST_SUBMIT; if (!f) return;
  SAVED_AT[f.id] = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  f.dataset.sig = formSig(f); $$("input[type=password]", f).forEach((p) => { p.value = ""; });
  paintSaveState(f);
}
window.addEventListener("beforeunload", (e) => { if (dirtyForms().length) { e.preventDefault(); e.returnValue = ""; } });
function applySettingsSearch() {
  const q = SETTINGS_Q.trim().toLowerCase();
  const hit = (el) => !q || el.textContent.toLowerCase().includes(q);
  $$("#content .panel").forEach((p) => {
    const titleHit = hit($(".panel-head", p) || p);
    let any = titleHit;
    $$(".f", p).forEach((f) => { const ok = titleHit || hit(f); f.hidden = !ok; if (ok && q && !titleHit) any = true; });
    $$("details.adv", p).forEach((d) => { if (q && $$(".f", d).some((f) => !f.hidden)) d.open = true; });
    if (!q || any || hit(p)) p.hidden = false; else p.hidden = true;
  });
  const cur = location.hash.split("/")[2] || "general";
  const others = q ? SETTINGS_TABS.filter(([k]) => k !== cur && SETTINGS_INDEX[k].split("|").some((x) => x.includes(q))) : [];
  const shown = $$("#content .panel").some((p) => !p.hidden);
  $("#setSearchOut").innerHTML = !q ? "" : `${shown ? "" : "No settings on this tab match. "}${others.length ? `Also on: ${others.map(([k, l]) => `<a href="#/settings/${k}">${esc(l)}</a>`).join(", ")}` : shown ? "" : "Nothing else matches either."}`;
}
VIEWS.settings = async (sub) => {
  const tab = SETTINGS_TABS.some(([k]) => k === sub) ? sub : "general";
  const s = await api("GET", "/api/settings");
  setHeader("Settings", SETTINGS_TABS.find(([k]) => k === tab)[1]);
  setTabs(SETTINGS_TABS, tab, "settings");
  await SETTINGS[tab](s);
  $("#tabs .tabbar").insertAdjacentHTML("beforeend", `<div class="set-search"><input type="search" id="setSearch" placeholder="Search settings" aria-label="Search settings, e.g. time zone or STARTTLS" value="${esc(SETTINGS_Q)}" autocomplete="off"><span class="kbd" aria-hidden="true">/</span></div>`);
  $("#content").insertAdjacentHTML("afterbegin", `<span id="setSearchOut" class="small faint search-out" role="status"></span>`);
  $("#setSearch").addEventListener("input", (e) => { SETTINGS_Q = e.target.value; applySettingsSearch(); });
  trackForms(); applySettingsSearch();
};
const panel = (title, body, foot = "", desc = "") => `<div class="panel"><div class="panel-head"><div><h2>${title}</h2>${desc ? `<p class="panel-desc">${desc}</p>` : ""}</div></div><div class="panel-body">${body}</div>${foot ? `<div class="panel-foot">${foot}</div>` : ""}</div>`;
const saveFoot = (id, label = "Save") => `<span class="save-state small" data-for="${id}" aria-live="polite"></span><button class="btn primary" form="${id}" type="submit">${label}</button>`;
const saveSettings = async (body, msg = "Settings saved") => { await api("PUT", "/api/settings", body); settingsSaved(); toast(msg); };
const zoneList = (id) => `<datalist id="${id}">${(Intl.supportedValuesOf?.("timeZone") || []).map((z) => `<option value="${esc(z)}">`).join("")}</datalist>`;

// Settings helpers: every field gets help text and its default; rare options go under "Advanced".
const sField = (label, input, help, dflt) => field(label, input, `${help}${dflt !== undefined ? ` <span class="dflt">default: ${dflt}</span>` : ""}`);
const sCheck = (name, checked, label, help, dflt, extra = "") => `<div class="f"><label class="check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""} ${extra}> ${label}</label><span class="help">${help}${dflt !== undefined ? ` <span class="dflt">Default: ${dflt}</span>` : ""}</span></div>`;
const adv = (inner, cols = "") => `<details class="adv full"><summary>Advanced</summary><div class="form ${cols}" style="padding-top:8px">${inner}</div></details>`;
const testOut = (id) => `<span id="${id}" class="small test-out" role="status"></span>`;
const showTest = (id, ok, html) => { $("#" + id).innerHTML = `<span class="st ${ok ? "ok" : "crit"}"><span class="mk"></span>${html}</span>`; };

SETTINGS.general = async (s) => {
  const st = await api("GET", "/api/selftest").catch(() => null);
  $("#content").innerHTML = `<div class="grid-2">
    ${panel("General", `<form id="genForm" class="form" style="grid-template-columns:1fr">
      ${sField("Time zone", `<input name="timezone" value="${esc(s.timezone)}" list="tzList" placeholder="Europe/London" required>`, "Used for quiet hours, digests and times in templates. An IANA name such as Europe/London.", "UTC")}
      ${sField("Public address of MailBeacon", `<input name="publicUrl" type="url" value="${esc(s.publicUrl)}" placeholder="https://mailbeacon.example.com">`, "The URL people open MailBeacon at. Needed for single sign-on. Blank = work it out from each request.", "blank")}
      ${sCheck("gravatar", s.gravatar, "Show Gravatar pictures for users", `Browsers fetch pictures from gravatar.com using a hash of the user's email.${s.gravatarLocked ? " Locked off by MAILBEACON_GRAVATAR=0." : ""}`, "on", s.gravatarLocked ? "disabled" : "")}
      ${adv(`${sField("Gotify server for routes without one", `<input name="gotifyUrl" type="url" value="${esc(s.gotifyUrl)}" placeholder="https://gotify.example.com">`, "Only used by Gotify destinations that leave their server URL blank.", "blank")}`, "c1")}
      <p class="help full" style="margin:0">Dry-run mode is <strong>${s.dryRun ? "on" : "off"}</strong>: ${s.dryRun ? "mail is routed and recorded but nothing is sent." : "notifications are really sent."} Set with MAILBEACON_DRY_RUN.</p>
      </form>${zoneList("tzList")}`, saveFoot("genForm"), "Time zone, the address MailBeacon is reached at, and user pictures.")}
    ${panel("Branding", `<form id="brandForm" class="form" style="grid-template-columns:1fr">
      ${sField("App name", `<input name="appName" maxlength="40" value="${esc(s.appName === "MailBeacon" ? "" : s.appName)}" placeholder="MailBeacon">`, "Shown in the sidebar, the sign-in page and the browser tab. Up to 40 characters.", "MailBeacon")}
      ${sField("Default theme", `<select name="defaultTheme">${[["dark", "Dark"], ["light", "Light"], ["system", "Follow the system"]].map(([v, l]) => `<option value="${v}" ${v === s.defaultTheme ? "selected" : ""}>${l}</option>`).join("")}</select>`, "For people who haven't picked a theme in their profile.", "Dark")}
      <div class="f"><span>Logo</span><div class="logo-row"><span class="logo-prev"><img src="${esc(s.logoUrl || "/favicon.svg")}" alt="Current logo"></span>
        <label class="btn sm">${icon("plus")}Upload logo<input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
        ${s.logoUrl ? '<button class="btn sm danger" type="button" id="logoDel">Remove</button>' : ""}</div>
        <span class="help">PNG, JPEG, WebP or GIF up to 1 MB (no SVG). Shrunk to at most 256 px and used as the logo and browser icon.</span><span id="logoErr" class="err-text"></span></div>
      </form>`, saveFoot("brandForm"), "Your own name and logo instead of MailBeacon's.")}
    ${panel("Setup wizard", `<p class="help" style="margin:0">Your account and current settings are kept; each step can be skipped.${STATUS?.wizardDone ? " It was completed before; nothing changes unless you save a step." : ""}</p>`, '<button class="btn" type="button" id="rerunWizard">Run setup wizard</button>', "Step through SMTP, a destination, a route and single sign-on again.")}
    ${panel("Self-test", `${st ? `<table class="t"><tbody>${st.checks.map((c) => `<tr><td style="width:100px">${c.ok ? '<span class="st ok"><span class="mk"></span>OK</span>' : '<span class="st crit"><span class="mk"></span>Problem</span>'}</td><td>${esc(c.name)}</td><td class="faint">${esc(c.detail)}</td></tr>`).join("")}</tbody></table><p class="faint small">Last run ${fmtDate(st.at)}</p>` : '<p class="faint">Not run yet.</p>'}`, '<button class="btn" type="button" id="runSelf">Run self-test now</button>', "Checks at start-up that destinations are configured and every route has somewhere to send. Sends nothing.")}
  </div>`;
  $("#genForm").addEventListener("submit", run(async (e) => { const f = e.target; await saveSettings({ gotifyUrl: f.gotifyUrl.value, timezone: f.timezone.value || "UTC", publicUrl: f.publicUrl.value, ...(s.gravatarLocked ? {} : { gravatar: f.gravatar.checked }) }); }));
  $("#rerunWizard")?.addEventListener("click", () => startWizard({ fresh: false }));
  const rebrand = async () => { STATUS = await fetch("/api/status").then((r) => r.json()); applyBrand(); applyTheme(); };
  $("#brandForm").addEventListener("submit", run(async (e) => { const f = e.target; await saveSettings({ appName: f.appName.value.trim(), defaultTheme: f.defaultTheme.value }, "Branding saved"); await rebrand(); route(); }));
  $("#logoFile").addEventListener("change", run(async (e) => {
    const file = e.target.files[0]; if (!file) return;
    $("#logoErr").textContent = "";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { $("#logoErr").textContent = "Choose a PNG, JPEG, WebP or GIF image (SVG is not accepted)."; return; }
    if (file.size > 1024 * 1024) { $("#logoErr").textContent = `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 1 MB.`; return; }
    try { await api("POST", "/api/branding/logo", file, { "Content-Type": file.type }); } catch (err) { $("#logoErr").textContent = err.message; return; }
    toast("Logo updated"); await rebrand(); route();
  }));
  $("#logoDel")?.addEventListener("click", run(async () => { await api("DELETE", "/api/branding/logo"); toast("Logo removed"); await rebrand(); route(); }));
  $("#runSelf").addEventListener("click", run(async () => { await api("POST", "/api/selftest"); route(); }));
};
SETTINGS.smtp = async (s) => {
  const L = s.limits, A = s.attachments;
  const num = (n, v, min = 0, max = 100000) => `<input name="${n}" type="number" min="${min}" max="${max}" step="1" required value="${v}">`;
  $("#content").innerHTML = `<div class="grid-2">
    ${panel("Incoming mail (SMTP)", `<form id="smtpForm" class="form" style="grid-template-columns:1fr">
      <p class="help" style="margin:0">Devices send to this host on port <strong class="mono">${esc(s.smtpPort ?? 2525)}</strong> inside the container (MAILBEACON_SMTP_PORT). Use your Docker-mapped port if it differs.</p>
      ${sCheck("smtpStarttls", s.smtpStarttls, "Offer encryption (STARTTLS)", "Uses the certificate in /data/tls, or a self-signed one. Devices that can't encrypt still work.", "off")}
      ${sCheck("smtpAuth", s.smtpAuth, "Require devices to log in (SMTP AUTH)", "Needs STARTTLS on: logins are refused on unencrypted connections. Add an SMTP user first.", "off")}
      </form>`, `<button class="btn" type="button" id="smtpTest">Test SMTP</button>${testOut("smtpTestOut")}${saveFoot("smtpForm")}`, "How devices connect to MailBeacon to hand over their email.")}
    ${panel("SMTP users", `<table class="t" style="margin-bottom:8px"><thead><tr><th>User name</th><th></th></tr></thead><tbody>${s.smtpUsers.length ? s.smtpUsers.map((u) => `<tr><td class="mono">${esc(u)}</td><td class="actions"><button class="btn sm danger" type="button" data-smtpdel="${esc(u)}">Remove</button></td></tr>`).join("") : '<tr><td class="faint" colspan="2">None yet. Only needed if devices must log in.</td></tr>'}</tbody></table>
      <form id="smtpUserForm" class="form">
        ${sField("User name", '<input name="username" required maxlength="64" autocomplete="off" placeholder="proxmox">', "What the device logs in with.")}
        ${sField("Password", '<input name="password" type="password" required minlength="8" autocomplete="new-password">', "At least 8 characters. Stored hashed.")}
      </form>`, '<button class="btn" type="submit" form="smtpUserForm">Add or update user</button>', "Logins for devices when “Require devices to log in” is on. Separate from web users.")}
    ${panel("Limits", `<form id="limForm" class="form">
      ${sField("Largest attachment (KB)", num("maxFileKb", A.maxFileKb), "Bigger files are dropped; the message still goes through.", "1024 KB")}
      ${sField("Attachments per message", num("maxCount", A.maxCount, 0, 100), "0 = never keep attachments.", "5")}
      ${adv(`
        ${sField("All attachments together (KB)", num("maxTotalKb", A.maxTotalKb), "Per message.", "5120 KB")}
        ${sField("Connections at once", num("maxConnections", L.maxConnections), "Over this, devices get “421 try later”. 0 = no limit.", "50")}
        ${sField("Connections at once per device (IP)", num("maxConnectionsPerIp", L.maxConnectionsPerIp), "0 = no limit.", "10")}
        ${sField("Emails per minute per device (IP)", num("messagesPerMinutePerIp", L.messagesPerMinutePerIp), "Over this, devices are told to retry later (450). 0 = no limit.", "60")}
        ${sField("Recipients per email", num("maxRecipients", L.maxRecipients), "0 = no limit.", "20")}
        ${sField("HTTP API messages per minute per key", num("apiPerMinute", L.apiPerMinute ?? 60), "For /api/send and webhooks. Over this, callers get 429 and Retry-After. 0 = no limit.", "60")}`)}
      </form>`, saveFoot("limForm"), "Protects MailBeacon and your notification apps from floods and huge attachments.")}
  </div>`;
  $("#smtpForm").addEventListener("submit", run(async (e) => { const f = e.target; await saveSettings({ smtpStarttls: f.smtpStarttls.checked, smtpAuth: f.smtpAuth.checked }, "SMTP settings saved"); route(); }));
  const sf = $("#smtpForm");
  sf.smtpAuth.addEventListener("change", () => { if (sf.smtpAuth.checked) sf.smtpStarttls.checked = true; });
  sf.smtpStarttls.addEventListener("change", () => { if (!sf.smtpStarttls.checked) sf.smtpAuth.checked = false; });
  $("#smtpTest").addEventListener("click", run(async () => {
    $("#smtpTestOut").innerHTML = '<span class="spinner" aria-hidden="true"></span> Connecting…';
    const r = await api("POST", "/api/smtp/test");
    showTest("smtpTestOut", r.ok, r.ok ? `Listening (${r.ms} ms) · STARTTLS ${r.starttls ? "on" : "off"} · login ${r.auth ? "offered" : "off"}` : esc(r.error));
  }));
  $("#limForm").addEventListener("submit", run(async (e) => { const f = e.target; const n = (k) => Number(f[k].value); await saveSettings({ limits: Object.fromEntries(["maxConnections", "maxConnectionsPerIp", "messagesPerMinutePerIp", "maxRecipients", "apiPerMinute"].map((k) => [k, n(k)])), attachments: Object.fromEntries(["maxFileKb", "maxTotalKb", "maxCount"].map((k) => [k, n(k)])) }, "Limits saved"); }));
  $("#smtpUserForm").addEventListener("submit", run(async (e) => { const f = e.target; await api("POST", "/api/smtp-users", { username: f.username.value, password: f.password.value }); toast("SMTP user saved"); route(); }));
  $$("[data-smtpdel]").forEach((b) => b.addEventListener("click", run(async () => { if (await confirmDlg(`Remove SMTP user ${b.dataset.smtpdel}`, "Devices using it can no longer send if login is required.", "Remove user")) { await api("DELETE", `/api/smtp-users/${encodeURIComponent(b.dataset.smtpdel)}`); route(); } })));
};
SETTINGS.auth = async (s) => {
  const t = (n, v, ph = "", extra = "") => `<input name="${n}" value="${esc(v)}" placeholder="${esc(ph)}" ${extra}>`;
  $("#content").innerHTML = `
    ${panel("Single sign-on (OpenID Connect)", `<p class="help" style="margin-top:0">In your provider, create a <strong>confidential</strong> client with this redirect URI: <code>${esc(s.oidcRedirectUri)}</code></p>
      ${s.oidcFromEnv ? '<p class="help">Some values come from environment variables and override what is saved here.</p>' : ""}
      <form id="oidcForm" class="form c3">
      ${sField("Issuer URL", t("oidcIssuer", s.oidcIssuer, "https://auth.example.com/application/o/mailbeacon/", 'type="url"'), "The provider's address. In Authentik: the provider's “OpenID Configuration Issuer”.", "blank = SSO off")}
      ${sField("Client ID", t("oidcClientId", s.oidcClientId, "", 'autocomplete="off"'), "Copied from the provider.")}
      ${sField("Client secret", `<input name="oidcClientSecret" type="password" autocomplete="new-password" placeholder="${s.oidcClientSecretSet ? "stored — leave blank to keep" : "not set"}">`, "Encrypted at rest and never shown again.")}
      ${sField("Who may sign in", t("oidcAllowed", s.oidcAllowed, "blank = anyone the provider lets in"), "Comma-separated emails or group names.", "anyone")}
      ${sCheck("localLoginDisabled", s.localLoginDisabled, "Turn off password sign-in", s.oidcLastSuccess ? `Only SSO can be used. Last SSO sign-in ${fmtDate(s.oidcLastSuccess)}.` : "Needs one successful SSO sign-in first, so you can't lock yourself out.", "off")}
      ${adv(sField("Scopes", t("oidcScopes", s.oidcScopes, "openid profile email"), "What MailBeacon asks the provider for. Authentik sends groups with profile.", "openid profile email"), "c1")}
      </form>`, `<button class="btn" type="button" id="oidcTest">Test OIDC</button>${testOut("oidcTestOut")}${saveFoot("oidcForm")}`, "Let people sign in with Authentik, Keycloak, Authelia or another OpenID Connect provider.")}
    ${panel("Roles from groups", `${s.oidcLegacyAllAdmin ? '<p class="err-text" style="margin-top:0">No groups are set, so every SSO user becomes an admin. Set the groups below.</p>' : ""}
      <form id="mapForm" class="form c3">
      ${sField("Admin groups", t("oidcAdminGroups", s.oidcAdminGroups, "mailbeacon-admins"), "Full control, including users and settings.", "none")}
      ${sField("Editor groups", t("oidcEditorGroups", s.oidcEditorGroups, "mailbeacon-editors"), "Their own routes, destinations and history.", "none")}
      ${sField("Viewer groups", t("oidcViewerGroups", s.oidcViewerGroups, "mailbeacon-viewers"), "Read only.", "none")}
      ${sField("People in none of these groups", `<select name="oidcDefaultRole">${[["none", "Refuse sign-in"], ["viewer", "Viewer"], ["editor", "Editor"], ["admin", "Admin"]].map(([v, l]) => `<option value="${v}" ${v === s.oidcDefaultRole ? "selected" : ""}>${l}</option>`).join("")}</select>`, "")}
      ${adv(sField("Groups claim", t("oidcGroupsClaim", s.oidcGroupsClaim, "groups"), "Name of the token field listing the user's groups.", "groups"), "c1")}
      </form>`, saveFoot("mapForm"), "Sets each SSO user's role from their groups at every sign-in. The highest match wins; the last admin is never demoted.")}`;
  $("#oidcForm").addEventListener("submit", run(async (e) => { const f = e.target; await saveSettings({ oidcIssuer: f.oidcIssuer.value, oidcClientId: f.oidcClientId.value, ...(f.oidcClientSecret.value ? { oidcClientSecret: f.oidcClientSecret.value } : {}), oidcScopes: f.oidcScopes.value, oidcAllowed: f.oidcAllowed.value, localLoginDisabled: f.localLoginDisabled.checked }, "SSO settings saved"); route(); }));
  $("#mapForm").addEventListener("submit", run(async (e) => { const f = e.target; await saveSettings(Object.fromEntries(["oidcGroupsClaim", "oidcAdminGroups", "oidcEditorGroups", "oidcViewerGroups", "oidcDefaultRole"].map((k) => [k, f[k].value])), "Role mapping saved"); route(); }));
  $("#oidcTest").addEventListener("click", run(async () => {
    const issuer = $("#oidcForm").oidcIssuer.value.trim();
    if (!issuer) return showTest("oidcTestOut", false, "Enter an issuer URL first");
    $("#oidcTestOut").innerHTML = '<span class="spinner" aria-hidden="true"></span> Contacting provider…';
    const r = await api("POST", "/api/oidc/test", { issuer });
    showTest("oidcTestOut", r.ok, r.ok ? `Provider found (${r.ms} ms). Sign in once to finish checking the client.` : esc(r.error));
  }));
};
SETTINGS.destinations = async () => {
  const [a, dests] = await Promise.all([api("GET", "/api/alerts"), api("GET", "/api/destinations")]);
  const A = a.settings;
  $("#content").innerHTML = `
    ${panel("Self-alerts", `<form id="alertForm" class="form c3">
      ${sCheck("enabled", A.enabled, "Send self-alerts", "Turn on to be told about problems.", "off")}
      ${sField("Send alerts to", `<select name="destinationId"><option value="">Choose a destination</option>${dests.map((d) => `<option value="${d.id}" ${d.id === A.destinationId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>`, `It is never alerted about itself. Manage them on <a href="#/destinations">Destinations</a>.`)}
      ${sCheck("onSelfTestFail", A.onSelfTestFail, "Alert when the self-test fails", "Checked at start-up and when run by hand.", "on")}
      ${adv(`
      ${sField("Dead letters before alerting", `<input name="deadLetterThreshold" type="number" min="1" max="100000" required value="${A.deadLetterThreshold}">`, "Messages that could not be delivered at all.", "5")}
      ${sField("Failures in a row before a destination counts as down", `<input name="unreachableAfter" type="number" min="1" max="1000" required value="${A.unreachableAfter}">`, "", "3")}
      ${sField("Quiet time between repeat alerts (minutes)", `<input name="cooldownMinutes" type="number" min="1" max="10080" required value="${A.cooldownMinutes}">`, "Per kind of alert.", "60")}`, "c3")}
      </form>`, `<button class="btn" type="button" id="alertTest">Send test alert</button>${saveFoot("alertForm")}`, "MailBeacon tells you when it is in trouble: undeliverable mail piling up, a destination that keeps failing, or a failed self-test.")}
    ${panel("Test a destination", dests.length ? `<form id="destTestForm" class="btn-row"><select name="id" aria-label="Destination to test">${dests.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select><button class="btn" type="submit">Send test</button>${testOut("destTestOut")}</form>` : emptyState("No destinations yet", "Add one first.", '<a class="btn" href="#/destinations">Add a destination</a>'), "", `Sends a short test notification${STATUS?.dryRun ? " (dry-run is on, so it is only recorded)" : ""}.`)}
    <div class="grid-2">
    <div class="panel"><div class="panel-head"><h2>Recent self-alerts</h2><span class="count">${a.history.length}</span></div>
      ${a.history.length ? `<table class="t"><thead><tr><th class="num">Time</th><th>Kind</th><th>Alert</th><th>Result</th></tr></thead><tbody>${a.history.slice(0, 20).map((h) => `<tr><td class="num nowrap">${fmtDate(h.at)}</td><td class="mono">${esc(h.kind)}</td><td class="clip">${esc(h.title)}</td><td>${h.sent ? '<span class="st ok"><span class="mk"></span>Sent</span>' : `<span class="st"><span class="mk"></span>${esc(h.detail || "Not sent")}</span>`}</td></tr>`).join("")}</tbody></table>` : emptyState("No alerts sent yet")}</div>
    <div class="panel"><div class="panel-head"><h2>Destination health</h2><span class="count">${a.health.length}</span></div>
      ${a.health.length ? `<table class="t"><thead><tr><th>Destination</th><th>Status</th><th class="num">Fails</th><th class="num">Last OK</th><th>Last error</th></tr></thead><tbody>${a.health.map((h) => `<tr><td>${esc(h.name)}<div class="faint mono small">${esc(h.key)}</div></td><td>${healthSt(h)}</td><td class="num">${h.failures}</td><td class="num">${h.lastOk ? ago(h.lastOk) : "—"}</td><td class="clip faint">${esc(h.lastError || "")}</td></tr>`).join("")}</tbody></table>` : emptyState("No deliveries since start-up")}</div>
    </div>`;
  $("#alertForm").addEventListener("submit", run(async (e) => { const f = e.target; await api("PUT", "/api/alerts", { enabled: f.enabled.checked, destinationId: f.destinationId.value ? Number(f.destinationId.value) : null, cooldownMinutes: Number(f.cooldownMinutes.value), deadLetterThreshold: Number(f.deadLetterThreshold.value), unreachableAfter: Number(f.unreachableAfter.value), onSelfTestFail: f.onSelfTestFail.checked }); settingsSaved(); toast("Self-alerts saved"); }));
  $("#alertTest").addEventListener("click", run(async () => { const r = await api("POST", "/api/alerts/test"); toast(r.sent ? "Test alert sent" : `Test alert recorded: ${r.detail}`); route(); }));
  $("#destTestForm")?.addEventListener("submit", run(async (e) => {
    try { const r = await api("POST", `/api/destinations/${e.target.elements.id.value}/test`); showTest("destTestOut", true, r.dryRun ? "Dry-run: test recorded, nothing sent" : "Test notification sent"); }
    catch (err) { showTest("destTestOut", false, esc(err.message)); }
  }));
};
SETTINGS.users = async () => {
  const [users, keys] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/keys?all=1")]);
  $("#content").innerHTML = `<div class="panel"><div class="panel-head"><div><h2>Users</h2><p class="panel-desc">People who can sign in to this web interface, and what they may do.</p></div><span class="count">${users.length}</span><div class="right"><button class="btn primary sm" type="button" id="addUser">${icon("plus")}Add user</button></div></div>
    <table class="t"><thead><tr><th style="width:40px"></th><th>User</th><th>Role</th><th>Sign-in</th><th>Status</th><th class="num">API keys</th><th class="num">Last sign-in</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${avatarHtml(u.avatar)}</td><td>${esc(u.displayName)}<div class="faint small">${esc(u.username)}${u.email ? " · " + esc(u.email) : ""}</div></td><td>${esc(u.role)}</td><td>${[u.hasPassword ? "Password" : "", u.oidcSub ? "SSO" : ""].filter(Boolean).join(" + ") || '<span class="faint">none</span>'}</td>
      <td>${u.disabled ? '<span class="st"><span class="mk"></span>Disabled</span>' : '<span class="st ok"><span class="mk"></span>Active</span>'}</td><td class="num">${u.apiKeys}</td><td class="num nowrap">${u.lastLogin ? ago(u.lastLogin) : "never"}</td>
      <td class="actions"><button class="btn sm" type="button" data-uedit="${u.id}">Edit</button>${u.id !== ME.id ? `<button class="btn sm danger" type="button" data-udel="${u.id}">Delete</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
    <div class="panel"><div class="panel-head"><div><h2>Roles</h2><p class="panel-desc">What each role can do. Set a user's role with Edit.</p></div></div><table class="t"><thead><tr><th>Role</th><th>Can</th></tr></thead><tbody>
      <tr><td>Admin</td><td>Everything: all users' routes, destinations and history, settings, users, audit log, backup.</td></tr>
      <tr><td>Editor</td><td>Create and change their own routes and destinations; see, retry and discard their own messages; send tests; own API keys.</td></tr>
      <tr><td>Viewer</td><td>Read their own routes, destinations and history. Own API keys with read scopes.</td></tr></tbody></table></div>
    <div class="panel"><div class="panel-head"><div><h2>All API keys</h2><p class="panel-desc">Tokens scripts use instead of a password. Each user manages their own on their profile.</p></div><span class="count">${keys.length}</span></div>
      ${keys.length ? `<table class="t"><thead><tr><th>Name</th><th>Owner</th><th>Key</th><th>Scopes</th><th class="num">Last used</th><th class="num">Expires</th><th></th></tr></thead><tbody>${keys.map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.owner)}</td><td class="mono">mbk_${k.id}_${esc(k.prefix)}…</td><td>${k.scopes.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ")}</td><td class="num">${k.lastUsed ? ago(k.lastUsed) : "never"}</td><td class="num">${k.expiresAt ? fmtDate(k.expiresAt) : "never"}</td><td class="actions"><button class="btn sm danger" type="button" data-krev="${k.id}">Revoke</button></td></tr>`).join("")}</tbody></table>` : emptyState("No API keys", "Users create keys from their profile.")}</div>`;
  $("#addUser").addEventListener("click", () => openUser(null));
  $$("[data-uedit]").forEach((b) => b.addEventListener("click", () => openUser(users.find((u) => u.id === Number(b.dataset.uedit)))));
  $$("[data-udel]").forEach((b) => b.addEventListener("click", run(async () => { const u = users.find((x) => x.id === Number(b.dataset.udel)); if (await confirmDlg(`Delete user ${u.username}`, "Their routes, destinations and history move to you. Their API keys stop working.", "Delete user")) { await api("DELETE", `/api/users/${u.id}`); toast("User deleted"); route(); } })));
  $$("[data-krev]").forEach((b) => b.addEventListener("click", run(async () => { if (await confirmDlg("Revoke API key", "Scripts using it will get 401 from now on.", "Revoke key")) { await api("DELETE", `/api/keys/${b.dataset.krev}`); route(); } })));
};
function openUser(u) {
  const d = dialog(`<form class="dlg" id="userForm">${dlgHead(u ? `Edit ${u.username}` : "Add user")}<div class="dlg-body"><div class="form">
    ${field("User name *", `<input name="username" required ${u ? `value="${esc(u.username)}" disabled` : ""} autocomplete="off">`, u ? "" : "Letters, digits, . @ - _")}
    ${field("Role", `<select name="role">${["viewer", "editor", "admin"].map((r) => `<option ${r === (u?.role || "editor") ? "selected" : ""}>${r}</option>`).join("")}</select>`)}
    ${field("Display name", `<input name="displayName" value="${esc(u?.displayName || "")}">`)}
    ${field("Email", `<input name="email" type="email" value="${esc(u?.email || "")}">`)}
    ${field(u ? "Reset password" : "Password", `<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="${u ? "leave blank to keep" : "blank = SSO only"}">`, "At least 8 characters")}
    ${u ? `<div class="f"><span>Status</span><label class="check"><input type="checkbox" name="disabled" ${u.disabled ? "checked" : ""}> Disabled (signs them out)</label></div>` : ""}
    </div></div><div class="dlg-foot"><span id="userErr" class="err-text" style="margin-right:auto"></span><button class="btn quiet" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${u ? "Save user" : "Add user"}</button></div></form>`, "w480");
  $("#userForm").addEventListener("submit", run(async (e) => {
    const f = e.target;
    try {
      if (u) {
        await api("PUT", `/api/users/${u.id}`, { role: f.role.value, displayName: f.displayName.value, email: f.email.value || null, disabled: f.disabled.checked });
        if (f.password.value) await api("POST", `/api/users/${u.id}/password`, { password: f.password.value });
      } else await api("POST", "/api/users", { username: f.username.value, role: f.role.value, displayName: f.displayName.value || undefined, email: f.email.value || undefined, password: f.password.value || undefined });
    } catch (err) { $("#userErr").textContent = err.message; return; }
    d.close(); toast(u ? "User saved" : "User added"); route();
  }));
}
SETTINGS.backup = async () => {
  const ret = await api("GET", "/api/retention");
  $("#content").innerHTML = `<div class="grid-2">
    ${panel("Retention", `<form id="retForm" class="form" data-track>
      ${sField("Keep history for (days)", `<input name="historyDays" type="number" min="0" max="${ret.maxDays}" step="1" required value="${ret.historyDays}">`, "Finished messages (delivered, dead letters, suppressed) older than this are deleted with their delivery log and attachments, once an hour. Pending, retrying and held mail is never deleted. 0 keeps history forever.", "0 (forever)")}
      ${sField("Keep attachments for (days)", `<input name="attachmentDays" type="number" min="0" max="${ret.maxDays}" step="1" required value="${ret.attachmentDays}">`, "Attachments are most of the database. After this many days they are removed but the message stays in History. 0 keeps them forever.", "30")}
      </form>`, `<span class="save-state" data-for="retForm"></span><button class="btn primary" form="retForm" type="submit">Save</button>`, "How long MailBeacon keeps received mail.")}
    ${panel("Delete old data now", `<form id="purgeForm" class="form">
      ${field("Delete", '<select name="what"><option value="history">Messages (with attachments and delivery log)</option><option value="attachments">Attachments only</option></select>')}
      ${field("Older than (days)", '<input name="olderThanDays" type="number" min="0" step="1" required value="90">', "Same rules as retention: only finished messages. You see how much would go before anything is deleted. Written to the audit log.")}
      </form><div id="purgeOut" class="small" style="margin-top:6px"></div>`, '<button class="btn danger" form="purgeForm" type="submit">Delete…</button>', "A one-off clean-up, for admins.")}
  </div>
  <div class="grid-2">
    ${panel("Export configuration", `<p class="help" style="margin-top:0">Settings, users (without passwords), destinations and routes as JSON. Message history, uploaded pictures and SMTP user passwords are not included.</p>
      <form id="expForm" class="form" style="grid-template-columns:1fr">
      <div class="f"><span>Secrets (tokens, webhook URLs)</span><label class="check"><input type="radio" name="secrets" value="exclude" checked> Leave out — imported items start disabled</label><label class="check"><input type="radio" name="secrets" value="encrypt"> Include, encrypted with a passphrase</label></div>
      ${field("Passphrase", '<input name="passphrase" type="password" minlength="12" autocomplete="new-password" placeholder="12 characters or more">', "Needed to import the secrets again. It is not stored anywhere.")}
      </form>`, '<button class="btn" form="expForm" type="submit">Download export</button>', "Save your settings, users, destinations and routes to a file.")}
    ${panel("Import configuration", `<p class="help" style="margin-top:0">Always checked first: you see what would change before anything is written. Merge adds alongside what exists; Replace removes current routes and destinations first.</p>
      <form id="impForm" class="form" style="grid-template-columns:1fr">
      ${field("Export file", '<input name="file" type="file" accept="application/json,.json" required>')}
      ${field("Mode", '<select name="mode"><option value="merge">Merge</option><option value="replace">Replace routes and destinations</option></select>')}
      ${field("Passphrase", '<input name="passphrase" type="password" autocomplete="off" placeholder="only for encrypted exports">')}
      </form><div id="impOut" style="margin-top:8px"></div>`, '<button class="btn" form="impForm" type="submit">Check import</button><button class="btn primary" type="button" id="impApply" disabled>Apply import</button>')}
  </div>`;
  $("#retForm").addEventListener("submit", run(async (e) => {
    e.preventDefault(); const f = e.target;
    await api("PUT", "/api/retention", { historyDays: Number(f.historyDays.value), attachmentDays: Number(f.attachmentDays.value) });
    LAST_SUBMIT = f; toast("Retention saved"); route();
  }));
  $("#purgeForm").addEventListener("submit", run(async (e) => {
    e.preventDefault(); const f = e.target;
    const body = { what: f.what.value, olderThanDays: Number(f.olderThanDays.value) };
    const n = await api("POST", "/api/retention/purge", { ...body, dryRun: true });
    const what = body.what === "history" ? `${plural(n.messages, "message")} and ${plural(n.attachments, "attachment")}` : `${plural(n.attachments, "attachment")} (${Math.ceil(n.attachmentBytes / 1024)} KB)`;
    if (!(body.what === "history" ? n.messages || n.attachments : n.attachments)) { $("#purgeOut").textContent = `Nothing older than ${body.olderThanDays} days to delete.`; return; }
    if (!(await confirmDlg("Delete old data", `This permanently deletes ${what} received before ${fmtDate(n.before)}. It can't be undone.`, "Delete"))) return;
    const x = await api("POST", "/api/retention/purge", { ...body, dryRun: false, confirm: true });
    $("#purgeOut").textContent = `Deleted ${plural(x.messages, "message")} and ${plural(x.attachments, "attachment")}.`; toast("Old data deleted");
  }));
  $("#expForm").addEventListener("submit", run(async (e) => {
    const f = e.target;
    const x = await api("POST", "/api/config/export", { secrets: f.secrets.value, passphrase: f.secrets.value === "encrypt" ? f.passphrase.value : undefined });
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(x, null, 2)], { type: "application/json" }));
    a.download = `mailbeacon-config-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    f.passphrase.value = ""; toast("Export downloaded");
  }));
  const doImport = async (dryRun) => {
    const f = $("#impForm"); const file = f.file.files[0]; if (!file) throw new Error("choose an export file");
    let config; try { config = JSON.parse(await file.text()); } catch { throw new Error("that file is not JSON"); }
    const sum = await api("POST", "/api/config/import", { config, passphrase: f.passphrase.value || undefined, mode: f.mode.value, dryRun });
    $("#impOut").innerHTML = `<table class="t"><thead><tr><th></th><th class="num">Routes</th><th class="num">Destinations</th><th class="num">Users</th></tr></thead><tbody>
      <tr><td>${dryRun ? "Would add" : "Added"}</td><td class="num">${sum.created.routes}</td><td class="num">${sum.created.destinations}</td><td class="num">${sum.created.users}</td></tr>
      <tr><td>${dryRun ? "Would remove" : "Removed"}</td><td class="num">${sum.removed.routes}</td><td class="num">${sum.removed.destinations}</td><td class="num">—</td></tr></tbody></table>
      <p class="small">Settings: ${sum.settings} · secrets ${sum.secretsRestored ? "restored" : "not restored"}.</p>${sum.warnings.length ? `<ul class="small muted">${sum.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`;
    return sum;
  };
  $("#impForm").addEventListener("submit", run(async () => { await doImport(true); $("#impApply").disabled = false; }));
  $("#impApply").addEventListener("click", run(async () => { if (!(await confirmDlg("Apply import", "This writes the changes shown. Take an export first if you may want to go back.", "Apply import"))) return; await doImport(false); $("#impApply").disabled = true; toast("Import applied"); }));
};

// ---------- Profile ----------
async function openProfile(tab = "profile") {
  ME = await api("GET", "/api/me");
  const keys = await api("GET", "/api/keys");
  const a = ME.avatar;
  const label = { oidc: "Identity provider", gravatar: "Gravatar", upload: "Uploaded picture", initials: "Initials only" };
  const why = (s) => a.available.includes(s) ? { oidc: "The picture your SSO provider sends.", gravatar: "Looked up by your email at gravatar.com; initials if you have none.", upload: "PNG, JPEG, WebP or GIF, up to 5 MB. Stored as a 256 px square.", initials: "No picture." }[s]
    : { oidc: "Your provider hasn't sent a picture claim.", gravatar: ME.email ? "Turned off by the admin." : "Add an email first.", upload: "Upload a PNG, JPEG, WebP or GIF, up to 5 MB. Stored as a 256 px square." }[s];
  const scopeList = ["routes:read", "routes:write", "destinations:read", "destinations:write", "messages:read", "messages:write", "test:send", "messages:send", "admin"].filter((s) => ME.perms.includes(s));
  const d = dialog(`<div class="dlg">${dlgHead("Profile")}
    ${paneTabs(null, [["profile", "Profile"], ["security", "Password"], ["keys", "API keys"], ["prefs", "Preferences"]], tab)}
    <div class="dlg-body">
      <div data-p="profile">
        <div style="display:flex;gap:16px;align-items:flex-start">
          ${avatarHtml(a, "lg")}
          <form id="pForm" class="form" style="flex:1">
            ${field("Display name", `<input name="displayName" required maxlength="100" value="${esc(ME.displayName)}">`)}
            ${field("Email", `<input name="email" type="email" value="${esc(ME.email || "")}">`, "Used for Gravatar. Never used to link SSO accounts.")}
            <div class="full faint small">Signed in as <span class="mono">${esc(ME.username)}</span> · ${esc(ME.role)}${ME.sso ? " · single sign-on" : ""}</div>
          </form>
        </div>
        <div class="section"><h3>Picture</h3><p class="help">Shown in the header and the user list. Automatic: your identity provider's picture if it sends one, otherwise Gravatar, otherwise initials.</p>
          <table class="t"><tbody>${["oidc", "gravatar", "upload", "initials"].map((s) => `<tr><td style="width:28px"><input type="radio" name="avsrc" value="${s}" ${a.source === s ? "checked" : ""} ${a.available.includes(s) ? "" : "disabled"} aria-label="${label[s]}"></td><td class="nowrap">${label[s]}${a.chosen == null && a.source === s ? ' <span class="faint small">(automatic)</span>' : ""}</td><td class="faint small">${why(s)}</td><td class="actions">${s === "upload" ? `<label class="btn sm">Upload…<input type="file" id="pFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>${a.available.includes("upload") ? '<button class="btn sm danger" type="button" id="pRm">Remove</button>' : ""}` : ""}</td></tr>`).join("")}</tbody></table>
          <p id="pAvErr" class="err-text"></p></div>
      </div>
      <div data-p="security" hidden>
        ${ME.hasPassword ? `<form id="pwForm" class="form" style="max-width:420px;grid-template-columns:1fr">
          ${field("Current password", '<input name="current" type="password" required autocomplete="current-password">')}
          ${field("New password", '<input name="password" type="password" required minlength="8" autocomplete="new-password">', "At least 8 characters.")}
          ${field("Repeat new password", '<input name="again" type="password" required minlength="8" autocomplete="new-password">')}
          <div><button class="btn" type="submit">Change password</button> <span id="pwMsg" class="small"></span></div></form>`
          : '<p class="muted" style="margin-top:0">You sign in with single sign-on, so your password is managed by your identity provider.</p>'}
      </div>
      <div data-p="keys" hidden>
        <p class="help" style="margin-top:0">Use a key in scripts as <code>Authorization: Bearer mbk_…</code>. A key can never do more than your role allows, and is shown only once. For apps that post webhooks, give a key only <strong>messages:send</strong> and use <code>POST /api/webhook/&lt;route id&gt;</code> (see <a href="/docs" target="_blank" rel="noopener">API docs</a>).</p>
        <div id="newKey"></div>
        <table class="t"><thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th class="num">Last used</th><th class="num">Expires</th><th></th></tr></thead><tbody>
        ${keys.length ? keys.map((k) => `<tr><td>${esc(k.name)}</td><td class="mono">mbk_${k.id}_${esc(k.prefix)}…</td><td>${k.scopes.map((x) => `<span class="tag">${esc(x)}</span>`).join(" ")}</td><td class="num">${k.lastUsed ? ago(k.lastUsed) : "never"}</td><td class="num">${k.expiresAt ? fmtDate(k.expiresAt) : "never"}</td><td class="actions"><button class="btn sm danger" type="button" data-krev="${k.id}">Revoke</button></td></tr>`).join("") : '<tr><td colspan="6" class="faint">No keys yet.</td></tr>'}</tbody></table>
        <form id="keyForm" class="section form">
          ${field("Name", '<input name="name" required maxlength="100" placeholder="Home Assistant">', "What will use the key, so you recognise it later.")}
          ${field("Expires", '<select name="exp"><option value="30">in 30 days</option><option value="90" selected>in 90 days</option><option value="365">in a year</option><option value="">never</option></select>')}
          <div class="f full"><span>Scopes</span><div>${scopeList.map((s) => `<label class="check" style="margin-right:12px"><input type="checkbox" name="scope" value="${s}" ${s.endsWith(":read") ? "checked" : ""}> ${s}</label>`).join("")}</div></div>
          <div class="full"><button class="btn" type="submit">${icon("key")}Create key</button></div></form>
      </div>
      <div data-p="prefs" hidden>
        <form id="prefForm" class="form" style="max-width:520px;grid-template-columns:1fr">
          ${field("Theme", `<select name="theme">${[["dark", "Dark"], ["light", "Light"], ["system", "Follow the system"]].map(([v, l]) => `<option value="${v}" ${v === (ME.prefs.theme || STATUS?.defaultTheme || "dark") ? "selected" : ""}>${l}</option>`).join("")}</select>`)}
          ${field("Time zone", `<input name="timezone" list="pTz" value="${esc(ME.prefs.timezone || "")}" placeholder="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)} (this browser)">`, "How times are shown to you. Quiet hours use the server time zone.")}
        </form>${zoneList("pTz")}
      </div>
    </div>
    <div class="dlg-foot"><button class="btn danger" type="button" id="pOut" style="margin-right:auto">${icon("out")}Sign out</button><button class="btn quiet" type="button" data-close>Close</button><button class="btn primary" type="button" id="pSave">Save</button></div></div>`, "w880");
  const show = bindPanes(d, (t) => ($("#pSave").hidden = !["profile", "prefs"].includes(t)));
  show(tab);
  const reopen = (me, t) => { ME = me; renderAvatarBtn(); applyTheme(); return openProfile(t); };
  $("#pOut").addEventListener("click", () => { d.close(); signOut(); });
  $("#pSave").addEventListener("click", run(async () => {
    const pf = $("#pForm"), pr = $("#prefForm");
    const src = $("[name=avsrc]:checked", d)?.value;
    ME = await api("PUT", "/api/me", { displayName: pf.displayName.value, email: pf.email.value || null, ...(src && src !== a.source ? { avatarSource: src } : {}), prefs: { theme: pr.theme.value, timezone: pr.timezone.value } });
    renderAvatarBtn(); applyTheme(); d.close(); toast("Profile saved"); route();
  }));
  $("#pFile").addEventListener("change", run(async (e) => {
    const file = e.target.files[0]; if (!file) return;
    $("#pAvErr").textContent = "";
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) { $("#pAvErr").textContent = "Choose a PNG, JPEG, WebP or GIF image."; return; }
    if (file.size > 5 * 1024 * 1024) { $("#pAvErr").textContent = `That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB.`; return; }
    $("#pAvErr").innerHTML = '<span class="faint"><span class="spinner" aria-hidden="true"></span> Uploading and resizing…</span>';
    try { await reopen(await api("POST", "/api/me/avatar", file, { "Content-Type": file.type }), "profile"); toast("Picture uploaded"); }
    catch (err) { $("#pAvErr").textContent = err.message; }
  }));
  $("#pRm")?.addEventListener("click", run(async () => reopen(await api("DELETE", "/api/me/avatar"), "profile")));
  $("#pwForm")?.addEventListener("submit", run(async (e) => {
    const f = e.target;
    if (f.password.value !== f.again.value) { $("#pwMsg").innerHTML = '<span class="err-text">The new passwords don\'t match.</span>'; return; }
    try { await api("POST", "/api/password", { current: f.current.value, password: f.password.value }); }
    catch (err) { $("#pwMsg").innerHTML = `<span class="err-text">${esc(err.message === "unauthorised" ? "Current password is wrong." : err.message)}</span>`; return; }
    f.reset(); $("#pwMsg").innerHTML = '<span class="st ok"><span class="mk"></span>Password changed</span>';
  }));
  $("#keyForm").addEventListener("submit", run(async (e) => {
    const f = e.target;
    const k = await api("POST", "/api/keys", { name: f.name.value, scopes: $$("[name=scope]:checked", f).map((c) => c.value), expiresInDays: f.exp.value ? Number(f.exp.value) : null });
    await openProfile("keys");
    $("#newKey").innerHTML = `<div class="panel" style="margin-bottom:12px"><div class="panel-body"><p style="margin-top:0"><strong>Copy this key now.</strong> It won't be shown again.</p><div class="secret-once" id="keyVal"></div><div class="btn-row" style="margin-top:8px"><button class="btn sm" type="button" id="keyCopy">Copy</button></div></div></div>`;
    $("#keyVal").textContent = k.key;
    $("#keyCopy").addEventListener("click", () => navigator.clipboard?.writeText(k.key).then(() => toast("Copied")));
  }));
  $$("[data-krev]", d).forEach((b) => b.addEventListener("click", run(async () => { await api("DELETE", `/api/keys/${b.dataset.krev}`); toast("Key revoked"); openProfile("keys"); })));
}

boot().catch((e) => toast(e.message, true));

// ---------- PWA: offline shell only (the service worker never caches /api or auth) ----------
const paintOnline = () => { const b = $("#offlineBanner"); if (b) b.hidden = navigator.onLine; };
window.addEventListener("online", paintOnline); window.addEventListener("offline", paintOnline); paintOnline();
/** Service workers need HTTPS (or localhost); the version in the URL makes a new release replace the old shell cache. */
function registerSW(version) {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js?v=" + encodeURIComponent(version || "dev"), { scope: "/" }).catch(() => {});
}
