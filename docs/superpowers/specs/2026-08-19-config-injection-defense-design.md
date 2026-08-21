# Design: org-wide config-injection defense

**Status:** approved, implementing.
**Repos:** all 7 (canonical in `storytime_be`).

## Problem

A self-propagating build-time worm appends an obfuscated RCE payload to auto-run
config files and executes it on every lint/build. Three incidents (storytime-fe
Mar 2026; storytime_superadmin + storytime_be Aug 2026). Each evaded the existing
`malware-scan.yml` because that gate **enumerated config filenames** (the worm
chose `eslint.config.mjs`, which wasn't listed) and keyed on a **single marker**
(the worm mutated it). The gate also ran only in CI post-hoc, and each repo
carried a **drifting copy** of the scanner (superadmin's arrived *via* the
infected PR #53).

## Root cause

Enumerate-and-match is a losing game: any new filename/marker variant slips
through. The fix must be structural (detect the injection shape, not a name or
string), enforced before merge, and drift-proof across repos.

## Approach (locked)

Robust, all layers; branch protection configured by the owner; one reusable
workflow as source of truth.

### 1. Structural detector — `scripts/scan-injection.sh`
Scans `git ls-files` (tracked only → node_modules/build excluded). Flags on:
- overlong line (>500 chars) in **executable** JS/TS (not inert `.json` data);
- require-hijack / `String.fromCharCode` / dense `_0x…` obfuscation (all files);
- known marker families (`global['!']`, `A8-2503`) as a fast-path.
Modes: `--all` (CI), `--staged` (pre-commit). False positives cleared via a
reviewed `sha256  path` allowlist (`.ci-scan-allow.txt`).

### 2. Three enforcement layers
- **Pre-commit hook** (`.githooks/pre-commit`, enabled via `core.hooksPath`) —
  local early warning, bypassable, not the guarantee.
- **CI required check** — reusable `malware-scan.yml`; merge-blocking once the
  owner requires the `config-injection + disguised-font scan` check in branch
  protection.
- **Weekly deep scan** — existing `shai-hulud-detect` job, unchanged.

### 3. One source, no drift
Logic lives only in `scan-injection.sh`. Every repo vendors an identical copy;
the reusable workflow pins `SCAN_SCRIPT_SHA256` and fails closed on missing /
stale / tampered copies. Callers are 5-line workflows pinned to a reviewed
`storytime_be` SHA. Trade-off accepted: updating logic means re-vendoring + a
one-line hash bump per repo — drift-proofness beats fix-once convenience for
security-critical code, and needs no cross-repo tokens.

## Testing (done during build)
- Clean `storytime_be` tree → exit 0 (no FPs after excluding inert JSON data).
- Known infected `eslint.config.mjs` (from `1fc63b1`) → hard-fail on overlong
  line + require-hijack + marker, in both `--all` and `--staged`.
- YAML + `bash -n` valid.

## Parallel tracks (separate deliverables)
- **Reservoir hunt** — where re-infection originates (lifecycle scripts,
  lockfiles, node_modules, dev-machine persistence). Investigation, read-only.
- **Sandboxed builds** — isolate build-time execution from real credentials.
  Separate infra spec.

## Non-goals
- No cross-repo PAT/org-secret plumbing (drift guard avoids it).
- No change to application code.
- Secret rotation remains an owner action from the incident.
