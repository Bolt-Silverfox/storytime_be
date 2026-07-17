# Blue-Green Deployment (Storytime API)

Zero-downtime deploys where the **new build is proven healthy before the old one
is taken down**. If the new release fails its health checks, traffic never moves
and the old release keeps serving — a safe automatic rollback.

## Model

- Two "colors" of the app run on two ports: **blue = 3500**, **green = 3501**.
- Only **one color serves traffic at a time**; the other is stopped except during
  a deploy window.
- **nginx** proxies to whichever color is active via a single, swappable
  `upstream` file.
- PM2 runs each color in cluster mode.

```
            ┌───────── nginx ─────────┐
client ───▶ │ upstream storytime_backend │ ──▶ 127.0.0.1:<active-port>
            └────────────────────────────┘
                         ▲ swap upstream file + reload
   blue  (PM2 cluster) :3500   ◀── active
   green (PM2 cluster) :3501   ◀── new build spins up here, health-gated
```

## One-time server setup

1. **nginx** — proxy to the swappable upstream and include the active-color file:

   ```nginx
   # /etc/nginx/conf.d/storytime-active-upstream.conf  (managed by the deploy script)
   upstream storytime_backend { server 127.0.0.1:3500; }

   # /etc/nginx/sites-enabled/storytime.conf
   server {
     listen 80;
     server_name api.storytime.example;   # your domain
     location / {
       proxy_pass http://storytime_backend;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 60s;
     }
   }
   ```

2. Ensure the deploy user can `nginx -t`, reload nginx, and write
   `/etc/nginx/conf.d/storytime-active-upstream.conf` and
   `/var/run/storytime-active-color` (adjust paths via env vars if needed).

## Deploying

```bash
cd storytime_be
git pull
pnpm install --frozen-lockfile
pnpm db:migrate:deploy      # migrations are backward-compatible; run before the swap
pnpm build
scripts/deploy-blue-green.sh production
```

What the script does:
1. Reads the active color from `/var/run/storytime-active-color` (defaults to blue).
2. Starts the **inactive** color with the fresh `dist/` on its port (PM2 cluster).
3. **Health-gates** it: waits up to `HEALTH_TIMEOUT` (120s) for
   `GET /api/v1/health/ready`, then requires `GET /api/v1/health/full` (DB, Redis,
   SMTP, queues, etc.) to pass.
4. On success: rewrites the nginx upstream to the new port, `nginx -t`, reloads,
   records the new active color.
5. Drains `DRAIN_SECONDS` (10s), then stops the old color.
6. On **any** health failure: tears the new color down, leaves the old color
   serving, exits non-zero (nothing switched).

### Tunables (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `BLUE_PORT` / `GREEN_PORT` | 3500 / 3501 | color ports |
| `PM2_INSTANCES` | `max` | cluster workers per color |
| `HEALTH_TIMEOUT` | 120 | seconds to wait for the new color to become ready |
| `DRAIN_SECONDS` | 10 | grace period before stopping the old color |
| `NGINX_UPSTREAM_FILE` | `/etc/nginx/conf.d/storytime-active-upstream.conf` | swappable upstream |
| `STATE_FILE` | `/var/run/storytime-active-color` | active-color marker |

## Migrations & blue-green

During the overlap window both colors run against the **same database**, so
migrations must be **backward-compatible** (additive): the old color must keep
working against the new schema. Run `db:migrate:deploy` **before** the swap.
Avoid destructive changes (dropping/renaming columns) in the same release that
depends on them — split into expand → migrate data → contract across two deploys.

## CI/CD hook

Replace the current PM2 restart step in the deploy workflow with:

```yaml
- name: Blue-green deploy
  run: |
    pnpm install --frozen-lockfile
    pnpm db:migrate:deploy
    pnpm build
    scripts/deploy-blue-green.sh production
```

The job **fails** (and pages) if the new color never goes healthy, with the old
release still live — so a bad build cannot take the site down.

## Rollback

Because the previous color is only stopped after the swap succeeds, an immediate
rollback is just another run (it flips back to the other color). To force it:

```bash
STATE_FILE=/var/run/storytime-active-color scripts/deploy-blue-green.sh production
# (or re-point the nginx upstream file to the previous port and reload)
```
