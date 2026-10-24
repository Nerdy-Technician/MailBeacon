# Security policy

## Supported versions

Only the latest release of MailBeacon gets security fixes.

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| < 0.3 | No |

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub security advisories](https://github.com/Nerdy-Technician/MailBeacon/security/advisories/new).

Include the version, how you run it, steps to reproduce and the impact you expect. You should get a reply within
a few days. Once a fix is released the advisory is published and you're credited unless you'd rather not be.

## How the project checks itself

Every push and pull request runs CodeQL, Trivy (dependencies, Dockerfile and the built image), gitleaks secret
scanning and a dependency review; results appear under the repository's Security tab. Release images are multi-arch,
come with an SBOM and signed build provenance (`gh attestation verify oci://ghcr.io/nerdy-technician/mailbeacon:<version> -R Nerdy-Technician/MailBeacon`),
and are scanned again after publishing. Dependencies are updated weekly.

## Scope

In scope: relaying mail that matches no route, bypassing login or SSO, reading stored secrets through the API or UI,
CSRF, and injection through email content into notifications or the UI.

Out of scope: exposing the SMTP port to the internet against the README's advice, and problems in the notification
services themselves.
