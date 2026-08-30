#!/usr/bin/env bash
#
# Fail the sandbox build if the mounted workspace itself carries credentials.
#
# devcontainer.json neutralises the *global/user* configs
# (GIT_CONFIG_GLOBAL=/dev/null, NPM_CONFIG_USERCONFIG=/dev/null), but the source
# tree is bind-mounted, so a repository-local `.npmrc` or `.git/config` lives
# inside the workspace and is still readable by a malicious build step
# (CWE-200). Those env vars do NOT disable project-local config, so reject it
# here before `pnpm install` runs anything.
set -euo pipefail

fail=0

# 1) Project .npmrc holding an auth token / password. Scan every tracked/untracked
#    .npmrc under the workspace (skip node_modules). Note: `always-auth=true` is
#    only a policy flag (no secret), so it is deliberately NOT matched.
while IFS= read -r -d '' f; do
  if grep -Eiq '(_authToken|_auth|_password|:_password=)' "$f"; then
    echo "::error:: credential-bearing npm config in the workspace: ${f#./}" >&2
    fail=1
  fi
done < <(find . -name '.npmrc' -not -path './node_modules/*' -print0 2>/dev/null)

# 2) Credentials in .git/config. Two channels:
#  a) Embedded in a remote URL. Match ANY userinfo before the host — both
#     user:password@ and a bare token@ (a GitHub PAT is often embedded as
#     https://ghp_xxx@host with no colon). Optional leading quote (git config
#     values may be quoted), case-insensitive (keys url/URL/Url).
#  b) An http.<url>.extraheader carrying an Authorization header — the other
#     common way credentials get baked into a repo config
#     (e.g. `extraheader = AUTHORIZATION: bearer <token>`).
if [ -f .git/config ]; then
  if grep -Eiq '^[[:space:]]*url[[:space:]]*=[[:space:]]*"?https?://[^/@[:space:]]+@' .git/config; then
    echo "::error:: credentials embedded in a .git/config remote URL" >&2
    fail=1
  fi
  if grep -Eiq '^[[:space:]]*extraheader[[:space:]]*=.*authorization[[:space:]]*:' .git/config; then
    echo "::error:: Authorization header embedded in .git/config (http.extraheader)" >&2
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "Refusing to build: remove the credential(s) from the workspace (or use a" >&2
  echo "clean worktree) and retry. The sandbox is designed to never see secrets." >&2
  exit 1
fi

echo "No workspace-local credentials detected — safe to build."
