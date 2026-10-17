# Contributing to MailBeacon

Thanks for helping out! Bug reports, docs fixes and pull requests are all welcome.

## Getting started

You need Node.js 22 (20 works too) and the usual build tools for `better-sqlite3` (`python3`, `make`, `g++`)
if no prebuilt binary is available for your platform.

```bash
git clone https://github.com/Nerdy-Technician/MailBeacon.git
cd MailBeacon
npm ci
MAILBEACON_DATA_DIR=./data MAILBEACON_SECRET=dev-only npm run dev
```

The web UI is on <http://localhost:8080> and SMTP on port 2525. Send a test mail with
`swaks --server localhost:2525 --to test@alerts.local --header "Subject: Hello" --body "Hi"`.

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run build
docker build -t mailbeacon:dev .   # optional
```

- Keep pull requests focused on one change and add tests for new behaviour.
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for anything users will notice.
- Never commit secrets, real tokens or your `data/` folder.
- The UI is plain HTML, CSS and JavaScript in `public/` with no build step; please keep it that way.

## Project layout

| Path | What it is |
|---|---|
| `src/smtp.ts` | SMTP server, relay checks, STARTTLS and AUTH |
| `src/matcher.ts` | Route matching |
| `src/mapper.ts` | Email to notification mapping (HTML to Markdown) |
| `src/targets.ts` | Gotify, ntfy, Pushover and Apprise senders |
| `src/delivery.ts` | Delivery and retries |
| `src/web.ts` | Web API and static UI |
| `src/oidc.ts` | Single sign-on |
| `src/crypto.ts` | Encryption at rest and password hashing |
| `public/` | Web UI |
| `test/` | Vitest tests |

## Releases

Maintainers bump `version` in `package.json` and move the `Unreleased` changelog entries under the new version on
`main`. The release workflow then builds the multi-arch image, pushes it to GHCR and creates the GitHub release.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
