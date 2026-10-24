<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-with-title-dark.svg">
    <img src="docs/logo-with-title-light.svg" alt="MailBeacon" height="96">
  </picture>
</p>

<p align="center">
  <strong>Turn email alerts into push notifications.</strong><br>
  A tiny SMTP server for apps that can only shout by email: it forwards every message to Gotify, ntfy, Pushover, Discord, Slack, Telegram, Apprise or any webhook, to several destinations at once if you like.
</p>

<p align="center">
  <a href="https://github.com/Nerdy-Technician/MailBeacon/actions/workflows/ci.yml"><img src="https://github.com/Nerdy-Technician/MailBeacon/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/Nerdy-Technician/MailBeacon/releases/latest"><img src="https://img.shields.io/github/v/release/Nerdy-Technician/MailBeacon?sort=semver" alt="Latest release"></a>
  <a href="https://github.com/Nerdy-Technician/MailBeacon/pkgs/container/mailbeacon"><img src="https://img.shields.io/badge/ghcr.io-nerdy--technician%2Fmailbeacon-c90000?logo=docker&logoColor=white" alt="GHCR image"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Nerdy-Technician/MailBeacon" alt="MIT license"></a>
</p>

<p align="center">
  <img src="docs/screenshots/routes.png" alt="MailBeacon routes page" width="860">
</p>

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Routing](#routing)
- [Notification targets](#notification-targets)
- [Templates and priority](#templates-and-priority) · [Content extraction](#content-extraction) · [Route templates](#ready-made-route-templates) · [Attachments](#attachments) · [Quiet hours and digests](#quiet-hours-and-digests)
- [Users, roles and API keys](#users-roles-and-api-keys) · [Webhook and send API](#webhook-and-http-send-api)
- [Themes and white-label](#themes-and-white-label)
- [Single sign-on (Authentik)](#single-sign-on-oidc)
- [STARTTLS and AUTH](#starttls-and-auth)
- [History filters and CSV](#history-search-filters-and-csv-export) · [Stats](#stats) · [Install as an app](#install-as-an-app-pwa) · [Retention](#retention) · [Health checks (/healthz)](#health-checks-and-monitoring-healthz)
- [Example app configs](#example-app-configs)
- [Reverse proxy (Traefik)](#reverse-proxy-traefik)
- [Security](#security)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Eight destination types, fan-out included:** Gotify, ntfy, Pushover, Discord, Slack, Telegram, generic webhooks, and anything [Apprise](https://github.com/caronc/apprise) can reach (Matrix, email and 100+ more). One route can forward to several destinations on different services at once.
- **Flexible routing:** by recipient (`proxmox@alerts.local` or `*@alerts.local`), sender regex or subject regex, plus an optional catch-all. First match wins.
- **Sensible mapping:** subject becomes the title, body becomes the message, HTML mail is converted to Markdown, and priority is set per route.
- **No open relay:** anything that matches no route is rejected with `550` during the SMTP conversation.
- **STARTTLS and SMTP AUTH**, both optional, with an auto-generated certificate if you don't bring one.
- **Friendly web UI:** routes read like sentences, with a live pattern tester, a notification preview, a **Send test** button, recent messages with retry, and logs.
- **Single sign-on** with any OpenID Connect provider (Authentik, Keycloak, Authelia, Pocket ID...) next to the local admin password.
- **Secrets encrypted at rest** (AES-256-GCM) and passwords hashed with scrypt.
- **Automatic retries** for failed deliveries.
- **One container, one volume:** multi-arch image (`amd64`, `arm64`) with everything in `/data`.

<details>
<summary>More screenshots</summary>

<p align="center">
  <img src="docs/screenshots/route-editor.png" alt="Route editor with pattern tester and preview" width="760"><br>
  <img src="docs/screenshots/route-editor-ntfy.png" alt="Route editor sending to ntfy" width="760">
</p>
</details>

## Quick start

```yaml
# docker-compose.yml
services:
  mailbeacon:
    image: ghcr.io/nerdy-technician/mailbeacon:latest
    container_name: mailbeacon
    restart: unless-stopped
    environment:
      MAILBEACON_SECRET: change-me-to-a-long-random-string   # openssl rand -hex 32
      TZ: Europe/London
    ports:
      - "2525:2525"   # SMTP
      - "8080:8080"   # Web UI
    volumes:
      - ./data:/data
```

```bash
docker compose up -d
```

1. Open `http://<host>:8080`. On a fresh install the **first-run wizard** starts: create the admin account, set SMTP
   basics (STARTTLS and AUTH are optional), add a first destination and send it a test, add a first route, and
   optionally set up single sign-on. Every step after the account can be skipped.
2. Later, add more under **Destinations** and **Routes**. A route can tick several destinations, for example ntfy on
   your phone *and* a Discord channel.
3. Press **Send test** on a route or destination and check it arrives.
4. Point your apps at `<host>:2525` as their SMTP server, with no encryption and no login (unless you turn those on).

Try it from any machine with [swaks](https://jetmore.org/john/code/swaks/):

```bash
swaks --server <host>:2525 --from pve@alerts.local --to proxmox@alerts.local \
      --header "Subject: Backup finished" --body "vzdump of VM 101 finished in 4m 12s"
```

Pin a version instead of `latest` if you prefer: `ghcr.io/nerdy-technician/mailbeacon:0.1.0` or `:0.1`.

## Configuration

Almost everything is set in the web UI. Environment variables cover ports, the encryption key and SSO.

| Variable | Default | Description |
|---|---|---|
| `MAILBEACON_SECRET` | *(empty)* | Encryption key source for tokens/credentials. If unset, a random key is written to `/data/secret.key` and a warning is logged. **Changing it makes stored tokens unreadable.** |
| `MAILBEACON_DATA_DIR` | `/data` | Where the DB, key and TLS files live. |
| `MAILBEACON_SMTP_PORT` | `2525` | SMTP listen port. |
| `MAILBEACON_WEB_PORT` | `8080` | Web UI / API port. |
| `MAILBEACON_HOST` | `0.0.0.0` | Bind address for both listeners. |
| `MAILBEACON_MAX_SIZE_KB` | `1024` | Max message size; bigger mail gets `552`. |
| `MAILBEACON_SMTP_HOSTNAME` | `mailbeacon` | SMTP greeting name and self-signed cert CN. |
| `MAILBEACON_GOTIFY_URL` | *(empty)* | Seeds the global Gotify URL on first start only. |
| `MAILBEACON_PUBLIC_URL` | *(empty)* | The URL you open MailBeacon on, e.g. `https://mailbeacon.example.com`. Used to build the OIDC redirect URI. If unset it is guessed from the request. |
| `MAILBEACON_OIDC_ISSUER` | *(empty)* | OIDC issuer URL. Setting this and the client ID turns on the "Log in with single sign-on" button. |
| `MAILBEACON_OIDC_CLIENT_ID` | *(empty)* | OIDC client ID. |
| `MAILBEACON_OIDC_CLIENT_SECRET` | *(empty)* | OIDC client secret. |
| `MAILBEACON_OIDC_SCOPES` | `openid profile email` | Scopes to request. |
| `MAILBEACON_OIDC_ALLOWED` | *(empty)* | Comma-separated emails and/or group names allowed in. Empty lets in anyone the provider authenticates. |
| `MAILBEACON_OIDC_ALLOW_PRIVATE` | `0` | `1` lets the issuer be on a private, loopback or link-local address and use `http://` (Settings › Sign-in and SSO › *Allow private issuer*). Off, only public `https://` issuers are contacted. Cloud metadata addresses are always refused. Installs that already had SSO configured start with it on. |
| `MAILBEACON_FORCE_LOCAL_LOGIN` | *(empty)* | Set to `1` to turn password login back on if you locked yourself out of SSO. |
| `MAILBEACON_METRICS_TOKEN` | *(empty)* | If set, `/metrics` needs `Authorization: Bearer <token>` (or a logged-in UI session). If empty, `/metrics` is open. |
| `MAILBEACON_DRY_RUN` | *(empty)* | Set to `1` for a test instance: mail is routed and recorded in History, but no notification is ever sent. |
| `MAILBEACON_HEALTHZ_CACHE_SECONDS` | `60` | How long `/healthz` caches destination reachability. |
| `MAILBEACON_HEALTHZ_PROBE` | *(empty)* | Set to `0` to stop `/healthz` contacting destinations at all. |
| `MAILBEACON_RETRY_INTERVAL_MS` | `60000` | How often the retry queue runs. |
| `MAILBEACON_OIDC_GROUPS_CLAIM` | `groups` | Claim that holds the user's groups. |
| `MAILBEACON_OIDC_ADMIN_GROUPS` | *(empty)* | Comma-separated groups that make a user **admin**. |
| `MAILBEACON_OIDC_EDITOR_GROUPS` | *(empty)* | Groups that make a user **editor**. |
| `MAILBEACON_OIDC_VIEWER_GROUPS` | *(empty)* | Groups that make a user **viewer**. |
| `MAILBEACON_OIDC_DEFAULT_ROLE` | `none` | Role for SSO users in no mapped group: `none` (refused), `viewer` or `editor`. |
| `MAILBEACON_GRAVATAR` | `1` | Set to `0` to never load avatars from gravatar.com. |
| `MAILBEACON_SCHEDULER_INTERVAL_MS` | `60000` | How often quiet-hours releases and digests are checked. |
| `MAILBEACON_HTTP_RATE_LIMIT` | `1200` | Requests per minute one client can make to the web UI and API (minimum 60; `/healthz` is never limited). Password logins are capped at 20 a minute on top of the lockout. |

OIDC values set by environment variables override the ones saved in the UI and are shown greyed out there.

### The `/data` volume

Everything MailBeacon keeps lives in `/data`; back up the whole folder.

| Path | What it is |
|---|---|
| `mailbeacon.db` | SQLite database: routes, settings, users, messages, logs |
| `secret.key` | Encryption key, only created if `MAILBEACON_SECRET` is not set |
| `tls/cert.pem`, `tls/key.pem` | STARTTLS certificate and key (generated if missing) |

The container runs as the unprivileged `node` user (uid/gid 1000). A named volume just works. A host folder must be
writable by uid 1000: `mkdir -p ./data && sudo chown 1000:1000 ./data`. If it isn't, the container stops at start-up
with a message saying how to fix it.

**Upgrading from 0.2 or earlier** (the container ran as root, so files in `/data` may be owned by root): either run
`sudo chown -R 1000:1000 ./data` once, or start 0.3 once with `user: "0:0"` in compose (`--user 0` with `docker run`).
Started as root, the entrypoint fixes the ownership and still runs MailBeacon as `node`. Remove the `user:` line afterwards.

> **Keep your key.** If you lose or change `MAILBEACON_SECRET` (or `secret.key`), stored tokens can't be decrypted
> and you'll need to re-enter them.

## Routing

Each route says **when** a message matches and **where** it goes. Routes are checked top to bottom and the
**first enabled route that matches wins**; later routes are ignored for that message.

| Match on | Pattern example | Notes |
|---|---|---|
| Recipient | `proxmox@alerts.local`, `*@alerts.local` | Exact address or `*` glob, case-insensitive. Checked at `RCPT TO`. |
| Sender | `^root@pve\d+\.lan$`, `.*@nas\.lan` | Case-insensitive regex on the envelope sender (`MAIL FROM`). |
| Subject | `(fail\|error\|critical)` | Regex, checked once the message has arrived. |
| Catch-all | — | Matches everything. |

- Put specific routes first and broad ones (like a catch-all) last. New routes are added above an existing catch-all automatically.
- Without a catch-all, MailBeacon only accepts mail it knows what to do with. Leave it out to stay strict.
- If any subject route exists, unknown recipients are accepted at `RCPT TO` and rejected with `550` after `DATA` when the subject doesn't match either.
- The route form has a **test this pattern** box that tells you whether a sample address or subject would match before you save.
- Use ▲/▼ to reorder, the switch to turn a route off without deleting it, and **Send test** to check its target.

Example set:

1. Subject `fail|error|critical` → ntfy "Phone" **and** Discord "#alerts", priority 10 (anything failing shouts, whoever sent it)
2. Recipient `proxmox@alerts.local` → Gotify "Proxmox", priority 5
3. Sender `@nas\.lan$` → Telegram "Home" and a webhook into Home Assistant
4. Catch-all → Slack "#misc", priority 2

## Notification targets

Destinations are saved once under **Destinations** (pick the service from the icon grid) and ticked per route under **Deliver to**. A route can send to several
destinations at once (fan-out); each delivery is retried and logged separately. Leaving a secret field blank when
editing keeps the stored value.

| Service | Settings | Notes |
|---|---|---|
| **Gotify** | App token, priority 0–10, optional server URL | Markdown is rendered for HTML mail. |
| **ntfy** | Server URL, topic, access token *or* username/password, Markdown on/off | ntfy.sh or self-hosted. Priority maps to 1–5. One attachment. |
| **Pushover** | App token, user or group key, HTML on/off | Priority maps to −2…1. One image up to 5 MB. Emergency isn't offered. |
| **Discord** | Webhook URL, bot name | Attachments are uploaded with the message. |
| **Slack** | Incoming webhook URL, optional username | Text only; attachments are listed by name. |
| **Telegram** | Bot token, chat ID | Priority 3 or below is sent silently. Attachments as documents. |
| **Apprise** | Apprise API URL, plus notification URLs *or* a saved config key | Use [apprise-api](https://github.com/caronc/apprise-api). |
| **Webhook** | URL, POST or PUT, optional Authorization header | JSON body; attachments as base64 when ticked. |

**Send test** and **Retry** work for every service. Failed deliveries are retried every minute, up to 5 attempts.

### First-run wizard

Shown only while the instance has **no users at all**. Once any user exists, `POST /api/setup` always answers `409`,
signed in or not, so the wizard can't be used to create a second admin or overwrite the first. Admins can run the
rest of the wizard again from **Settings › General › Run setup wizard**; it uses the normal admin API and keeps your
account. Service icons are from [selfh.st/icons](https://selfh.st/icons) (CC BY 4.0), bundled in `public/icons`.

## Templates and priority

Each route can set a **title** and **body template** using `{{subject}}`, `{{from}}`, `{{to}}`, `{{body}}`,
`{{route}}`, `{{date}}`, `{{time}}`, `{{datetime}}`, `{{attachments}}` and `{{priority}}`; add `:N` to cut to N
characters (`{{body:200}}`). **Priority rules** match a regular expression against the subject, sender or body; the
first match sets the priority (0–10), which is mapped to each service's own scale. The route editor has a live preview.

## Content extraction

A route can pull named values out of each message and use them anywhere a template variable works. Add rows under
**Route → Template and priority → Extract values**:

- **Regex**: a regular expression with named groups, e.g. `^\[(?<monitor>[^\]]+)\] \[.*?(?<state>Up|Down)\]` against the
  subject. Every named group becomes a variable.
- **Field**: a simple `Name: value` line, e.g. field `Host` in the body becomes `{{host}}` (or the name you give it).

Values are used as `{{monitor}}`, with a fallback `{{monitor|unknown}}` (fallbacks can nest: `{{alert|{{subject}}}}`).
Priority rules can match on `var:monitor` etc. as well as subject, sender and body. Extracted text is inserted
literally, never re-expanded. The **live preview** renders the title, body, priority and extracted values against a
pasted sample: paste a whole raw email (headers + body) or just the body.

## Ready-made route templates

**Routes → From template** opens a gallery of routes with matching, extraction, templates and priority rules already
filled in. Each card says how sure we are of the format:

| Template | Confidence | Notes |
|---|---|---|
| Proxmox VE backups (vzdump) | Known format | |
| TrueNAS alerts | Partly known | Body is the alert text; the subject prefix is a guess and varies by version. |
| Unraid notifications | Partly known | Body fields (Event/Subject/Description/Importance) are known; subjects vary. |
| UPS (NUT upsmon) | Partly known | Uses upsmon's NOTIFYMSG wording; the subject depends on your NOTIFYCMD script. |
| Synology DSM | Guessed | DSM wording varies by package and language; check against a real mail. |
| Uptime Kuma | Known format | `[Name] [🔴 Down] reason` subject and `Time (tz):` body line, from Uptime Kuma's SMTP provider. |
| Cron job output | Known format | `Cron <user@host> command` subject. |

Templates are a starting point; paste a real email into the preview before relying on one.

## Attachments

Routes can forward attachments: up to 10 files to Discord, Telegram, Apprise and Webhook, one to ntfy, one image to
Pushover, none to Gotify or Slack. Limits in Settings → SMTP and limits (defaults: 1 MB per file, 5 MB
per message, 5 files); files past a limit are not stored or forwarded. Attachments are stored in the database with the
message, so keep the history retention sensible.

## Quiet hours and digests

**Quiet hours** hold a route's messages between two times on chosen days (in the time zone from Settings → General).
Messages at or above the bypass priority go out anyway. When the window ends, held messages are sent one by one or as
one digest. A **digest** batches every message on a route into one notification every N minutes.

## Users, roles and API keys

MailBeacon has three roles. Upgrading from 0.2.0 turns the old single admin password into the user `admin`, who owns
everything that already existed.

| Role | Can |
|---|---|
| **Admin** | Everything: all users' routes, destinations and history, settings, users, audit log, backup. |
| **Editor** | Create and change their own routes and destinations; see, retry and discard their own messages; send tests. |
| **Viewer** | Read their own routes, destinations and history. |

Admins add local users under **Settings → Users**. SSO users are created on first sign-in and get their role from their
groups (see below). Every change to users, routes, destinations, settings and keys is written to the **Audit log**.

**API keys** are created from **Profile → API keys** with scopes (`routes:read`, `routes:write`, `destinations:read`,
`destinations:write`, `messages:read`, `messages:write`, `messages:send`, `test:send`, `admin`) and an expiry. Send
`Authorization: Bearer mbk_…`; no CSRF header is needed. A key never does more than its owner's role allows and is
shown only once. Admins can see and revoke every key.

**Avatars** come from the SSO `picture` claim, [Gravatar](https://gravatar.com) (SHA-256 of the email, `d=404`), or an
uploaded PNG, JPEG, WebP or GIF up to 5 MB (checked by content, not file name; decoded, cropped square and stored as a 256 px WebP with metadata stripped; animations keep their first frame; images over 40 megapixels are refused), with initials as the fallback. Pick the source in **Profile**.

## Webhook and HTTP send API

Apps that can't send email can post to MailBeacon over HTTP. Messages go through the same routing, templates,
extraction, priority, quiet hours, history, retries, dead letters and fan-out as email.

- `POST /api/webhook/{routeId}`: any JSON (or form) body to a specific route. `title`/`subject`/`summary`/`name` and
  `message`/`body`/`text`/`description` are used if present, otherwise the body is the pretty-printed JSON. All fields
  (nested ones flattened as `host_name`) are available as template variables.
- `POST /api/send`: `{"route": 3, "title": "…", "message": "…", "priority": 7}`, or leave out `route` and give
  `from`/`to` so normal route matching picks one.

Both need an API key with the **`messages:send`** scope (`Authorization: Bearer mbk_…`) and return `202` with the
message id. A key can only send to its owner's routes. For apps that can't set headers, a key whose **only** scope is
`messages:send` may be passed as `?key=` on the webhook URL (this puts the key in URLs and proxy logs, so use a
dedicated key). Requests are rate-limited per key (default 60/min, **Settings → Limits**; `429` with `Retry-After`).
Full schemas and a "Try it out" button are in **Swagger** at `/docs`.

```sh
curl -X POST https://mailbeacon.example.com/api/webhook/3 \
  -H "Authorization: Bearer $MAILBEACON_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Disk almost full","message":"/data is 93% full","host":{"name":"nas01"}}'
```

## Themes and white-label

MailBeacon has light and dark themes in the MailBeacon red (#c90000) and charcoal (#1e1e1e). Each user picks light,
dark or system in **Profile**; admins set the default for everyone (and the sign-in page) in **Settings → General →
Branding**. There, admins can also set an **app name** (up to 40 characters, used in the header, page title and sign-in
page) and upload a **logo** (PNG, JPEG, WebP or GIF up to 1 MB, checked by content and re-encoded to a PNG of up to
256 px, used in the header, sign-in page and as the favicon). Clear the name or remove the logo to go back to MailBeacon.

### Outbound connections

MailBeacon only connects to: the notification services you configure, your OIDC provider, and, for avatars,
`gravatar.com` and the URL in the SSO `picture` claim (loaded by the browser, not the server). Turn Gravatar off with
`MAILBEACON_GRAVATAR=0` or in **Settings → General**.

## Backup: export and import

**Settings → Backup** exports settings, users (without passwords), destinations and routes as JSON. Secrets are left out
(imported items start disabled) or included encrypted with a passphrase of 12+ characters. Import always shows a dry-run
of what would change first; **Merge** adds alongside, **Replace** removes current routes and destinations first. Message
history, uploaded avatars and SMTP user passwords are not exported. Same via `POST /api/config/export` and
`POST /api/config/import`.

## Single sign-on (OIDC)

MailBeacon uses standard OpenID Connect (authorisation code flow with PKCE, state and nonce). Configure it in
**Settings → Single sign-on** or with the `MAILBEACON_OIDC_*` variables; environment values win and show greyed out
in the UI. The redirect URI to register with your provider is `<public URL>/api/oidc/callback`, and it's shown on the
Settings page.

The local admin password keeps working alongside SSO. After one successful SSO login you can tick **Disable password
login**. If SSO breaks later, start the container with `MAILBEACON_FORCE_LOCAL_LOGIN=1` to get the password form back.

### Authentik

1. In Authentik go to **Applications → Providers → Create** and choose **OAuth2/OpenID Provider**.
   - Name: `MailBeacon`
   - Authorization flow: `default-provider-authorization-implicit-consent` (or the explicit one if you want a consent screen)
   - Client type: **Confidential**. Note the generated **Client ID** and **Client Secret**.
   - Redirect URIs: `Strict` → `https://mailbeacon.example.com/api/oidc/callback` (copy it from MailBeacon's Settings page)
   - Signing key: pick a certificate such as `authentik Self-signed Certificate` so ID tokens are signed with RS256.
   - Advanced protocol settings → Scopes: keep `openid`, `email` and `profile` (Authentik's `profile` mapping includes `groups`).
2. Go to **Applications → Applications → Create**: name `MailBeacon`, slug `mailbeacon`, provider `MailBeacon`.
   Optionally bind a group (for example `MailBeacon Admins`) under **Policy / Group / User Bindings** so only that group can launch it.
3. In MailBeacon **Settings → Single sign-on** (or env vars):
   - Public URL: `https://mailbeacon.example.com`
   - Issuer URL: `https://auth.example.com/application/o/mailbeacon/` (the slug from step 2; MailBeacon reads `.well-known/openid-configuration` under it)
   - Client ID / Client secret: from step 1
   - Allowed emails or groups: e.g. `MailBeacon Admins` (group names are matched case-insensitively against the `groups` claim; emails against `email`)
4. Save, log out, and press **Log in with single sign-on**. After that works you can disable password login.

### Roles from groups

Under **Settings → Auth and OIDC → Roles from groups** (or `MAILBEACON_OIDC_*_GROUPS`) map provider groups to roles,
e.g. `mailbeacon-admins`, `mailbeacon-editors`, `mailbeacon-viewers`. The role is re-evaluated at every SSO sign-in and
the highest match wins; users in no mapped group get the default role (`none` refuses them). Users are linked by the
provider's subject ID, never by email. If no group is mapped at all, every allowed SSO user is an admin, as in 0.2.0.
The last admin is never demoted. Full walkthrough: [docs/authentik.md](docs/authentik.md).

## STARTTLS and AUTH

Both are optional and **off by default**; turn them on in **Settings** and the SMTP listener restarts by itself.
SMTP AUTH is marked *Recommended*: it is your choice, but it stops any device on the network from pushing notifications.

- **STARTTLS** uses `/data/tls/cert.pem` and `/data/tls/key.pem`. If they don't exist a self-signed pair is generated.
  Drop in your own certificate and restart the container to use it. Most appliances accept self-signed certificates
  for SMTP; some need "verify certificate" turned off.
- **AUTH** makes every client log in with one of the SMTP users you add under **Settings → SMTP users**
  (`PLAIN` and `LOGIN`). AUTH needs STARTTLS: it is only offered after the client has upgraded the connection, so
  passwords never cross the network in clear text, and Settings won't let you enable AUTH without STARTTLS.

## SMTP limits

**Settings → SMTP limits** (0 = no limit):

| Limit | Default | When exceeded |
|---|---|---|
| Max open connections | 50 | `421` and the connection is closed |
| Max connections per IP | 10 | `421` |
| Messages per minute per IP | 60 | `450` (temporary: well-behaved senders retry later) |
| Max recipients per message | 20 | `452` for the extra recipients |

## History, retries and dead letters

- **History** lists every accepted message with its route and status. Filter by status or search sender, recipient and
  subject; click a row for its delivery log (received → each attempt → delivered, or failed → dead).
- Failed deliveries are retried once a minute. After **5 failed attempts** a message becomes a **dead letter**.
- **Dead letters** shows them with the last error. *Retry* gives a message a fresh set of attempts; *Discard* deletes it.

## Testing routes

The **Test** tab has two buttons:

- **Preview route** shows which route would take a message with that sender, recipient and subject, how every route
  was evaluated, and whether non-matching mail is refused at `RCPT TO` or after `DATA`. Nothing is sent.
- **Send test email** injects the message into the normal pipeline (routing, History, delivery to the target), exactly
  like mail arriving over SMTP. Mail that matches nothing is refused, as a real `550` would be.

## History search, filters and CSV export

History filters by text, sender, route, destination, status and a date range (whole days in UTC). **Export CSV** downloads what the filters match (newest 10,000 rows) with a header row, UTF-8 BOM and CRLF line ends, so Excel opens it cleanly. Any cell that starts like a formula (`=`, `+`, `-`, `@`, tab or CR) is prefixed with `'` so a crafted sender or subject can't run as a spreadsheet formula. Exports are in the audit log. Editors and viewers only see, filter and export their own mail.

API: `GET /api/messages?sender=&routeId=&destination=dest:3&status=&from=2026-10-01&to=2026-10-24` and the same on `/api/messages/export.csv`.

## Stats

The **Stats** page shows, for 7, 30 or 90 days: messages per route per day, delivery attempts per destination per day, failure rates by route and destination, and the top senders. Everything comes from stored history; nothing is sampled or estimated. Days are UTC. Per-destination numbers start from 0.3.0 (older mail only counts per route). Retention shortens what Stats can show. API: `GET /api/stats/report?days=30`.

## Install as an app (PWA)

Open MailBeacon over **HTTPS** (for example behind Traefik) and use the browser's *Install* / *Add to Home Screen*. The app name and icon follow Settings › Appearance. A service worker caches only the static shell (HTML, JS, CSS, fonts, icons) so the app opens offline and says so; it never caches API responses, sign-in or `/healthz`, so no mail data is stored by it. Browsers only allow service workers on HTTPS or `localhost`; over plain `http://LAN-IP` the site still works but isn't installable. No push notifications.

## Retention

Settings › **Backup and retention**:

| Setting | Default | What it does |
| --- | --- | --- |
| Keep history for (days) | `0` (forever) | Deletes finished messages (delivered, dead letters, suppressed) older than this, with their attachments and delivery log. |
| Keep attachments for (days) | `30` | Removes attachments older than this; the message stays in History. |

It runs hourly and is written to the audit log. Pending, retrying and held (quiet hours/digest) mail is never deleted. Admins can also **Delete old data now**: MailBeacon shows how much would go, asks you to confirm, then writes it to the audit log. API: `GET/PUT /api/retention`, `POST /api/retention/purge` with `{"olderThanDays": 90, "what": "history"|"attachments", "dryRun": false, "confirm": true}` (`dryRun` defaults to `true` and only counts).

## Health checks and monitoring (`/healthz`)

`GET /healthz` needs no login and returns `200` when healthy or `503` when not:

```json
{ "status": "ok", "dryRun": false,
  "checks": { "smtp": { "ok": true }, "database": { "ok": true },
              "destinations": { "ok": true, "total": 3, "reachable": 3, "unreachable": 0, "skipped": 0, "cached": true, "checkedAt": "…" } } }
```

- **Destinations** are checked by a quick `HEAD` to each service's host (Gotify `/health`, ntfy `/v1/health`); any HTTP answer counts as reachable. Nothing is sent. Results are cached for 60 s (`MAILBEACON_HEALTHZ_CACHE_SECONDS`) and callers share one check, so polling can't flood your services. In dry-run, or with `MAILBEACON_HEALTHZ_PROBE=0`, they're skipped (`skipped` count).
- **Without login** you only see statuses and counts: no names, hostnames, URLs or secrets. Admins (session or API key) also get a per-destination list with names and results.
- `GET /healthz?core=1` checks only SMTP and the database. The Docker `HEALTHCHECK` uses this, so a notification service being down doesn't mark the container unhealthy.
- `/api/health` (simple liveness) still works.

**Uptime Kuma**: add an *HTTP(s) - Keyword* monitor for `http://mailbeacon:8080/healthz` with keyword `"status":"ok"` (or an *HTTP(s) - Json Query* monitor with expression `status` and expected value `ok`). Accepted status codes: 200-299, so a 503 alerts. Use `/healthz?core=1` if you only want to know MailBeacon itself is up.

**OpenRMM** (or any RMM / Nagios-style script check): poll the URL and alert on non-200, for example:

```sh
curl -fsS -m 10 http://mailbeacon:8080/healthz >/dev/null || exit 2
```

## Self-test, metrics and API docs

- At startup MailBeacon checks that every Gotify server used by an enabled route answers `/health` and that each Gotify
  token is well-formed. Results go to the Logs page, the console and **Settings → Self-test** (with a *Run now* button).
  App tokens can't be verified without posting a message, so the self-test never sends one; use *Send test* on a route.
- `GET /metrics` serves Prometheus metrics: messages received, deliveries, failures, dead letters, rejections by reason,
  connections, queue size by status and self-test status. See `MAILBEACON_METRICS_TOKEN`.
- **Swagger UI** is at `/docs` and the OpenAPI 3.1 spec at `/docs/json`. Log in to the web UI first; non-GET calls need the
  header `X-MailBeacon: 1`.

## Example app configs

In every example, replace `mailbeacon.lan` with your host and add a matching route in MailBeacon.

### Proxmox VE 8+

**Datacenter → Notifications → Add → SMTP**

| Field | Value |
|---|---|
| Server | `mailbeacon.lan` |
| Encryption | `None` (or `STARTTLS` if enabled) |
| Port | `2525` |
| Authenticate | only if you enabled SMTP AUTH |
| From address | `pve@alerts.local` |
| Recipient(s) | an additional recipient `proxmox@alerts.local` |

Then edit the **default-matcher** (or add one) to send to that target. Route: recipient `proxmox@alerts.local`.

Older Proxmox (postfix): set `relayhost = [mailbeacon.lan]:2525` in `/etc/postfix/main.cf`, run `postfix reload`, and
set root's email address to `proxmox@alerts.local`.

### TrueNAS (SCALE / Community Edition)

**System → Alert Settings → E-Mail → Edit** (or **System → General → Email**)

- Send mail method: **SMTP**
- Outgoing mail server: `mailbeacon.lan`, port `2525`
- Security: **Plain** (or **TLS (STARTTLS)** if enabled)
- SMTP authentication: only if you enabled AUTH
- From email: `truenas@alerts.local`

Set the admin user's email to `truenas@alerts.local`, press **Send Test Mail**, and add a route for recipient
`truenas@alerts.local` (or sender `^truenas@alerts\.local$`).

### Synology DSM

**Control Panel → Notification → Email → Add SMTP server → Custom SMTP server**

- SMTP server: `mailbeacon.lan`, port `2525`
- Secure connection (SSL/TLS): off (or on if STARTTLS is enabled)
- Authentication: only if you enabled AUTH
- Sender email: `synology@alerts.local`, recipient `synology@alerts.local`

Press **Send a test email** and add a route for recipient `synology@alerts.local`.

### Seerr / Overseerr / Jellyseerr

**Settings → Notifications → Email**

- Enable agent: on
- Sender name: `Seerr`, sender address `seerr@alerts.local`
- SMTP host `mailbeacon.lan`, port `2525`
- Encryption method: **None** (or **Use STARTTLS if available**)
- SMTP username/password: only if you enabled AUTH

Each user's notifications go to their own account email, so route on the **sender** rather than the recipient:
sender `^seerr@alerts\.local$`. Press **Test** to check it.

### Anything else

Most apps need the same four things:

| Setting | Value |
|---|---|
| SMTP host | `mailbeacon.lan` |
| Port | `2525` |
| Encryption | None, or STARTTLS if you enabled it (never implicit SSL/TLS on 465) |
| Username/password | Blank, or an SMTP user if you enabled AUTH |
| From / To | Any address you can route on, e.g. `app@alerts.local` |

If the app sends to an address you don't control (like a user's own email), route on sender or subject instead.
The **History** and **Logs** tabs show what arrived and why mail was rejected.

## Reverse proxy (Traefik)

See [docs/reverse-proxy.md](docs/reverse-proxy.md) for Traefik, Caddy, nginx and Cloudflare Tunnel examples, forward-auth
exclusions for SSO, and a Prometheus scrape config.

Only the web UI goes through the proxy; SMTP is plain TCP on 2525 and should stay on your LAN.

```yaml
services:
  mailbeacon:
    image: ghcr.io/nerdy-technician/mailbeacon:latest
    restart: unless-stopped
    environment:
      MAILBEACON_SECRET: change-me
      MAILBEACON_PUBLIC_URL: https://mailbeacon.example.com
    ports:
      - "2525:2525"            # SMTP stays published directly
    volumes:
      - ./data:/data
    networks: [proxy]
    labels:
      - traefik.enable=true
      - traefik.http.routers.mailbeacon.rule=Host(`mailbeacon.example.com`)
      - traefik.http.routers.mailbeacon.entrypoints=websecure
      - traefik.http.routers.mailbeacon.tls.certresolver=letsencrypt
      - traefik.http.services.mailbeacon.loadbalancer.server.port=8080

networks:
  proxy:
    external: true
```

- Set `MAILBEACON_PUBLIC_URL` to the HTTPS address so the SSO redirect URI is correct.
- Don't put Authentik forward-auth in front of `/api/oidc/callback`; use MailBeacon's built-in SSO instead, or exclude that path.

## Security

- **No open relay.** Mail that doesn't match an enabled route is refused with `550 5.1.1` before it's accepted, and MailBeacon never forwards mail to other mail servers; it only calls the notification APIs you configure.
- **Encryption at rest.** Target tokens, Apprise URLs, SMTP user credentials and the OIDC client secret are encrypted with AES-256-GCM using `MAILBEACON_SECRET` (or `/data/secret.key`). Admin and SMTP passwords are hashed with scrypt. The API never returns stored secrets in full.
- **Web UI.** HttpOnly, `SameSite=Strict` session cookies, a required custom header on state-changing requests, and 12-hour sessions. Use HTTPS through a reverse proxy if it's reachable beyond your LAN.
- **Keep SMTP on the LAN.** Port 2525 isn't meant to face the internet; turn on AUTH and STARTTLS if untrusted devices share the network.
- **Size limit.** Messages over `MAILBEACON_MAX_SIZE_KB` are rejected with `552`.
- The container runs as an unprivileged user.

Found a vulnerability? Please follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Development

Requires Node.js 22.

```bash
npm ci
MAILBEACON_DATA_DIR=./data MAILBEACON_SECRET=dev-only npm run dev   # web on :8080, SMTP on :2525

npm run lint        # ESLint
npm run typecheck   # TypeScript
npm test            # Vitest
npm run build       # compile to dist/
docker build -t mailbeacon:dev .
```

Running from source in production: `npm ci && npm run build && MAILBEACON_DATA_DIR=./data MAILBEACON_SECRET=... npm start`.

The `/api/health` endpoint returns `{"ok": true, "version": "0.1.0"}` and is used by the Docker health check.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE) © Nerdy-Technician
