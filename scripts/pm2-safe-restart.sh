#!/usr/bin/env bash
#
# Reload a pm2 app defined in ecosystem.config.js with zero downtime, but
# recreate it when the running process points at a script path that no longer
# exists on disk.
#
# Why: `pm2 reload` / `pm2 startOrReload` gracefully reload the *code* at a
# process's existing exec path, but they do NOT adopt a changed `script:` path
# from ecosystem.config.js. When the build layout changes (e.g. the nested
# dist/src/main.js -> flat dist/main.js migration during the 1.3.0 line), a
# plain reload keeps pointing at the vanished old path and the app crash-loops
# — this took production down (502) on 2026-08-19.
#
# This wrapper detects that exact situation (running exec path is gone),
# deletes the stale process so a fresh start adopts the correct path, and
# otherwise keeps the normal zero-downtime reload. It also persists the pm2
# process list (`pm2 save`) so a host reboot restores the corrected definition.
#
# Usage: pm2-safe-restart.sh <app-name>
# Run from the repo root (the app cwd), as the deploy scripts do.

set -euo pipefail

APP="${1:?usage: pm2-safe-restart.sh <app-name>}"

# The running process's current exec path, if the app exists in pm2. Parsed
# from `pm2 jlist` with node (always present via nvm; avoids a jq dependency).
cur="$(npx pm2 jlist 2>/dev/null | node -e '
  let s = "";
  process.stdin.on("data", d => (s += d)).on("end", () => {
    try {
      const app = (JSON.parse(s) || []).find(p => p.name === process.argv[1]);
      process.stdout.write(app && app.pm2_env ? String(app.pm2_env.pm_exec_path || "") : "");
    } catch (_) {
      process.stdout.write("");
    }
  });
' "$APP" 2>/dev/null || true)"

if [ -n "$cur" ] && [ ! -f "$cur" ]; then
  echo "pm2: $APP is running from a script path that no longer exists:"
  echo "  $cur"
  echo "  A plain reload would keep this stale path and crash-loop; recreating."
  npx pm2 delete "$APP" || true
fi

# startOrReload = zero-downtime reload when the app exists with a valid path,
# fresh start (reading the correct script: from ecosystem.config.js) otherwise.
npx pm2 startOrReload ecosystem.config.js --only "$APP" --update-env

# Persist so a reboot restores this (corrected) definition rather than a stale
# dump — the host has no pm2 systemd resurrection safety net.
npx pm2 save
