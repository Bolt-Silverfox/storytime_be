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
#    .npmrc under the workspace (skip node_modules).
while IFS= read -r -d '' f; do
  if grep -Eiq '(_authToken|_auth|_password|:_password=|^[[:space:]]*always-auth[[:space:]]*=[[:space:]]*true)' "$f"; then
    echo "::error:: credential-bearing npm config in the workspace: ${f#./}" >&2
    fail=1
  fi
done < <(find . -name '.npmrc' -not -path './node_modules/*' -print0 2>/dev/null)

# 2) Credentials embedded in a git remote URL. Match ANY userinfo before the
#    host — both user:password@ and a bare token@ (a GitHub PAT is often
#    embedded as https://ghp_xxx@host with no colon). Allow an optional leading
#    quote (git config values may be quoted) and scan case-insensitively (git
#    config keys url/URL/Url are case-insensitive), so none of those forms can
#    slip a credential past the check.
if [ -f .git/config ] && \
   grep -Eiq '^[[:space:]]*url[[:space:]]*=[[:space:]]*"?https?://[^/@[:space:]]+@' .git/config; then
  echo "::error:: credentials embedded in a .git/config remote URL" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Refusing to build: remove the credential(s) from the workspace (or use a" >&2
  echo "clean worktree) and retry. The sandbox is designed to never see secrets." >&2
  exit 1
fi

echo "No workspace-local credentials detected — safe to build."
