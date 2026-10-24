# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- User-supplied regular expressions (route patterns, priority and extraction rules) now run on a linear-time RE2 engine, so a pattern such as `(a+)+$` can no longer stall mail handling. Patterns are capped at 1000 characters; lookarounds and backreferences are rejected with a clear message when saved.
- Every HTTP route is rate-limited per client (`MAILBEACON_HTTP_RATE_LIMIT`, default 1200 a minute; 429 with Retry-After), and password logins to 20 a minute.
- The generated TLS key/certificate and `secret.key` are created atomically and never overwrite an existing file.
- Dependency updates: fast-uri and nodemailer (npm audit is clean); the image installs Debian security updates on build.

### Changed

- **Project automation**: CI on Node 22 and 24 with a multi-arch Docker build and smoke test; CodeQL; Trivy and gitleaks scans reported to code scanning; OpenSSF Scorecard; dependency review, conventional PR titles and release labels on pull requests; Release Drafter with an autolabeler; weekly grouped Dependabot updates with auto-merge for patch and minor versions once CI passes; stale issues and PRs; a labels sync; CODEOWNERS and refreshed issue forms. Every action is pinned to a commit SHA.
- **Releases** are now made by publishing the draft GitHub release; that builds and pushes the image (`X.Y.Z`, `X.Y`, `latest`) with an SBOM and provenance and scans it. Bumping `package.json` on `main` no longer releases on its own.

## [0.3.0] - unreleased

### Added

- **History search and filters**: sender, route, destination, status and a date range (UTC days), on top of the text search, plus **Export CSV** of the current filter (newest 10,000 rows). Filters are scoped like History, so a user can't filter on, or learn about, someone else's route or destination. CSV cells that start like a formula (`=`, `+`, `-`, `@`, tab, CR, or their full-width forms) are prefixed with `'`; exports are audited (`messages.exported`). New `GET /api/messages/export.csv` and `GET /api/messages/filters`; `GET /api/messages` takes `sender`, `destination`, `from` and `to`.
- **Stats page**: messages per route and delivery attempts per destination per day (7, 30 or 90 days), failure rates by route and destination, and the top senders, from stored history only. New `GET /api/stats/report`. Per-destination numbers are recorded from this version on (schema v4, `deliveries` table).
- **Installable app (PWA)**: a manifest that follows the white-label name and logo, 192/512 px icons (also maskable), mobile meta tags, and a service worker that caches only the static shell for offline start. It never caches `/api`, auth, `/docs`, `/healthz` or `/metrics`. No push notifications.
- **Retention**: Settings › Backup and retention deletes finished history (default: keep forever) and attachments (default: 30 days) after N days, checked hourly and audited (`retention.applied`). Pending, retrying and held mail is never deleted. Admins can also delete old data now: it shows the count first, needs a confirm, and is audited (`retention.purged`). New `GET/PUT /api/retention` and `POST /api/retention/purge`.
- **`/healthz`** for monitors: no auth, JSON with the SMTP listener, database and destination reachability; 200 when healthy, 503 when not. Destination probes are cached (60 s, `MAILBEACON_HEALTHZ_CACHE_SECONDS`) and shared between callers, so it can't be used to flood them; skipped in dry-run or with `MAILBEACON_HEALTHZ_PROBE=0`. Anonymous callers get counts and statuses only; admins also get per-destination results (names, never URLs). `?core=1` skips destinations; the Docker `HEALTHCHECK` (Dockerfile and compose) uses it. `/api/health` is unchanged.
- **Content extraction**: per-route regex named groups or simple `Name: value` fields from the subject or body, usable as `{{name}}` / `{{name|fallback}}` (nestable) in titles and bodies and as `var:name` in priority rules. The live preview now takes a pasted raw email or body and shows the extracted values.
- **Ready-made route templates** (Routes › From template) for Proxmox vzdump, TrueNAS, Unraid, UPS (NUT), Synology DSM, Uptime Kuma and cron, each marked known / partly known / guessed with notes. New `GET /api/route-templates`.
- **Inbound webhook and HTTP send API**: `POST /api/webhook/{routeId}` and `POST /api/send` (JSON or form) go through the normal routing, history, dead letters and fan-out. New `messages:send` key scope, `?key=` for send-only keys on webhook URLs, a per-key rate limit (Settings › Limits, default 60/min), and Swagger docs.
- **Light and dark themes** in the brand red and charcoal, with an admin default theme.
- **White-label**: admin-set app name (header, title, sign-in page) and logo (type checked by content, 1 MB max, re-encoded to PNG ≤256 px; also used as the favicon). New `GET/POST/DELETE /api/branding/logo`.
- **First-run wizard** on a fresh install: admin account, SMTP basics (optional AUTH), first destination with a dry-run-aware test, first route with fan-out, optional OIDC, then Home. Admins can re-run it from Settings › General. `POST /api/setup` is locked (409) once any user exists; new `POST /api/setup/complete` (admin).
- **Clearer Settings**: a one-line description per section, plain-English labels, help text with the default under every field, rare options under "Advanced", "Unsaved changes" / "Saved HH:MM" state, a warning before leaving with unsaved changes, inline validation, and a search box that filters settings and points to matches on other tabs.
- **Test buttons**: `POST /api/smtp/test` (EHLO to MailBeacon's own listener, reports STARTTLS/AUTH; sends no mail), `POST /api/oidc/test` (fetches the issuer's discovery document; signs nobody in), and "Send test" for any destination in Settings › Alerts and tests.
- **Profile pictures up to 5 MB**, checked by magic bytes and re-encoded server-side to a 256×256 WebP (EXIF stripped, decompression bombs refused).
- **Multi-destination made obvious**: a service picker with icons (selfh.st, bundled locally), a "Forwards to" panel on Home, fan-out counts in the route editor.
- UI polish: empty, loading and error states on every page; toasts with close and pause-on-hover; keyboard navigation (skip link, menus, tabs); responsive off-canvas nav under 820 px.

- **Users and roles** (admin, editor, viewer). The 0.2.0 admin password becomes user `admin`, who owns all existing routes, destinations and history. Editors and viewers only see their own.
- **OIDC group-to-role mapping** (`MAILBEACON_OIDC_*_GROUPS`, default role), re-evaluated on each SSO sign-in; accounts linked by `sub`.
- **Scoped API keys** (`Authorization: Bearer mbk_…`) with expiry, never more than the owner's role.
- **Audit log** of user, route, destination, settings and key changes.
- **Destinations** saved once and shared by routes, with fan-out to several per route. New services: **Discord, Slack, Telegram, Webhook** (plus Gotify, ntfy, Pushover, Apprise).
- **Title and body templates** and **priority rules** (subject/sender/body regex to priority 0–10, mapped per service).
- **Attachments** forwarded where the service supports them, with per-file, per-message and count limits.
- **Quiet hours** (with bypass priority) and **digests**.
- **Config export/import** with secrets left out or encrypted by passphrase, and a dry-run check before import.
- **Self-alerts**: MailBeacon notifies a chosen destination about piling-up dead letters, unreachable destinations and a failed self-test, with a cooldown.
- **Avatars** from the OIDC `picture` claim, Gravatar or upload, with initials fallback (`MAILBEACON_GRAVATAR=0` turns Gravatar off).
- **New web UI**: Home dashboard, Settings tabs, Profile (display name, email, password, own API keys, theme, time zone), footer with health, version and links.
- `docs/authentik.md`.

### Changed

- Database schema v3 (migrated automatically; back up `/data` first).
- `POST /api/login` takes `username` (defaults to `admin` for 0.2.0 clients).
- Swagger documents every endpoint, including the new ones.
- When a request has both a session cookie and an API key, the key wins, so its narrower scopes apply and it is what gets audited.

## [0.2.0] - unreleased

### Added

- **SMTP limits** in Settings: max open connections (421), connections per IP (421), messages per minute per IP (450) and recipients per message (452).
- **Delivery history** page with status filter, search, paging and a per-message delivery log.
- **Dead letters**: messages that fail 5 times move to their own page, where they can be retried or discarded. Existing failed messages that used every attempt are migrated.
- **Test tab**: preview which route takes a message (nothing sent), and send a test email through the real pipeline.
- **Startup self-test** of Gotify reachability (`/health`) and token format, also runnable from Settings.
- **`/metrics`** Prometheus endpoint, optionally protected by `MAILBEACON_METRICS_TOKEN`.
- **Swagger UI** at `/docs` with an OpenAPI 3.1 spec of the whole API at `/docs/json`.
- **Dry-run mode** (`MAILBEACON_DRY_RUN=1`) for test instances: routes and records mail without sending notifications.
- `docs/reverse-proxy.md`: Traefik, Caddy, nginx and Cloudflare Tunnel setups with SSO and forward-auth exclusions.

### Changed

- SMTP AUTH stays optional and off by default (now labelled *Recommended*), but is only offered after STARTTLS and can no longer be enabled without it.
- The Messages tab is now **History**. `GET /api/messages` accepts `status`, `q`, `routeId`, `limit` and `offset` and returns the total in `X-Total-Count`; it still returns a plain array.
- Unmatched mail rejections, rate limits and failures are counted in metrics and the logs.

## [0.1.0] - 2026-10-17

First public release.

### Added

- SMTP listener that turns incoming email into push notifications, for apps that can only send email alerts.
- Routing by recipient (exact or `*@domain` glob), sender regex or subject regex, with an optional catch-all. Routes are checked in order and the first enabled match wins.
- Notification targets: Gotify, ntfy, Pushover and Apprise (API server, with notification URLs or a saved config key).
- Subject mapped to the title and the body to the message; HTML-only mail is converted to Markdown. Priority is set per route.
- No open relay: mail that matches no route is rejected with `550`.
- Optional STARTTLS (your own certificate or an auto-generated self-signed one) and optional SMTP AUTH with users managed in the UI.
- Web UI: routes as readable sentences with on/off switches, ordering, a live pattern tester and a notification preview; recent messages with retry; logs; settings; a **Send test** button per route.
- Single sign-on with any OpenID Connect provider (tested with Authentik), alongside the local admin password, with an emergency `MAILBEACON_FORCE_LOCAL_LOGIN` switch.
- Target secrets, SMTP credentials and the OIDC client secret encrypted at rest with AES-256-GCM; passwords hashed with scrypt.
- Automatic retries for failed deliveries (every minute, up to 5 attempts).
- Docker image for `linux/amd64` and `linux/arm64`, with all data in a single `/data` volume and a health check.
- `/api/health` and the UI footer report the running version.

[Unreleased]: https://github.com/Nerdy-Technician/MailBeacon/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Nerdy-Technician/MailBeacon/releases/tag/v0.1.0
