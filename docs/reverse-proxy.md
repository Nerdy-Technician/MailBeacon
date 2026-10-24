# Running MailBeacon behind a reverse proxy with SSO

Only the **web UI and API (port 8080)** go through the proxy. SMTP (2525) is plain TCP and should stay on your LAN,
published directly or reachable only on a Docker network.

## Checklist

1. Terminate HTTPS at the proxy and forward to `http://mailbeacon:8080`.
2. Set `MAILBEACON_PUBLIC_URL` to the public HTTPS address, e.g. `https://mailbeacon.example.com`. MailBeacon builds the
   OIDC redirect URI from it (`<public url>/api/oidc/callback`); without it the URI is guessed from the `Host` header.
3. Pass the `Host` header through unchanged (Traefik and Caddy do this by default; nginx needs `proxy_set_header Host $host`).
4. Don't publish port 8080 on the host any more once the proxy works: remove `- "8080:8080"` and put both containers on the same network.
5. Use MailBeacon's **built-in OIDC login** (Settings → Single sign-on). If you also put forward-auth (Authentik outpost,
   Authelia, oauth2-proxy) in front, **exclude** these paths or SSO and monitoring break:
   - `/api/oidc/callback` and `/api/oidc/login`: the OIDC round trip
   - `/api/health`: the container health check and uptime monitors
   - `/metrics`: Prometheus (protect it with `MAILBEACON_METRICS_TOKEN` instead)
6. After one successful SSO login you can turn off password login (Settings → Disable password login).
   `MAILBEACON_FORCE_LOCAL_LOGIN=1` turns it back on if the identity provider is down.

## Traefik

```yaml
services:
  mailbeacon:
    image: ghcr.io/nerdy-technician/mailbeacon:latest
    restart: unless-stopped
    env_file: .env                     # MAILBEACON_SECRET, MAILBEACON_PUBLIC_URL, MAILBEACON_METRICS_TOKEN …
    ports:
      - "192.168.1.10:2525:2525"       # SMTP on the LAN address only
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

Optional forward-auth with the exclusions above (Authentik example):

```yaml
      - traefik.http.routers.mailbeacon.middlewares=authentik@docker
      - traefik.http.routers.mailbeacon-open.rule=Host(`mailbeacon.example.com`) && (PathPrefix(`/api/oidc/`) || Path(`/api/health`) || Path(`/metrics`))
      - traefik.http.routers.mailbeacon-open.entrypoints=websecure
      - traefik.http.routers.mailbeacon-open.tls.certresolver=letsencrypt
      - traefik.http.routers.mailbeacon-open.priority=100
```

## Caddy

```caddyfile
mailbeacon.example.com {
    reverse_proxy mailbeacon:8080
}
```

With forward-auth (Authentik outpost):

```caddyfile
mailbeacon.example.com {
    @open path /api/oidc/* /api/health /metrics
    handle @open {
        reverse_proxy mailbeacon:8080
    }
    handle {
        forward_auth authentik-server:9000 {
            uri /outpost.goauthentik.io/auth/caddy
            copy_headers X-Authentik-Username X-Authentik-Email
        }
        reverse_proxy mailbeacon:8080
    }
}
```

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name mailbeacon.example.com;
    # ssl_certificate …; ssl_certificate_key …;

    location / {
        proxy_pass http://mailbeacon:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Cloudflare Tunnel

Point the tunnel's public hostname at `http://mailbeacon:8080`, set `MAILBEACON_PUBLIC_URL` to the tunnel hostname and,
if you use Cloudflare Access, add a bypass policy for `/api/oidc/*`, `/api/health` and `/metrics`. Never expose SMTP through the tunnel.

## Prometheus

```yaml
scrape_configs:
  - job_name: mailbeacon
    metrics_path: /metrics
    authorization:
      credentials_file: /etc/prometheus/mailbeacon-token   # same value as MAILBEACON_METRICS_TOKEN
    static_configs:
      - targets: ["mailbeacon:8080"]
```

Useful alerts: `increase(mailbeacon_dead_letters_total[1h]) > 0`, `mailbeacon_selftest_ok == 0`,
`increase(mailbeacon_smtp_rejected_total{reason="rate_limited"}[10m]) > 0`.
