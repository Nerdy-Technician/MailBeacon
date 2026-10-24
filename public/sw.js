/* global self, caches, Request */
/* MailBeacon service worker: an offline app shell only.
 * Never caches /api, /docs, /healthz, /metrics or anything that isn't a GET, so no API response,
 * session or credential ever lands in the cache. Push notifications are not used. */
const VERSION = new URL(self.location.href).searchParams.get("v") || "1";
const CACHE = "mb-shell-" + VERSION;
const SHELL = ["/", "/app.js", "/wizard.js", "/style.css", "/favicon.svg", "/fonts/Geist.woff2", "/fonts/GeistMono.woff2", "/pwa-icon-192.png", "/pwa-icon-512.png",
  "/icons/gotify.svg", "/icons/ntfy.svg", "/icons/pushover.svg", "/icons/apprise.svg", "/icons/discord.svg", "/icons/slack.svg", "/icons/telegram.svg", "/icons/webhook.svg"];
const NEVER = /^\/(api|docs|healthz|metrics)(\/|$)/;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { credentials: "omit", cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("mb-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || NEVER.test(url.pathname)) return; // straight to the network
  if (req.mode === "navigate") {
    // network first; offline, show the cached shell (it has no user data in it)
    e.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  e.respondWith(caches.match(url.pathname).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); } return res; });
    if (hit) { net.catch(() => undefined); return hit; } // stale-while-revalidate
    return net;
  }));
});
