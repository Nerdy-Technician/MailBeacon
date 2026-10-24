// MailBeacon UI, part 2: shared keyboard/validation behaviour and the first-run setup wizard.
// Loaded after app.js and uses its helpers ($, esc, api, run, toast, field, fieldInput, readFields...).
"use strict";

// ---------- form validation: inline messages instead of browser bubbles ----------
const VALIDATION_MSG = (el) => {
  const v = el.validity, label = (el.closest("label.f")?.querySelector("span")?.textContent || el.getAttribute("aria-label") || "This field").replace(/\s*\*$/, "");
  if (v.valueMissing) return el.type === "checkbox" ? "Tick this to continue." : `${label} is required.`;
  if (v.typeMismatch && el.type === "email") return "Enter an email address like name@example.com.";
  if (v.typeMismatch && el.type === "url") return "Enter a full URL starting with http:// or https://.";
  if (v.tooShort) return `Use at least ${el.minLength} characters (now ${el.value.length}).`;
  if (v.tooLong) return `Use at most ${el.maxLength} characters.`;
  if (v.rangeUnderflow) return `Must be ${el.min} or more.`;
  if (v.rangeOverflow) return `Must be ${el.max} or less.`;
  if (v.stepMismatch || v.badInput) return "Enter a whole number.";
  if (v.patternMismatch) return el.title || "This doesn't look right.";
  return el.validationMessage;
};
let ferrSeq = 0;
function clearFieldError(el) {
  el.removeAttribute("aria-invalid");
  const id = el.dataset.ferr; if (id) { document.getElementById(id)?.remove(); delete el.dataset.ferr; el.removeAttribute("aria-describedby"); }
}
function showFieldError(el, msg) {
  clearFieldError(el);
  const m = document.createElement("span"); m.className = "ferr"; m.id = "ferr" + ++ferrSeq; m.textContent = msg;
  const anchor = el.closest(".check") || el.closest(".toggle") || el;
  anchor.after(m);
  el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", m.id); el.dataset.ferr = m.id;
}
/** Checks a form; shows a message under every bad field and focuses the first. Returns true when valid. */
function validateForm(form) {
  let first = null;
  for (const el of form.elements) {
    if (!el.willValidate) continue;
    if (el.checkValidity()) { clearFieldError(el); continue; }
    showFieldError(el, VALIDATION_MSG(el)); first ??= el;
  }
  first?.focus();
  return !first;
}
const noValidate = (root) => { if (root instanceof HTMLFormElement) root.noValidate = true; root.querySelectorAll?.("form").forEach((f) => (f.noValidate = true)); };
noValidate(document);
new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && noValidate(n)))).observe(document.body, { childList: true, subtree: true });
// capture phase: runs before the form's own submit handler and stops it when the form is invalid
document.addEventListener("submit", (e) => {
  const f = e.target;
  if (f instanceof HTMLFormElement && !validateForm(f)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener("input", (e) => { const el = e.target; if (el.getAttribute?.("aria-invalid") === "true" && el.checkValidity()) clearFieldError(el); }, true);
document.addEventListener("change", (e) => { const el = e.target; if (el.getAttribute?.("aria-invalid") === "true" && el.checkValidity()) clearFieldError(el); }, true);

// ---------- keyboard ----------
$("#skipLink").addEventListener("click", () => { const c = $("#app").hidden ? $("#wizard .wiz-card") : $("#content"); c?.setAttribute("tabindex", "-1"); c?.focus(); });
// ⌘K / Ctrl+K and "/" jump to the page's search box (History search, Settings search), or open History.
function focusPageSearch() {
  const el = $("#setSearch") || $("#hForm input[name=q]");
  if (el) { el.focus(); el.select?.(); } else location.hash = "#/history";
  $("#app").classList.remove("nav-open");
}
$("#navSearch")?.addEventListener("click", focusPageSearch);
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); focusPageSearch(); }
  else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !$("#app").hidden && !document.querySelector("dialog[open]")) { e.preventDefault(); focusPageSearch(); }
});
$("#navToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = $("#app").classList.toggle("nav-open");
  $("#navToggle").setAttribute("aria-expanded", String(open));
  if (open) $("#navItems a.item")?.focus();
});
document.addEventListener("click", (e) => { if ($("#app").classList.contains("nav-open") && !e.target.closest(".nav")) { $("#app").classList.remove("nav-open"); $("#navToggle").setAttribute("aria-expanded", "false"); } });
// avatar menu: focus the first item on open, arrows move, Escape closes back to the button
new MutationObserver(() => {
  const m = $("#menu");
  $("#avatarBtn").setAttribute("aria-expanded", String(!m.hidden));
  if (!m.hidden) { $$("button", m).forEach((b) => b.setAttribute("role", "menuitem")); $("button", m)?.focus(); }
}).observe($("#menu"), { attributes: true, attributeFilter: ["hidden"] });
$("#menu").addEventListener("keydown", (e) => {
  const items = $$("#menu button"), i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
  if (e.key === "End") { e.preventDefault(); items.at(-1).focus(); }
  if (e.key === "Escape" || e.key === "Tab") { $("#menu").hidden = true; if (e.key === "Escape") $($("#menu").dataset.kind === "more" ? "#moreBtn" : "#avatarBtn").focus(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#app").classList.contains("nav-open")) { $("#app").classList.remove("nav-open"); $("#navToggle").focus(); }
  // tab strips: left/right arrows move between tabs
  const b = e.target.closest?.(".tabs button");
  if (b && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    const all = $$("button", b.parentElement), i = all.indexOf(b);
    const n = all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length]; n.focus(); n.click();
    e.preventDefault();
  }
});
// dialogs open on their first field rather than the close button
new MutationObserver((ms) => ms.forEach((m) => {
  const d = m.target;
  if (d.tagName !== "DIALOG" || !d.open) return;
  const el = $$(".dlg-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), .dlg-body select:not([disabled]), .dlg-body textarea", d).find((x) => !x.closest("[hidden]"));
  el?.focus();
})).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });

// ---------- first-run setup wizard ----------
const WSTEPS = [
  ["account", "Admin account"], ["smtp", "SMTP"], ["dest", "First destination"], ["route", "First route"], ["oidc", "Single sign-on", "optional"], ["done", "Finish"],
];
let W = null;
window.startWizard = startWizard;
async function startWizard({ fresh }) {
  if (!fresh && !isAdmin()) return toast("Only admins can run the setup wizard.", true);
  W = { fresh, i: fresh ? 0 : 1, done: new Set(fresh ? [] : ["account"]), skipped: new Set(), destId: null, routeId: null, dryRun: false, s: null, types: null };
  $("#app").hidden = true; $("#auth").hidden = true; $("#wizard").hidden = false;
  document.title = `Set up · ${appName()}`;
  renderWizard();
}
async function wizData() {
  // after the account step we are signed in as the new admin and use the normal admin API
  const [s, types, stats, dests] = await Promise.all([api("GET", "/api/settings"), destTypes(), api("GET", "/api/stats").catch(() => ({})), api("GET", "/api/destinations")]);
  Object.assign(W, { s, types, dryRun: !!stats.dryRun, dests });
}
function wizShell(inner, foot) {
  const k = WSTEPS[W.i][0];
  const pct = Math.round((W.i / (WSTEPS.length - 1)) * 100);
  $("#wizard").innerHTML = `<aside class="wiz-side"><div class="brand">${brandHtml()}</div>
    <ol class="wiz-steps" aria-label="Setup steps">${WSTEPS.map(([id, l, opt], n) => `<li class="${n === W.i ? "on" : W.skipped.has(id) ? "skip" : W.done.has(id) ? "done" : ""}" ${n === W.i ? 'aria-current="step"' : ""}><span class="n">${W.done.has(id) && n !== W.i ? "✓" : n + 1}</span><span class="lbl">${esc(l)}</span>${W.skipped.has(id) ? "<small>skipped</small>" : opt ? `<small>${opt}</small>` : ""}</li>`).join("")}</ol></aside>
    <div class="wiz-main">
      <div class="wiz-top"><span>${W.fresh ? "First-run setup" : "Setup wizard"} · step ${W.i + 1} of ${WSTEPS.length}</span><span class="grow"></span>${W.i > 0 ? '<button class="btn quiet sm" type="button" id="wExit">Exit setup</button>' : ""}</div>
      <div class="pbar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      ${W.dryRun && k !== "account" ? '<div class="wiz-top"><div class="wiz-note warn" style="width:100%"><strong>Dry-run mode is on.</strong> Test sends are recorded but nothing reaches any service.</div></div>' : ""}
      <div class="panel wiz-card" tabindex="-1"><div class="panel-body">${inner}</div><div class="panel-foot">${foot}</div></div>
    </div>`;
  $("#wExit")?.addEventListener("click", run(exitWizard));
  const first = $$("#wizard .wiz-card input:not([type=checkbox]):not([type=hidden]), #wizard .wiz-card select").find((x) => !x.closest("[hidden]") && !x.disabled);
  (first || $("#wizard .wiz-card")).focus();
}
async function exitWizard() {
  if (W.fresh && !(await confirmDlg("Leave setup?", "Your admin account is kept. You can run the wizard again any time from Settings › General.", "Leave setup"))) return;
  W = null; location.hash = "#/home"; boot();
}
const wizNav = (opts = {}) => `${W.i > (W.fresh ? 1 : 1) && WSTEPS[W.i][0] !== "done" ? '<button class="btn quiet" type="button" id="wBack" style="margin-right:auto">Back</button>' : '<span style="margin-right:auto"></span>'}
  ${opts.skip ? `<button class="btn quiet" type="button" id="wSkip">${esc(opts.skip)}</button>` : ""}
  <button class="btn primary" type="submit" form="${opts.form || "wForm"}" id="wNext">${esc(opts.next || "Save and continue")}</button>`;
function wizGo(delta) { W.i = Math.max(W.fresh && W.done.has("account") ? 1 : 0, Math.min(WSTEPS.length - 1, W.i + delta)); renderWizard(); }
function wizBind() {
  $("#wBack")?.addEventListener("click", () => wizGo(-1));
  $("#wSkip")?.addEventListener("click", () => { const k = WSTEPS[W.i][0]; if (!W.done.has(k)) W.skipped.add(k); wizGo(1); });
}
const mark = (k) => { W.done.add(k); W.skipped.delete(k); };
const wizStatus = (cls, html) => `<div class="wiz-note ${cls}" role="status">${html}</div>`;

const WIZ = {};
async function renderWizard() {
  const k = WSTEPS[W.i][0];
  if (k !== "account" && !W.s) {
    wizShell('<div class="empty"><span class="spinner" aria-hidden="true"></span><div class="et">Loading…</div></div>', "");
    try { await wizData(); } catch (err) { wizShell(emptyState("Couldn't load settings", esc(err.message), '<button class="btn" type="button" id="wRetry">Try again</button>'), ""); $("#wRetry").addEventListener("click", renderWizard); return; }
  }
  await WIZ[k]();
  wizBind();
}

WIZ.account = async () => {
  wizShell(`<h2 class="t1">Welcome to MailBeacon</h2>
    <p class="muted">MailBeacon is a fake SMTP server: devices send it email, and it forwards each message as a notification to Gotify, ntfy, Pushover, Discord, Slack, Telegram, Apprise or a webhook, to several at once if you like. This takes about two minutes. Everything after this step can be skipped and changed later in Settings.</p>
    <form id="wForm" class="form" style="grid-template-columns:1fr" autocomplete="on">
      <div class="section" style="border:0;padding:0;margin:0"><h3>Create the admin account</h3><p class="help" style="margin:0">This account manages users, routes and settings.</p></div>
      ${field("User name *", '<input name="username" required maxlength="64" pattern="[A-Za-z0-9._@\\-]+" title="Letters, digits and . _ @ - only" value="admin" autocomplete="username">')}
      ${field("Password *", '<input name="password" type="password" required minlength="8" autocomplete="new-password">', "At least 8 characters.")}
      ${field("Repeat password *", '<input name="again" type="password" required minlength="8" autocomplete="new-password">')}
      <p id="wErr" class="err-text" role="alert"></p>
    </form>`, wizNav({ next: "Create admin and continue" }));
  const f = $("#wForm");
  f.again.addEventListener("input", () => f.again.setCustomValidity(""));
  f.addEventListener("submit", run(async () => {
    if (f.password.value !== f.again.value) { showFieldError(f.again, "The passwords don't match."); f.again.focus(); return; }
    try { await api("POST", "/api/setup", { username: f.username.value.trim(), password: f.password.value }); }
    catch (err) { $("#wErr").textContent = err.message === "already set up" ? "This instance already has users. Sign in instead." : err.message; if (err.message === "already set up") setTimeout(() => boot(), 1500); return; }
    f.password.value = f.again.value = "";
    setStatus(await fetch("/api/status").then((r) => r.json())); applyTheme();
    mark("account"); toast("Admin account created"); wizGo(1);
  }));
};

WIZ.smtp = async () => {
  const s = W.s;
  wizShell(`<h2 class="t1">SMTP basics</h2>
    <p class="muted">Point your devices (Proxmox, a NAS, a printer, cron) at this host${s.smtpPort ? ` on port <strong class="mono">${esc(s.smtpPort)}</strong>` : ""}, with any sender and the recipient address your route will match. If you mapped a different port in Docker, use that one.</p>
    <form id="wForm" class="form" style="grid-template-columns:1fr">
      <div class="f"><span>Encryption</span><label class="check"><input type="checkbox" name="tls" ${s.smtpStarttls ? "checked" : ""}> Offer STARTTLS</label><span class="help">Uses the certificate in /data/tls, or a self-signed one. Senders that can't do TLS still work.</span></div>
      <div class="f"><span>Authentication (optional)</span><label class="check"><input type="checkbox" name="auth" ${s.smtpAuth ? "checked" : ""}> Require senders to log in</label><span class="help">Off is fine on a home network: mail that matches no route is refused anyway. Needs STARTTLS.</span></div>
      <div id="wAuth" class="form" style="padding:0" ${s.smtpAuth ? "" : "hidden"}>
        ${s.smtpUsers.length ? `<p class="help full" style="margin:0">Existing SMTP users: ${s.smtpUsers.map((u) => `<span class="tag">${esc(u)}</span>`).join("")}. Add another below, or leave blank.</p>` : ""}
        ${field("SMTP user name" + (s.smtpUsers.length ? "" : " *"), '<input name="su" maxlength="64" autocomplete="off" placeholder="proxmox">')}
        ${field("SMTP password" + (s.smtpUsers.length ? "" : " *"), '<input name="sp" type="password" minlength="8" autocomplete="new-password">', "At least 8 characters. Separate from web passwords.")}
      </div>
    </form>`, wizNav({ skip: "Skip, keep defaults" }));
  const f = $("#wForm");
  const sync = () => {
    $("#wAuth").hidden = !f.auth.checked;
    if (f.auth.checked) f.tls.checked = true;
    const need = f.auth.checked && !s.smtpUsers.length;
    f.su.required = need || !!f.sp.value; f.sp.required = need || !!f.su.value;
    if (!f.auth.checked) { clearFieldError(f.su); clearFieldError(f.sp); }
  };
  f.auth.addEventListener("change", sync); f.tls.addEventListener("change", () => { if (!f.tls.checked && f.auth.checked) { f.auth.checked = false; sync(); } });
  f.su.addEventListener("input", sync); f.sp.addEventListener("input", sync); sync();
  f.addEventListener("submit", run(async () => {
    if (f.auth.checked && f.su.value) await api("POST", "/api/smtp-users", { username: f.su.value.trim(), password: f.sp.value });
    W.s = await api("PUT", "/api/settings", { smtpStarttls: f.tls.checked, smtpAuth: f.auth.checked }).then(() => api("GET", "/api/settings"));
    mark("smtp"); toast("SMTP settings saved"); wizGo(1);
  }));
};

WIZ.dest = async () => {
  const T = W.types, existing = W.dests || [];
  const cur = W.destId ? existing.find((x) => x.id === W.destId) : null;
  const t0 = W.destType || "ntfy";
  const fields = (t) => T[t].fields.map((fl) => `<div class="${fl.kind === "bool" ? "full" : ""}">${fieldInput(fl, undefined, "d", false)}</div>`).join("");
  const reqd = (t) => T[t].fields.filter((x) => x.required).map((x) => `d.${x.key}`);
  wizShell(`<h2 class="t1">First destination</h2>
    <p class="muted">Where notifications go: ${esc(SERVICE_LIST)}. Start with one here; a route can forward to several destinations at once, so add more later from Destinations.</p>
    ${existing.length && !cur ? wizStatus("", `You already have ${existing.length} destination${existing.length > 1 ? "s" : ""}: ${existing.map((x) => `<span class="tag">${esc(x.name)}</span>`).join("")}. <button class="btn sm" type="button" id="wUseExisting">Use “${esc(existing[0].name)}”</button> or add a new one below.`) : ""}
    ${cur ? wizStatus("ok", `Saved <strong>${esc(cur.name)}</strong> (${esc(T[cur.type]?.label || cur.type)}).`) : ""}
    <form id="wForm" class="form" ${cur ? "hidden" : ""}>
      ${field("Name *", '<input name="name" required maxlength="100" placeholder="My phone (ntfy)">')}
      <div class="f full"><span>Service</span>${servicePicker(T, t0)}</div>
      <div class="full help">Secrets are encrypted at rest and never shown again.</div>
      <div class="full form" id="wFields" style="padding:0">${fields(t0)}</div>
    </form>
    <div id="wTest" ${cur ? "" : "hidden"} class="btn-row"><button class="btn" type="button" id="wSendTest">Send a test notification</button><span id="wTestMsg" class="small"></span></div>`,
    cur ? wizNav({ form: "wGo", next: "Continue" }) + '<form id="wGo" hidden></form>' : wizNav({ skip: "Skip for now", next: "Save destination" }));
  const f = $("#wForm");
  const typ = () => $("[name=type]:checked", f).value;
  const setReq = () => reqd(typ()).forEach((n) => f.elements[n] && (f.elements[n].required = true));
  setReq();
  f.addEventListener("change", (e) => { if (e.target.name !== "type") return; W.destType = typ(); $("#wFields").innerHTML = fields(typ()); setReq(); });
  $("#wUseExisting")?.addEventListener("click", () => { W.destId = existing[0].id; mark("dest"); renderWizard(); });
  f.addEventListener("submit", run(async () => {
    const type = typ();
    const { config, secrets } = readFields(f, "d", T[type].fields);
    const r = await api("POST", "/api/destinations", { name: f.name.value.trim(), type, config, secrets, enabled: true });
    W.dests = await api("GET", "/api/destinations"); W.destId = r.id ?? W.dests.at(-1)?.id; mark("dest");
    toast("Destination saved"); renderWizard();
  }));
  $("#wGo")?.addEventListener("submit", (e) => { e.preventDefault(); wizGo(1); });
  $("#wSendTest")?.addEventListener("click", run(async () => {
    $("#wTestMsg").innerHTML = '<span class="faint"><span class="spinner" aria-hidden="true"></span> Sending…</span>';
    try {
      const x = await api("POST", `/api/destinations/${W.destId}/test`);
      $("#wTestMsg").innerHTML = x.dryRun ? '<span class="st warn"><span class="mk"></span>Dry-run: test recorded, nothing was sent</span>' : '<span class="st ok"><span class="mk"></span>Sent. Check that it arrived.</span>';
    } catch (err) { $("#wTestMsg").innerHTML = `<span class="st crit"><span class="mk"></span>${esc(err.message)}</span>`; }
  }));
};

WIZ.route = async () => {
  const dests = W.dests || [];
  const cur = W.routeId;
  wizShell(`<h2 class="t1">First route</h2>
    <p class="muted">A route matches incoming mail and forwards it to one or more destinations, e.g. Proxmox alerts to both ntfy and Discord. Mail that matches no route is refused, so MailBeacon is never an open relay.</p>
    ${cur ? wizStatus("ok", "Route saved. Mail matching it is now forwarded.") : ""}
    <form id="wForm" class="form" ${cur ? "hidden" : ""}>
      ${field("Name *", '<input name="name" required maxlength="100" placeholder="Proxmox alerts">')}
      ${field("Match on", `<select name="matchType">${Object.entries(MATCH).map(([k, v]) => `<option value="${k}" ${k === "recipient" ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>`)}
      <div class="full">${field("Pattern *", `<input name="pattern" required maxlength="500" class="mono" placeholder="${esc(MATCH.recipient.ph)}">`, `<span id="wPatHelp">${esc(MATCH.recipient.help)}</span>`)}</div>
      <div class="f full"><span>Forward to <span class="faint">(tick several to fan out)</span></span>${dests.length ? `<div class="dest-pick">${dests.map((x) => `<label class="check"><input type="checkbox" name="dest" value="${x.id}" ${x.id === W.destId || dests.length === 1 ? "checked" : ""}> ${SERVICE_ICON(x.type)} ${esc(x.name)}</label>`).join("")}</div>` : '<span class="help">No destinations yet: the route will record mail in History without notifying. Go back to add one, or add it later.</span>'}</div>
    </form>`, cur ? wizNav({ form: "wGo", next: "Continue" }) + '<form id="wGo" hidden></form>' : wizNav({ skip: "Skip for now", next: "Save route" }));
  const f = $("#wForm");
  f.matchType.addEventListener("change", () => {
    const m = MATCH[f.matchType.value];
    f.pattern.placeholder = m.ph; $("#wPatHelp").textContent = m.help;
    f.pattern.required = f.matchType.value !== "catchall"; f.pattern.disabled = f.matchType.value === "catchall";
    if (f.pattern.disabled) { f.pattern.value = ""; clearFieldError(f.pattern); }
  });
  f.addEventListener("submit", run(async () => {
    const ids = $$("[name=dest]:checked", f).map((c) => Number(c.value));
    const r = await api("POST", "/api/routes", { name: f.name.value.trim(), matchType: f.matchType.value, pattern: f.pattern.value.trim(), enabled: true, targetType: "none", options: { destinationIds: ids } });
    W.routeId = r.id; mark("route"); toast("Route saved"); renderWizard();
  }));
  $("#wGo")?.addEventListener("submit", (e) => { e.preventDefault(); wizGo(1); });
};

WIZ.oidc = async () => {
  const s = W.s;
  wizShell(`<h2 class="t1">Single sign-on <span class="faint" style="font-weight:400">(optional)</span></h2>
    <p class="muted">Sign in with Authentik, Keycloak, Authelia or another OpenID Connect provider. Skip this if you only use passwords; you can set it up later in Settings › Sign-in and SSO.</p>
    ${wizStatus("", `Register MailBeacon as a <strong>confidential</strong> client with this redirect URI: <code>${esc(s.oidcRedirectUri)}</code>`)}
    ${s.oidcFromEnv ? wizStatus("warn", "Some values come from environment variables and override what is saved here.") : ""}
    <form id="wForm" class="form">
      <div class="full">${field("Issuer URL *", `<input name="issuer" type="url" required value="${esc(s.oidcIssuer)}" placeholder="https://auth.example.com/application/o/mailbeacon/">`)}</div>
      ${field("Client ID *", `<input name="cid" required value="${esc(s.oidcClientId)}" autocomplete="off">`)}
      ${field("Client secret" + (s.oidcClientSecretSet ? "" : " *"), `<input name="csec" type="password" ${s.oidcClientSecretSet ? "" : "required"} autocomplete="new-password" placeholder="${s.oidcClientSecretSet ? "stored — leave blank to keep" : ""}">`, "Encrypted at rest, never shown again.")}
      <div class="full"><label class="check"><input type="checkbox" name="priv" ${s.oidcAllowPrivate ? "checked" : ""}> Allow private issuer</label>
        <span class="help">Tick this if your provider is on your own network, for example a host name that resolves to a 192.168.x.x or 10.x.x.x address, or an http:// address. Otherwise only public https:// issuers are contacted.</span></div>
      <div class="full">${field("Public URL of MailBeacon", `<input name="pub" type="url" value="${esc(s.publicUrl)}" placeholder="https://mailbeacon.example.com">`, "How browsers reach this instance; used for the redirect URI.")}</div>
      <div class="full help">Role mapping from groups is in Settings › Sign-in and SSO. Password sign-in stays on until one SSO sign-in has worked.</div>
    </form>`, wizNav({ skip: "Skip", next: "Save and continue" }));
  const f = $("#wForm");
  f.addEventListener("submit", run(async () => {
    await api("PUT", "/api/settings", { oidcIssuer: f.issuer.value.trim(), oidcAllowPrivate: f.priv.checked, oidcClientId: f.cid.value.trim(), ...(f.csec.value ? { oidcClientSecret: f.csec.value } : {}), ...(f.pub.value ? { publicUrl: f.pub.value.trim() } : {}) });
    W.s = await api("GET", "/api/settings"); mark("oidc"); toast("Single sign-on saved"); wizGo(1);
  }));
};

WIZ.done = async () => {
  const st = (k) => W.done.has(k) ? '<span class="st ok"><span class="mk"></span>Done</span>' : '<span class="st"><span class="mk"></span>Skipped</span>';
  const anyMissing = !W.done.has("dest") || !W.done.has("route");
  wizShell(`<h2 class="t1">You're set up</h2>
    <ul class="wiz-sum">${WSTEPS.slice(0, -1).map(([k, l]) => `<li>${st(k)}<span>${esc(l)}</span></li>`).join("")}</ul>
    ${anyMissing ? wizStatus("warn", "Mail is refused until there is a route. Add destinations and routes any time from the menu.") : wizStatus("ok", "Send a test email from <strong>Test email</strong>, or point a device at MailBeacon and watch it arrive on Home.")}
    <form id="wForm" hidden></form>`, `<span style="margin-right:auto"></span><button class="btn quiet" type="button" id="wBack2">Back</button><button class="btn primary" type="submit" form="wForm" id="wNext">Go to Home</button>`);
  $("#wBack2").addEventListener("click", () => wizGo(-1));
  $("#wForm").addEventListener("submit", run(async () => {
    const skipped = WSTEPS.slice(1, -1).map(([k]) => k).filter((k) => !W.done.has(k));
    await api("POST", "/api/setup/complete", { skipped });
    W = null; location.hash = "#/home"; toast("Setup finished"); boot();
  }));
};
