# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
