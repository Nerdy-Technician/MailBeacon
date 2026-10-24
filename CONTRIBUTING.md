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

Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
`deps:` ...). The title sets a label, and the labels decide the release-notes section and the next version in the
draft release that is kept up to date on every merge to `main`.

To release, a maintainer bumps `version` in `package.json`, moves the `Unreleased` changelog entries under the new
version, merges that to `main`, then edits and publishes the draft release with the tag `vX.Y.Z`. Publishing runs
the release workflow: it checks that the tag matches `package.json`, runs the tests, builds the linux/amd64 and
linux/arm64 image with an SBOM and provenance, pushes `X.Y.Z`, `X.Y` and `latest` to GHCR, scans the image and adds
the `docker pull` line and digest to the release notes.
