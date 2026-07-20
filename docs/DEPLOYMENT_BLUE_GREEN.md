# Blue-Green Deployment Runbook (dev)

How the **v1.3.0 "blue"** candidate is validated alongside the current **"green"**
dev stack, across all three repos. This reflects what is actually deployed.

## Model

**Green = current stable** (`develop-v1.2.0` backend / `main` frontend / `dev-v1.2.0`
mobile). **Blue = candidate** (`develop-v1.3.0` / `develop-v1.3.0` / `dev-v1.3.0`).
Blue runs **on the same host** as green, on separate ports / directories / DB /
Redis index, behind its own subdomains — so the whole blue stack can be validated
end-to-end before promoting. This is a *separate-environment* model (not an
in-place nginx-upstream flip; that variant is documented at the bottom).

| | Green | Blue |
|---|---|---|
| Backend URL | `https://dev.api.storytimeapp.me` | `https://blue.dev.api.storytimeapp.me` |
| Frontend URL | `https://dev.storytimeapp.me` | `https://blue.dev.storytimeapp.me` |
| Backend port | `:3500` | `:3601` |
| Frontend port | `:3000` | `:3010` |
| Backend PM2 | `storytime-api-development` | `storytime-api-blue` (1 instance) |
| Frontend PM2 | `storytime-fe-dev` | `storytime-fe-blue` |
| DB (shared RDS) | `storytime_dev` | `storytime_db_blue` |
| Redis (local, shared) | default DB | logical DB **`/3`** |
| Server dir | `/home/ubuntu/storytime/development/` | `/home/ubuntu/storytime/blue/` |

**Shared-resource caveat (important):** the RDS instance (`max_connections≈401`)
and the local Redis are shared with green *and other apps* on the box. Blue
therefore runs **1 PM2 instance with `connection_limit=10`** and Redis **`/3`** so
it can't starve green. Don't raise these without first checking
`SELECT count(*) FROM pg_stat_activity;`.

## Backend blue — how it's deployed

`.github/workflows/blue-deploy.yml` (manual-trigger). It **derives blue's `.env`
from green's `ENV_FILE` secret**, overriding only `PORT=3601`,
`DATABASE_URL`→`storytime_db_blue`, `REDIS_URL`→`/3`, `connection_limit=10`; then
creates `storytime_db_blue` if missing, migrates, and (re)starts
`storytime-api-blue` on `:3601` (`pnpm deploy:blue`).

> **`gh workflow run blue-deploy.yml` 404s** — `workflow_dispatch` is only
> API-triggerable when the workflow file exists on the **default branch**, and
> blue-deploy.yml lives only on `develop-v1.3.0`. Trigger it from the **Actions
> UI** (Run workflow → `develop-v1.3.0`), or deploy manually (below). Uncomment
> the `push:` trigger in the workflow to auto-deploy on every push once blue is
> settled.

**Manual deploy** (what was used to bring blue up the first time):
```bash
ssh storytime          # host alias in ~/.ssh/config; git-over-SSH is broken, use gh for git
# 1. create storytime_db_blue on RDS (idempotent; connect to the 'postgres' maint db)
# 2. rsync develop-v1.3.0 -> /home/ubuntu/storytime/blue/storytime-api  (EXCLUDE .env)
# 3. cp green .env, override PORT/DATABASE_URL/REDIS_URL/connection_limit (see workflow sed)
# 4. pnpm install && pnpm db:generate && pnpm build && pnpm db:migrate:deploy
# 5. pnpm start:pm2:blue     # PM2 storytime-api-blue on :3601
```

## Frontend blue — how it's deployed

`storytime-fe/.github/workflows/blue-deploy.yml` (manual-trigger): builds with
`NEXT_PUBLIC_API_URL=https://blue.dev.api.storytimeapp.me` **baked at build time**
(so blue FE talks to blue API), ships the standalone bundle, and starts
`storytime-fe-blue` on `:3010`.

**Gotchas that will bite you (all fixed on `develop-v1.3.0`; needed on any redeploy):**
- `next.config.ts` must set **`output: 'standalone'`** or there's no
  `.next/standalone/server.js` for PM2 to run. *(This was the actual reason blue
  FE "wasn't up".)*
- **pnpm 11 build-script gate:** `package.json` needs
  `pnpm.onlyBuiltDependencies: ["sharp","@tailwindcss/oxide","@biomejs/biome"]`;
  install uses `--no-frozen-lockfile` and the build sets
  `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`, else install/build aborts with
  `ERR_PNPM_IGNORED_BUILDS` / the pre-run deps check.
- After build, copy `public/` and `.next/static` into `.next/standalone/` before
  rsync (the workflow's "Assemble standalone bundle" step).

## nginx + TLS

Per-color server blocks live in each repo under `deploy/nginx/`:
```bash
# backend -> :3601 ,  frontend -> :3010
sudo cp deploy/nginx/blue.dev.api.storytimeapp.me.conf /etc/nginx/sites-available/   # (backend repo)
sudo cp deploy/nginx/blue.dev.storytimeapp.me.conf     /etc/nginx/sites-available/   # (frontend repo)
sudo ln -s /etc/nginx/sites-available/<file> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -n --redirect -d blue.dev.api.storytimeapp.me
sudo certbot --nginx -n --redirect -d blue.dev.storytimeapp.me
```
The backend block sets `proxy_buffering off` (SSE endpoints) and
`client_max_body_size 25m`. DNS: point both `blue.dev` and `blue.dev.api` A
records at the same host as green before running certbot.

## Mobile blue (side-by-side variant)

A phone holds one binary per bundle ID, so blue is a **separate installable app**.
The `blue` EAS profile (`eas.json`) sets `APP_VARIANT=blue` +
`EXPO_PUBLIC_API_URL=https://blue.dev.api.storytimeapp.me/api/v1`, and
`app.config.js` gives it a distinct name (**"Storytime Blue"**) and bundle id
(`net.emerj.storytime.blue`). Build: `eas build --profile blue`. It installs
alongside green. Mobile branch is `dev-v1.3.0` (mobile uses `dev-vX.Y.Z`, not
`develop-`).

**OAuth must be registered for the `.blue` identifier** — each provider keys off
the bundle id / package, so green's clients won't authenticate blue:
- **Google:** new iOS OAuth client (bundle `net.emerj.storytime.blue`) →
  `EXPO_PUBLIC_IOS_CLIENT_ID`; new Android OAuth client (package
  `net.emerj.storytime.blue` + the blue signing SHA-1 from `eas credentials`) →
  `EXPO_PUBLIC_ANDROID_CLIENT_ID`. The Web client ID can stay shared.
- **Firebase:** add iOS + Android apps for `net.emerj.storytime.blue`; ship the
  new `GoogleService-Info.plist` / `google-services.json` as EAS secret files
  (`app.config.js` reads `GOOGLE_SERVICE_INFO_PLIST` / `GOOGLE_SERVICES_JSON`).
- **Apple:** register App ID `net.emerj.storytime.blue` with Sign in with Apple.
- **Blue backend must trust the blue IDs:** its `GOOGLE_CLIENT_ID` /
  `APPLE_CLIENT_ID` / `APPLE_IAP_BUNDLE_ID` must include the blue client IDs /
  bundle (the Apple ASSN v2 verifier rejects bundle-id mismatches).

*Cheaper alternative:* keep green's bundle ID for blue (no new OAuth), but then
blue **overwrites** green on a device — switch by reinstalling or use a 2nd device.

## Promote blue → green

**`develop-v1.3.0` *becomes* the new stable line — there is NO merge-down into
`develop-v1.2.0`.** Once `blue.dev.*` is validated end-to-end:
1. Point the **green** deploy at `develop-v1.3.0` (backend), and the matching
   FE/mobile blue branches, then re-run the green deploy so green now serves
   v1.3.0. `develop-v1.2.0` (and the old FE/mobile v1.2.0 branches) are retired,
   not updated.
2. Green keeps its own data — the green deploy continues to run against
   `storytime_dev`; only the code/branch it deploys from changes.
3. Blue (`:3601` / `:3010` / `storytime_db_blue`) is then free for the next
   candidate. `storytime_db_blue` holds throwaway validation data.

## Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://blue.dev.api.storytimeapp.me/api/v1/health
curl -s -o /dev/null -w '%{http_code}\n' https://blue.dev.storytimeapp.me/api/health
# on the box:
ssh storytime 'source ~/.nvm/nvm.sh; pm2 describe storytime-api-blue | grep -i status; \
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3601/api/v1/health'
```

---

## Appendix: in-place-flip alternative

`scripts/deploy-blue-green.sh` implements a single-domain **zero-downtime cutover**
— two colors behind one nginx `upstream`, the new build health-gated on its port,
then the upstream flipped and the old color drained. This is *not* what the dev
blue stack uses (that runs blue on its own subdomains, above), but it's kept for a
true in-place production cutover.

- Ports: `BLUE_PORT=3500` / `GREEN_PORT=3501`; only one color serves at a time.
- Flow: start inactive color with fresh `dist/` → health-gate
  `GET /api/v1/health/ready` then `/api/v1/health/full` → rewrite
  `NGINX_UPSTREAM_FILE`, `nginx -t`, reload → drain `DRAIN_SECONDS` → stop old
  color. Any health failure tears the new color down and leaves the old one
  serving (automatic rollback).
- Tunables (env): `BLUE_PORT`/`GREEN_PORT`, `PM2_INSTANCES` (`max`),
  `HEALTH_TIMEOUT` (120s), `DRAIN_SECONDS` (10s), `NGINX_UPSTREAM_FILE`,
  `STATE_FILE` (`/var/run/storytime-active-color`).
- Migrations run against the shared DB during the overlap, so keep them
  **backward-compatible** (expand → migrate data → contract across two releases;
  never drop/rename a column in the same release that still depends on it).
