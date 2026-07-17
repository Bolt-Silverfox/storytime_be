#!/usr/bin/env bash
#
# Blue-green deploy for the Storytime API (PM2 + nginx).
#
# Brings up the new build on the INACTIVE color, HEALTH-GATES it, flips the
# nginx upstream to it, then stops the old color. If the new color fails its
# health checks it is torn down and the old color keeps serving (safe rollback,
# zero downtime) — i.e. green is never taken down until blue is proven healthy.
#
# Assumes: `pnpm build` already produced dist/, PM2 + nginx installed, and nginx
# includes $NGINX_UPSTREAM_FILE (see docs/DEPLOYMENT_BLUE_GREEN.md).
#
# Usage: scripts/deploy-blue-green.sh [production|staging|development]
set -euo pipefail

ENV="${1:-production}"
APP="storytime-api-${ENV}"

BLUE_PORT="${BLUE_PORT:-3500}"
GREEN_PORT="${GREEN_PORT:-3501}"
INSTANCES="${PM2_INSTANCES:-max}"

# Health endpoints (global prefix is /api/v1). /ready = liveness, /full = deep.
HEALTH_READY_PATH="${HEALTH_READY_PATH:-/api/v1/health/ready}"
HEALTH_FULL_PATH="${HEALTH_FULL_PATH:-/api/v1/health/full}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"   # seconds to wait for the new color
DRAIN_SECONDS="${DRAIN_SECONDS:-10}"      # let in-flight requests finish before stopping old

NGINX_UPSTREAM_FILE="${NGINX_UPSTREAM_FILE:-/etc/nginx/conf.d/storytime-active-upstream.conf}"
STATE_FILE="${STATE_FILE:-/var/run/storytime-active-color}"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; }

# --- 1. Figure out which color is currently live -----------------------------
active="$(cat "$STATE_FILE" 2>/dev/null || echo blue)"
if [ "$active" = "blue" ]; then
  new=green; new_port="$GREEN_PORT"; old=blue
else
  new=blue;  new_port="$BLUE_PORT";  old=green
fi
log "Active color = $active. Deploying '$new' on port $new_port (env=$ENV)."

# --- 2. Start the new color with the fresh build -----------------------------
pm2 delete "${APP}-${new}" >/dev/null 2>&1 || true
PORT="$new_port" NODE_ENV="$ENV" pm2 start dist/main.js \
  --name "${APP}-${new}" --instances "$INSTANCES" --exec-mode cluster \
  --max-memory-restart 1G --update-env

# --- 3. Health-gate the new color (liveness, then deep check) -----------------
log "Health-gating http://127.0.0.1:${new_port}${HEALTH_READY_PATH} (timeout ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
until curl -fsS "http://127.0.0.1:${new_port}${HEALTH_READY_PATH}" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    err "New color '$new' did not become ready in ${HEALTH_TIMEOUT}s — rolling back."
    pm2 logs "${APP}-${new}" --lines 40 --nostream || true
    pm2 delete "${APP}-${new}" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 3
done

if ! curl -fsS "http://127.0.0.1:${new_port}${HEALTH_FULL_PATH}" >/dev/null 2>&1; then
  err "New color '$new' failed the deep health check (${HEALTH_FULL_PATH}) — rolling back."
  pm2 delete "${APP}-${new}" >/dev/null 2>&1 || true
  exit 1
fi
log "New color '$new' is healthy."

# --- 4. Flip nginx to the new color ------------------------------------------
log "Switching nginx upstream -> 127.0.0.1:${new_port}"
printf 'upstream storytime_backend { server 127.0.0.1:%s max_fails=3 fail_timeout=10s; }\n' "$new_port" \
  > "$NGINX_UPSTREAM_FILE"
if ! nginx -t; then
  err "nginx config test failed — reverting upstream, keeping '$old' live."
  printf 'upstream storytime_backend { server 127.0.0.1:%s; }\n' \
    "$([ "$new" = blue ] && echo "$GREEN_PORT" || echo "$BLUE_PORT")" > "$NGINX_UPSTREAM_FILE"
  pm2 delete "${APP}-${new}" >/dev/null 2>&1 || true
  exit 1
fi
nginx -s reload 2>/dev/null || systemctl reload nginx
echo "$new" > "$STATE_FILE"
log "Traffic now on '$new'."

# --- 5. Drain and stop the old color -----------------------------------------
log "Draining ${DRAIN_SECONDS}s before stopping '$old'..."
sleep "$DRAIN_SECONDS"
pm2 delete "${APP}-${old}" >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true
log "Done. '$new' live on :${new_port}; '$old' stopped."
