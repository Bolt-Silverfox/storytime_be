#!/usr/bin/env bash
#
# Version consistency, ported from Bolt-Silverfox/storytime-ci
# .github/workflows/version-check.yml (reusable "version consistency" job) for
# Woodpecker. Needs git history, the PR's target branch and tags: the workflow
# sets clone.git.settings (tags, fetch_target_branch) for that. Uses node, not
# jq, because the node image has no jq.
#
#   1. package.json exists and its "version" is valid SemVer 2.0.0.
#   2. If app.json exists, expo.version equals package.json's version.
#   3. Pull requests only: if the PR changes the declared version relative to
#      the target branch, the release tag (v<version>) must not already exist.
#
# Differences from the GitHub job: a package.json that is a symlink at the base
# commit is not followed (its content then reads as "no version", so the tag
# check runs, which fails closed); the base is the target branch tip, because
# Woodpecker checks out the PR head, not a merge commit.
set -euo pipefail

TAG_PREFIX="${TAG_PREFIX:-v}"
EVENT="${CI_PIPELINE_EVENT:-}"
TARGET="${CI_COMMIT_TARGET_BRANCH:-}"

if [ ! -f package.json ]; then
  echo "No package.json at the repo root - nothing to check."
  exit 0
fi

# 1. declared version is valid SemVer 2.0.0 (exactly one JSON document).
PKG=$(node -e '
const fs = require("fs");
const re = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-((0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(\+([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$/;
let v;
try { v = JSON.parse(fs.readFileSync("package.json", "utf8")).version; } catch (e) { v = undefined; }
if (typeof v !== "string" || !re.test(v)) {
  console.error("package.json: version is missing, malformed, or not valid SemVer 2.0.0 (saw: " + JSON.stringify(v === undefined ? "<missing>" : v).slice(0, 60) + ").");
  process.exit(1);
}
process.stdout.write(v);
')
echo "package.json version: $PKG"

# 2. app.json (Expo) must agree with package.json.
if [ -f app.json ]; then
  node -e '
const fs = require("fs");
let a;
try { a = JSON.parse(fs.readFileSync("app.json", "utf8")); } catch (e) {
  console.error("app.json is not a single parseable JSON document."); process.exit(1);
}
const p = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const v = a && a.expo && a.expo.version;
if (v == null) { console.log("app.json has no expo.version - nothing to compare."); }
else if (v === p) { console.log("app.json and package.json agree on " + p + "."); }
else { console.error("Version drift: app.json expo.version is " + JSON.stringify(v).slice(0, 60) + " but package.json is " + JSON.stringify(p) + ". Set both to the same value."); process.exit(1); }
'
else
  echo "No app.json - drift check not applicable."
fi

# 3. tag-reuse check, pull requests only.
if [ "$EVENT" != "pull_request" ]; then
  echo "Event is '$EVENT', not pull_request - skipping the tag check."
  exit 0
fi

BASE=""
for ref in "refs/remotes/origin/$TARGET" "origin/$TARGET" "refs/heads/$TARGET"; do
  if [ -n "$TARGET" ] && git rev-parse -q --verify "${ref}^{commit}" >/dev/null 2>&1; then
    BASE=$(git rev-parse "${ref}^{commit}")
    break
  fi
done

if [ -n "$BASE" ]; then
  echo "Comparing against the target branch '$TARGET' at $BASE."
  BASE_DECL=$(git show "$BASE:package.json" 2>/dev/null | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let v = null; try { const j = JSON.parse(s); v = j.version === undefined ? null : j.version; } catch (e) {}
  process.stdout.write(JSON.stringify(v));
});') || BASE_DECL='null'
  if [ "$BASE_DECL" = "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$PKG")" ]; then
    echo "package.json already declared $PKG on the target branch - this PR does not move the version, skipping tag check."
    exit 0
  fi
  echo "package.json version differs from the target branch; this PR sets it to $PKG."
else
  echo "ERROR: could not resolve the target branch '$TARGET', so the base version is unknown." >&2
  echo "The clone step should have fetched it (clone.git.settings.fetch_target_branch)." >&2
  echo "Failing closed rather than assuming this PR changes nothing." >&2
  exit 1
fi

TAG="${TAG_PREFIX}${PKG}"
if ! git check-ref-format "refs/tags/$TAG"; then
  echo "ERROR: tag_prefix produces an invalid git tag name; fix TAG_PREFIX." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  EXISTING=$(git rev-list -n 1 "refs/tags/$TAG")
  echo "ERROR: This PR sets the version to $PKG, but tag $TAG already exists (at ${EXISTING:0:8}). The release workflow skips when the tag is present, so merging this would leave the release untagged. Bump to an unreleased version instead." >&2
  exit 1
fi
echo "Version $PKG is not yet tagged as $TAG - good."
