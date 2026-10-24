# Authentik setup for MailBeacon

MailBeacon is a standard OpenID Connect client (authorisation code flow, PKCE, state and nonce, RS256 ID tokens).

## 1. Provider

**Applications → Providers → Create → OAuth2/OpenID Provider**

| Setting | Value |
|---|---|
| Name | `MailBeacon` |
| Authorization flow | `default-provider-authorization-implicit-consent` |
| Client type | **Confidential** |
| Redirect URIs | Strict: `<public URL>/api/oidc/callback`, one line per instance (e.g. `https://mailbeacon.example.com/api/oidc/callback`) |
| Signing key | any certificate, e.g. `authentik Self-signed Certificate` (RS256) |
| Scopes | `openid`, `email`, `profile` (the default `profile` mapping includes `groups`) |
| Subject mode | default (hashed user ID) is fine; MailBeacon links accounts by `sub` |

Copy the **Client ID** and **Client Secret**.

## 2. Application

**Applications → Applications → Create**: name `MailBeacon`, slug `mailbeacon`, provider `MailBeacon`.
The issuer is then `https://<authentik>/application/o/mailbeacon/`.

## 3. Groups

Create the groups you want to map, for example `mailbeacon-admins`, `mailbeacon-editors` and `mailbeacon-viewers`, and
add users. Optionally bind these groups to the application so nobody else can launch it.

## 4. MailBeacon

Settings → Auth and OIDC, or environment variables:

```yaml
MAILBEACON_PUBLIC_URL: https://mailbeacon.example.com
MAILBEACON_OIDC_ISSUER: https://auth.example.com/application/o/mailbeacon/
MAILBEACON_OIDC_CLIENT_ID: <client id>
MAILBEACON_OIDC_CLIENT_SECRET: <client secret>
MAILBEACON_OIDC_SCOPES: openid profile email
MAILBEACON_OIDC_GROUPS_CLAIM: groups
MAILBEACON_OIDC_ADMIN_GROUPS: mailbeacon-admins
MAILBEACON_OIDC_EDITOR_GROUPS: mailbeacon-editors
MAILBEACON_OIDC_VIEWER_GROUPS: mailbeacon-viewers
MAILBEACON_OIDC_DEFAULT_ROLE: none
```

Optional claims: `name` / `preferred_username` (display name), `email`, `picture` (avatar; Authentik sends it only if
you add a scope mapping for it).

## 5. Test

Sign out and press **Sign in with single sign-on**. Once that works you can tick **Disable local passwords**. If SSO breaks, start
the container with `MAILBEACON_FORCE_LOCAL_LOGIN=1`.
