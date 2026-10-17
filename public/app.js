// MailBeacon admin UI (no build step)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "X-MailBeacon": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes("login")) { showAuth(true); throw new Error("unauthorised"); }
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast"); t.textContent = msg; t.className = bad ? "toast bad" : "toast"; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000);
}
const tryRun = (fn) => async (e) => { if (e && e.preventDefault && e.type === "submit") e.preventDefault(); try { await fn(e); } catch (err) { if (err.message !== "unauthorised") toast(err.message, true); } };

let status = {};
function showAuth(setupDone) {
  $("#nav").hidden = true;
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = true));
  $("#auth").hidden = false;
  $("#authTitle").textContent = setupDone ? "Log in" : "First run: set the admin password";
  $("#authForm").dataset.mode = setupDone ? "login" : "setup";
  $("#ssoWrap").hidden = !status.oidc;
  $("#authForm").hidden = setupDone && status.localLogin === false;
  const err = new URLSearchParams(location.search).get("login_error");
  $("#authMsg").textContent = err || ""; $("#authMsg").className = err ? "error" : "muted";
}

function showTab(name) {
  $("#auth").hidden = true; $("#nav").hidden = false;
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== name));
  document.querySelectorAll("nav button[data-tab]").forEach((b) => { b.classList.toggle("active", b.dataset.tab === name); if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (name === "routes") { $("#routeEditor").hidden = true; $("#routeListView").hidden = false; }
  ({ routes: loadRoutes, messages: loadMessages, settings: loadSettings, logs: loadLogs })[name]();
}

// ---------- Routes ----------
let routes = [];
let gotifyDefaultUrl = "";
const TFIELDS = { ntfy: ["ntfyUrl", "ntfyTopic", "ntfyUsername"], pushover: [], apprise: ["appriseUrl", "appriseConfigKey"] };
const TBOOLS = { ntfy: ["ntfyMarkdown"], pushover: ["pushoverHtml"], apprise: [] };
const TSECRETS = { ntfy: ["ntfyToken", "ntfyPassword"], pushover: ["pushoverToken", "pushoverUser"], apprise: ["appriseUrls"] };
const TARGETS = {
  gotify: { label: "Gotify", icon: "G" }, ntfy: { label: "ntfy", icon: "n" },
  pushover: { label: "Pushover", icon: "P" }, apprise: { label: "Apprise", icon: "A" },
};
const gName = (v) => (v === 0 ? "Silent" : v <= 3 ? "Low" : v <= 7 ? "Normal" : "High");
const PRIORITIES = {
  gotify: {
    def: 5,
    opts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => [v, `${v} · ${gName(v)}${v === 5 ? " (default)" : ""}`]),
    help: "On the Gotify Android app: 0 = no notification, 1–3 = icon only, 4–7 = sound, 8–10 = pop-up on screen.",
  },
  ntfy: { def: 3, opts: [[1, "Min · no sound or vibration"], [2, "Low · no sound"], [3, "Default"], [4, "High · long vibration"], [5, "Urgent · loud, repeating"]], help: "ntfy's five levels. Urgent can break through Do Not Disturb if you allow it in the app." },
  pushover: { def: 0, opts: [[-2, "Lowest · no alert"], [-1, "Low · quiet, no sound"], [0, "Normal"], [1, "High · bypasses quiet hours"]], help: "Pushover priorities. Emergency (repeat until acknowledged) isn't supported." },
};
const prioLabel = (tt, v) => { const p = PRIORITIES[tt]; const o = p && p.opts.find(([x]) => x === Number(v)); return o ? o[1].replace(/ \(default\)$/, "") : null; };
const shortPrio = (tt, v) => { const l = prioLabel(tt, v); if (!l) return String(v); const parts = l.split(" · "); return tt === "gotify" ? `${parts[1]} (${v})` : parts[0]; };
const routePriority = (r) => r.targetType === "ntfy" ? (r.target?.ntfyPriority ?? 3) : r.targetType === "pushover" ? (r.target?.pushoverPriority ?? 0) : r.targetType === "apprise" ? null : r.gotifyPriority;

const MATCH = {
  recipient: {
    verb: "to", label: "Recipient address", kind: "Exact address or *@domain", sample: "Test this pattern with a recipient address",
    placeholder: "proxmox@alerts.local", sampleHint: "proxmox@alerts.local",
    help: "The address the app sends <em>to</em>. Use an exact address, or <code>*</code> as a wildcard. Not case-sensitive.",
    examples: ["proxmox@alerts.local", "*@alerts.local", "backup-*@alerts.local"],
  },
  sender: {
    verb: "from", label: "Sender pattern", kind: "Regular expression", sample: "Test this pattern with a sender address",
    placeholder: "^proxmox@bjr-home\\.uk$", sampleHint: "proxmox@bjr-home.uk",
    help: "A regular expression checked against the <em>From</em> address. Not case-sensitive, and it matches anywhere unless you anchor it with <code>^</code> and <code>$</code>. Escape dots as <code>\\.</code>",
    examples: ["^proxmox@bjr-home\\.uk$", "@bjr-home\\.uk$", "^(truenas|nas)@"],
  },
  subject: {
    verb: "with subject", label: "Subject pattern", kind: "Regular expression", sample: "Test this pattern with a subject line",
    placeholder: "backup (failed|error)", sampleHint: "vzdump backup failed on pve1",
    help: "A regular expression checked against the subject line. Not case-sensitive, and it matches anywhere in the subject. The subject is only known once the whole email has arrived, so non-matching mail is rejected at that point.",
    examples: ["backup (failed|error)", "^\\[PVE\\]", "(critical|urgent)"],
  },
  catchall: { verb: "", label: "", kind: "", sample: "", placeholder: "", sampleHint: "", help: "", examples: [] },
};

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const units = [[86400, "d"], [3600, "h"], [60, "min"]];
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)} ${u} ago`;
  return "just now";
}
function lastBadge(r) {
  const d = r.lastDelivery;
  if (!d) return `<span class="badge b-none">No mail yet</span>`;
  const txt = { delivered: "Delivered", failed: "Failed", pending: "Sending" }[d.status] || d.status;
  const tip = d.status === "failed" && d.error ? ` title="${esc(d.error)}"` : "";
  return `<span class="badge b-${esc(d.status)}"${tip}><span class="dot" aria-hidden="true"></span>Last mail: ${txt} ${esc(timeAgo(d.at))}</span>`;
}
function sentence(r) {
  const t = TARGETS[r.targetType] || TARGETS.gotify;
  const where = r.targetType === "ntfy" && r.target?.ntfyTopic ? ` topic <code>${esc(r.target.ntfyTopic)}</code>`
    : r.targetType === "apprise" && r.target?.appriseConfigKey ? ` config <code>${esc(r.target.appriseConfigKey)}</code>` : "";
  const p = routePriority(r);
  const prio = p === null ? "" : ` <span class="muted">(priority ${esc(shortPrio(r.targetType, p))})</span>`;
  const when = r.matchType === "catchall" ? `<strong>Any other mail</strong>`
    : `When mail <strong>${MATCH[r.matchType].verb}</strong> <code>${esc(r.pattern)}</code>`;
  return `${when} <span class="arrow" aria-label="goes to">→</span> send to <strong>${t.label}</strong>${where}${prio}`;
}

async function loadRoutes() {
  const [list, settings] = await Promise.all([api("GET", "/api/routes"), api("GET", "/api/settings").catch(() => ({}))]);
  routes = list; gotifyDefaultUrl = settings.gotifyUrl || "";
  renderRoutes();
}
function renderRoutes() {
  $("#routeEmpty").hidden = routes.length > 0;
  $("#routeList").hidden = routes.length === 0;
  const catchIdx = routes.findIndex((r) => r.enabled && r.matchType === "catchall");
  $("#routeList").innerHTML = routes.map((r, i) => {
    const unreachable = catchIdx !== -1 && i > catchIdx;
    const isCatch = r.matchType === "catchall";
    return `<li class="route ${r.enabled ? "" : "off"} ${isCatch ? "is-catchall" : ""}" data-id="${r.id}">
      <div class="order" role="group" aria-label="Order for ${esc(r.name)}">
        <button type="button" class="icon" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(r.name)} up" title="Move up">▲</button>
        <span class="pos" title="Checked ${i === 0 ? "first" : `${i + 1}${["th", "st", "nd", "rd"][i + 1] || "th"}`}"><span class="sr-only">Position </span>${i + 1}</span>
        <button type="button" class="icon" data-act="down" ${i === routes.length - 1 ? "disabled" : ""} aria-label="Move ${esc(r.name)} down" title="Move down">▼</button>
      </div>
      <div class="route-main">
        <div class="route-title">
          <h3>${esc(r.name)}</h3>
          ${isCatch ? `<span class="badge b-catch">Catch-all</span>` : ""}
          ${r.enabled ? "" : `<span class="badge b-off">Disabled</span>`}
          ${unreachable && r.enabled ? `<span class="badge b-warn" title="A catch-all above this route takes every message first">Never reached: catch-all above</span>` : ""}
        </div>
        <p class="sentence">${sentence(r)}</p>
        <div class="route-meta">${lastBadge(r)}<span class="test-result" aria-live="polite"></span></div>
      </div>
      <div class="route-actions">
        <label class="switch"><input type="checkbox" role="switch" data-act="toggle" ${r.enabled ? "checked" : ""} aria-label="Enable ${esc(r.name)}"><span class="track" aria-hidden="true"></span><span class="switch-txt">${r.enabled ? "On" : "Off"}</span></label>
        <div class="btns">
          <button type="button" class="ghost" data-act="test">Send test</button>
          <button type="button" class="ghost" data-act="edit">Edit</button>
          <button type="button" class="ghost danger" data-act="del">Delete</button>
        </div>
      </div>
    </li>`;
  }).join("");
}

async function moveRoute(id, dir) {
  const i = routes.findIndex((r) => r.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= routes.length) return;
  [routes[i], routes[j]] = [routes[j], routes[i]];
  renderRoutes();
  const btn = $(`#routeList li[data-id="${id}"] [data-act="${dir < 0 ? "up" : "down"}"]`);
  (btn && !btn.disabled ? btn : $(`#routeList li[data-id="${id}"] [data-act="edit"]`)).focus();
  await api("POST", "/api/routes/reorder", { ids: routes.map((r) => r.id) });
  toast(`Moved "${routes[j].name}" to position ${j + 1}.`);
}

$("#routeList").addEventListener("change", tryRun(async (e) => {
  const cb = e.target.closest('[data-act="toggle"]'); if (!cb) return;
  const id = Number(cb.closest("li").dataset.id);
  try { await api("PATCH", `/api/routes/${id}`, { enabled: cb.checked }); } catch (err) { cb.checked = !cb.checked; throw err; }
  const r = routes.find((x) => x.id === id); r.enabled = cb.checked; renderRoutes();
  $(`#routeList li[data-id="${id}"] [data-act="toggle"]`).focus();
}));
$("#routeList").addEventListener("click", tryRun(async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const li = b.closest("li"); const id = Number(li.dataset.id); const r = routes.find((x) => x.id === id);
  const act = b.dataset.act;
  if (act === "up" || act === "down") return moveRoute(id, act === "up" ? -1 : 1);
  if (act === "edit") return openEditor(r);
  if (act === "test") {
    const out = li.querySelector(".test-result");
    out.className = "test-result"; out.textContent = "Sending test…"; b.disabled = true;
    try { await api("POST", `/api/routes/${id}/test`); out.className = "test-result ok"; out.textContent = `✓ Test sent to ${TARGETS[r.targetType]?.label || "target"}`; }
    catch (err) { out.className = "test-result bad"; out.textContent = `✗ Test failed: ${err.message}`; }
    finally { b.disabled = false; }
    return;
  }
  if (act === "del") {
    const btns = b.parentElement;
    btns.innerHTML = `<span class="confirm-txt">Delete "${esc(r.name)}"?</span><button type="button" class="danger-solid" data-act="del-yes">Delete</button><button type="button" class="ghost" data-act="del-no">Keep</button>`;
    btns.querySelector('[data-act="del-no"]').focus();
    return;
  }
  if (act === "del-no") { renderRoutes(); $(`#routeList li[data-id="${id}"] [data-act="del"]`)?.focus(); return; }
  if (act === "del-yes") { await api("DELETE", `/api/routes/${id}`); toast(`Deleted "${r.name}".`); await loadRoutes(); $("#addRoute").focus(); }
}));

// ----- editor -----
const F = () => $("#routeForm");
const targetType = () => F().querySelector('input[name="targetType"]:checked').value;
const appriseMode = () => F().querySelector('input[name="appriseMode"]:checked').value;
let editing = null;

function openEditor(r) {
  editing = r || null;
  const f = F(); f.reset(); clearErrors();
  f.id.value = r ? r.id : "";
  f.order.value = r ? r.order : (routes.length ? Math.max(...routes.map((x) => x.order)) + 10 : 10);
  f.name.value = r ? r.name : "";
  f.matchType.value = r ? r.matchType : "recipient";
  f.pattern.value = r ? r.pattern : "";
  f.enabled.checked = r ? r.enabled : true;
  const tt = r ? r.targetType || "gotify" : "gotify";
  f.querySelector(`input[name="targetType"][value="${tt}"]`).checked = true;
  const t = (r && r.target) || {};
  f.gotifyUrl.value = r?.gotifyUrl || "";
  for (const k of Object.values(TFIELDS).flat()) f[k].value = t[k] ?? "";
  for (const k of Object.values(TBOOLS).flat()) f[k].checked = t[k] !== false;
  const masked = { ...(r?.secrets || {}), ...(r?.targetType === "gotify" && r.gotifyToken ? { gotifyToken: r.gotifyToken } : {}) };
  for (const k of ["gotifyToken", ...Object.values(TSECRETS).flat()]) {
    f[k].value = "";
    f[k].placeholder = masked[k] ? `Saved (${masked[k]}), leave blank to keep` : "";
  }
  f.querySelector(`input[name="appriseMode"][value="${t.appriseConfigKey ? "key" : "urls"}"]`).checked = true;
  $("#f-gotifyUrl-help").textContent = gotifyDefaultUrl ? `Leave blank to use the Gotify URL from Settings (${gotifyDefaultUrl}).` : "Leave blank to use the Gotify URL from Settings. (None is set yet: set one there or fill this in.)";
  $("#f-sample").value = "";
  onTargetChange(r ? routePriority(r) : null);
  onMatchChange(false);
  $("#routeFormTitle").textContent = r ? `Edit route: ${r.name}` : "Add route";
  $("#routeListView").hidden = true; $("#routeEditor").hidden = false;
  window.scrollTo(0, 0); $("#routeFormTitle").focus();
}
function closeEditor() {
  const id = editing && editing.id; editing = null;
  $("#routeEditor").hidden = true; $("#routeListView").hidden = false;
  const back = id && $(`#routeList li[data-id="${id}"] [data-act="edit"]`);
  (back || $("#addRoute")).focus();
}
function onMatchChange(resetSample = true) {
  const f = F(); const m = MATCH[f.matchType.value]; const isCatch = f.matchType.value === "catchall";
  $("#patternWrap").hidden = isCatch; $("#catchallHelp").hidden = !isCatch;
  if (!isCatch) {
    $("#patternLabel").textContent = m.label; $("#patternKind").textContent = m.kind;
    f.pattern.placeholder = m.placeholder; $("#patternHelp").innerHTML = m.help;
    $("#patternExamples").innerHTML = `<span class="muted">Examples:</span> ` + m.examples.map((x) => `<button type="button" class="ex mono" data-ex="${esc(x)}" aria-label="Use example ${esc(x)}">${esc(x)}</button>`).join("");
    $("#sampleLabel").textContent = m.sample; $("#f-sample").placeholder = `e.g. ${m.sampleHint}`;
  }
  if (resetSample) $("#f-sample").value = "";
  fieldError("pattern", "");
  runSampleTest(); updatePreview();
}
function onTargetChange(prio) {
  const tt = targetType();
  F().querySelectorAll(".target-fields").forEach((el) => {
    el.hidden = el.dataset.t !== tt;
    if (el.hidden) el.querySelectorAll("[aria-invalid]").forEach((i) => fieldError(i.name, ""));
  });
  if (!F().querySelector("[aria-invalid]")) $("#formError").hidden = true;
  const am = appriseMode();
  F().querySelectorAll("[data-am]").forEach((el) => (el.hidden = el.dataset.am !== am));
  const p = PRIORITIES[tt];
  $("#priorityWrap").hidden = !p;
  if (p) {
    const cur = prio ?? p.def;
    $("#f-priority").innerHTML = p.opts.map(([v, l]) => `<option value="${v}" ${Number(cur) === v ? "selected" : ""}>${esc(l)}</option>`).join("");
    $("#priorityHelp").textContent = p.help;
  }
  updatePreview();
}

let sampleTimer, sampleSeq = 0;
function runSampleTest() {
  clearTimeout(sampleTimer);
  const out = $("#sampleResult"); const f = F();
  const sample = $("#f-sample").value; const pattern = f.pattern.value;
  if (f.matchType.value === "catchall") return;
  if (!sample) { out.className = "result"; out.textContent = ""; return; }
  if (!pattern) { out.className = "result"; out.textContent = "Enter a pattern above first"; return; }
  sampleTimer = setTimeout(async () => {
    const seq = ++sampleSeq;
    try {
      const r = await api("POST", "/api/routes/match-test", { matchType: f.matchType.value, pattern, sample });
      if (seq !== sampleSeq) return;
      if (!r.valid) { out.className = "result bad"; out.textContent = `Invalid pattern: ${r.error}`; }
      else if (r.matches) { out.className = "result ok"; out.textContent = "✓ Would match"; }
      else { out.className = "result no"; out.textContent = "✗ Would not match"; }
    } catch (err) { if (seq === sampleSeq) { out.className = "result bad"; out.textContent = err.message; } }
  }, 200);
}
function updatePreview() {
  const f = F(); const tt = targetType(); const t = TARGETS[tt];
  $("#pvIcon").textContent = t.icon; $("#pvIcon").className = `ticon t-${tt}`;
  $("#pvApp").textContent = t.label; $("#pvRoute").textContent = f.name.value.trim() || "New route";
  const subjectSample = f.matchType.value === "subject" && $("#f-sample").value.trim();
  $("#pvTitle").textContent = subjectSample || "Backup job finished: vzdump";
  const p = PRIORITIES[tt] ? prioLabel(tt, $("#f-priority").value) : null;
  $("#pvPrio").textContent = p ? shortPrio(tt, $("#f-priority").value) : "";
  $("#pvPrio").hidden = !p;
}

// inline validation
function fieldError(name, msg) {
  const input = F()[name]; const el = $(`#f-${name}-err`);
  if (!el || !input) return;
  el.textContent = msg; el.hidden = !msg;
  if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
}
function clearErrors() {
  F().querySelectorAll(".field-error").forEach((el) => { el.hidden = true; el.textContent = ""; });
  F().querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  $("#formError").hidden = true;
}
const isUrl = (v) => /^https?:\/\/\S+$/.test(v);
const has = (k) => !!(editing && ((editing.secrets && editing.secrets[k]) || (k === "gotifyToken" && editing.targetType === "gotify" && editing.gotifyToken)));
function validateForm() {
  const f = F(); const errs = {}; const tt = targetType(); const v = (k) => f[k].value.trim();
  if (!v("name")) errs.name = "Give the route a name.";
  const mt = f.matchType.value;
  if (mt !== "catchall") {
    if (!v("pattern")) errs.pattern = mt === "recipient" ? "Enter an address, e.g. proxmox@alerts.local or *@alerts.local." : "Enter a pattern.";
    else if (mt === "recipient" && !/^[^\s@]*@[^\s@]+$/.test(v("pattern")) && !v("pattern").includes("*")) errs.pattern = "That doesn't look like an email address. Use name@domain or *@domain.";
    else if (mt !== "recipient") { try { new RegExp(v("pattern"), "i"); } catch (e) { errs.pattern = `Not a valid regular expression: ${e.message.replace(/^Invalid regular expression: /, "")}`; } }
  }
  if (tt === "gotify") {
    if (!v("gotifyToken") && !has("gotifyToken")) errs.gotifyToken = "Paste the app token from Gotify.";
    if (v("gotifyUrl") && !isUrl(v("gotifyUrl"))) errs.gotifyUrl = "Must start with http:// or https://";
  }
  if (tt === "ntfy") {
    if (!isUrl(v("ntfyUrl"))) errs.ntfyUrl = "Enter the server URL, starting with http:// or https://";
    if (!/^[\w-]{1,64}$/.test(v("ntfyTopic"))) errs.ntfyTopic = "Enter a topic using letters, digits, - and _ only.";
    if (v("ntfyToken") && v("ntfyUsername")) errs.ntfyToken = "Use a token or a username/password, not both.";
  }
  if (tt === "pushover") {
    if (!v("pushoverToken") && !has("pushoverToken")) errs.pushoverToken = "Paste your application's API token.";
    if (!v("pushoverUser") && !has("pushoverUser")) errs.pushoverUser = "Paste your user or group key.";
  }
  if (tt === "apprise") {
    if (!isUrl(v("appriseUrl"))) errs.appriseUrl = "Enter the Apprise API URL, starting with http:// or https://";
    if (appriseMode() === "urls" && !v("appriseUrls") && !has("appriseUrls")) errs.appriseUrls = "Enter at least one notification URL.";
    if (appriseMode() === "key" && !/^[\w-]{1,64}$/.test(v("appriseConfigKey"))) errs.appriseConfigKey = "Enter a config key using letters, digits, - and _ only.";
  }
  return errs;
}
const SERVER_FIELD = [[/^name/, "name"], [/pattern/, "pattern"], [/gotifyToken/, "gotifyToken"], [/gotifyUrl/, "gotifyUrl"], [/ntfy URL/, "ntfyUrl"], [/ntfy topic/, "ntfyTopic"], [/ntfy token/, "ntfyToken"], [/Pushover/, "pushoverToken"], [/Apprise API URL/, "appriseUrl"], [/config key/, "appriseConfigKey"], [/Apprise needs/, "appriseUrls"]];

F().addEventListener("submit", async (e) => {
  e.preventDefault(); clearErrors();
  const errs = validateForm();
  for (const [k, m] of Object.entries(errs)) fieldError(k, m);
  const first = Object.keys(errs)[0];
  if (first) {
    const fe = $("#formError"); fe.textContent = `Please fix ${Object.keys(errs).length === 1 ? "the highlighted field" : `the ${Object.keys(errs).length} highlighted fields`}.`; fe.hidden = false;
    const el = F()[first]; el.closest("details")?.setAttribute("open", ""); el.focus(); return;
  }
  const f = F(); const tt = targetType(); const prio = Number($("#f-priority").value);
  const body = {
    name: f.name.value.trim(), matchType: f.matchType.value, pattern: f.matchType.value === "catchall" ? "" : f.pattern.value.trim(),
    order: Number(f.order.value), enabled: f.enabled.checked, targetType: tt, target: {}, secrets: {},
    gotifyToken: tt === "gotify" ? (f.gotifyToken.value.trim() || undefined) : undefined,
    gotifyPriority: tt === "gotify" ? prio : (editing ? editing.gotifyPriority : 5),
    gotifyUrl: tt === "gotify" ? (f.gotifyUrl.value.trim() || null) : (editing?.gotifyUrl || null),
  };
  for (const k of TFIELDS[tt] || []) if (f[k].value.trim() !== "") body.target[k] = f[k].value.trim();
  for (const k of TBOOLS[tt] || []) body.target[k] = f[k].checked;
  for (const k of TSECRETS[tt] || []) if (f[k].value) body.secrets[k] = f[k].value;
  if (tt === "ntfy") body.target.ntfyPriority = prio;
  if (tt === "pushover") body.target.pushoverPriority = prio;
  if (tt === "apprise") {
    // only one of URLs / config key may be set
    if (appriseMode() === "key") { body.secrets.appriseUrls = null; } else { delete body.target.appriseConfigKey; }
  }
  const save = $("#routeSave"); save.disabled = true; save.textContent = "Saving…";
  try {
    let note = "";
    if (f.id.value) await api("PUT", `/api/routes/${f.id.value}`, body);
    else {
      const { id } = await api("POST", "/api/routes", body);
      // keep new specific routes above an existing catch-all so they can actually be reached
      const ci = routes.findIndex((r) => r.enabled && r.matchType === "catchall");
      if (ci !== -1 && body.matchType !== "catchall") {
        const ids = routes.map((r) => r.id); ids.splice(ci, 0, id);
        await api("POST", "/api/routes/reorder", { ids });
        note = " It was placed above your catch-all so it can match.";
      }
    }
    toast(`Saved "${body.name}".${note}`);
    const savedId = f.id.value;
    await loadRoutes(); closeEditor();
    if (!savedId) [...document.querySelectorAll("#routeList h3")].find((h) => h.textContent === body.name)?.closest("li").querySelector("[data-act='test']").focus();
  } catch (err) {
    if (err.message === "unauthorised") return;
    const hit = SERVER_FIELD.find(([re]) => re.test(err.message));
    if (hit && F()[hit[1]]) { fieldError(hit[1], err.message); F()[hit[1]].focus(); }
    const fe = $("#formError"); fe.textContent = `Couldn't save: ${err.message}`; fe.hidden = false;
  } finally { save.disabled = false; save.textContent = "Save route"; }
});
F().matchType.addEventListener("change", () => onMatchChange());
F().pattern.addEventListener("input", () => { fieldError("pattern", ""); runSampleTest(); });
$("#f-sample").addEventListener("input", () => { runSampleTest(); updatePreview(); });
F().name.addEventListener("input", () => { fieldError("name", ""); updatePreview(); });
F().querySelectorAll('input[name="targetType"]').forEach((el) => el.addEventListener("change", () => onTargetChange(null)));
F().querySelectorAll('input[name="appriseMode"]').forEach((el) => el.addEventListener("change", () => onTargetChange(Number($("#f-priority").value))));
$("#f-priority").addEventListener("change", updatePreview);
F().addEventListener("input", (e) => {
  if (e.target.name && e.target.getAttribute("aria-invalid")) fieldError(e.target.name, "");
  if (!F().querySelector("[aria-invalid]")) $("#formError").hidden = true;
});
$("#patternExamples").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ex]"); if (!b) return;
  F().pattern.value = b.dataset.ex; fieldError("pattern", "");
  if (!$("#f-sample").value) $("#f-sample").value = MATCH[F().matchType.value].sampleHint;
  runSampleTest(); updatePreview(); F().pattern.focus();
});
$("#addRoute").addEventListener("click", () => openEditor(null));
$("#addFirstRoute").addEventListener("click", () => openEditor(null));
$("#routeBack").addEventListener("click", closeEditor);
$("#routeCancel").addEventListener("click", closeEditor);

async function loadMessages() {
  const msgs = await api("GET", "/api/messages");
  $("#msgRows").innerHTML = msgs.map((m) => `<tr><td>${new Date(m.receivedAt).toLocaleString()}</td><td>${esc(m.sender)}</td><td>${esc(m.recipients)}</td>
    <td title="${esc(m.body)}">${esc(m.subject)}</td><td class="${m.status}" title="${esc(m.lastError)}">${m.status}</td><td>${m.attempts}</td>
    <td>${m.status !== "delivered" ? `<button data-id="${m.id}">Retry</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">No messages yet.</td></tr>`;
}
$("#msgRows").addEventListener("click", tryRun(async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  await api("POST", `/api/messages/${b.dataset.id}/retry`); loadMessages();
}));

async function loadSettings() {
  const s = await api("GET", "/api/settings"); const f = $("#settingsForm");
  f.gotifyUrl.value = s.gotifyUrl; f.smtpStarttls.checked = s.smtpStarttls; f.smtpAuth.checked = s.smtpAuth;
  const o = $("#oidcForm");
  for (const k of ["publicUrl", "oidcIssuer", "oidcClientId", "oidcScopes", "oidcAllowed"]) { o[k].value = s[k] || ""; o[k].disabled = s.oidcFromEnv.includes(k.replace(/^oidc(.)/, (_, c) => c.toLowerCase())); }
  o.oidcClientSecret.value = ""; o.oidcClientSecret.placeholder = s.oidcClientSecretSet ? "set (blank keeps)" : "not set";
  o.oidcClientSecret.disabled = s.oidcFromEnv.includes("clientSecret");
  o.localLoginDisabled.checked = s.localLoginDisabled; o.localLoginDisabled.disabled = !s.oidcLastSuccess;
  $("#oidcRedirect").textContent = s.oidcRedirectUri;
  $("#oidcLast").textContent = s.oidcLastSuccess ? `Last SSO login: ${new Date(s.oidcLastSuccess).toLocaleString()}` : "No SSO login yet";
  $("#oidcEnvNote").hidden = !s.oidcFromEnv.length;
  $("#oidcEnvNote").textContent = "Greyed-out fields are set by environment variables.";
  $("#smtpUsers").innerHTML = s.smtpUsers.map((u) => `<li>${esc(u)} <button class="secondary" data-u="${esc(u)}">Remove</button></li>`).join("") || `<li class="muted">None</li>`;
}
$("#settingsForm").addEventListener("submit", tryRun(async () => {
  const f = $("#settingsForm");
  await api("PUT", "/api/settings", { gotifyUrl: f.gotifyUrl.value, smtpStarttls: f.smtpStarttls.checked, smtpAuth: f.smtpAuth.checked });
  toast("Saved."); loadSettings();
}));
$("#oidcForm").addEventListener("submit", tryRun(async () => {
  const o = $("#oidcForm"); const body = {};
  for (const k of ["publicUrl", "oidcIssuer", "oidcClientId", "oidcScopes", "oidcAllowed", "oidcClientSecret"]) if (!o[k].disabled && (k !== "oidcClientSecret" || o[k].value)) body[k] = o[k].value;
  if (!o.localLoginDisabled.disabled) body.localLoginDisabled = o.localLoginDisabled.checked;
  await api("PUT", "/api/settings", body); toast("Saved."); loadSettings();
}));
$("#smtpUsers").addEventListener("click", tryRun(async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  await api("DELETE", `/api/smtp-users/${encodeURIComponent(b.dataset.u)}`); loadSettings();
}));
$("#smtpUserForm").addEventListener("submit", tryRun(async () => {
  const f = $("#smtpUserForm"); await api("POST", "/api/smtp-users", { username: f.username.value, password: f.password.value }); f.reset(); loadSettings();
}));
$("#pwForm").addEventListener("submit", tryRun(async () => {
  const f = $("#pwForm"); await api("POST", "/api/password", { current: f.current.value, password: f.password.value }); f.reset(); toast("Password changed.");
}));

async function loadLogs() {
  const logs = await api("GET", "/api/logs");
  $("#logBox").textContent = logs.map((l) => `${l.at}  ${l.level.toUpperCase().padEnd(5)}  ${l.msg}`).join("\n");
}

$("#authForm").addEventListener("submit", tryRun(async () => {
  const mode = $("#authForm").dataset.mode;
  await api("POST", mode === "setup" ? "/api/setup" : "/api/login", { password: $("#authPw").value });
  $("#authPw").value = ""; showTab("routes");
}));
document.querySelectorAll("nav button[data-tab]").forEach((b) => b.addEventListener("click", tryRun(() => showTab(b.dataset.tab))));
$("#logout").addEventListener("click", tryRun(async () => { await api("POST", "/api/logout"); showAuth(true); }));

api("GET", "/api/status").then((s) => { status = s; if (s.authed) showTab("routes"); else showAuth(s.setupDone); });

fetch("/api/health").then((r) => r.json()).then((h) => { if (h.version) document.getElementById("appVersion").textContent = "v" + h.version; }).catch(() => {});
