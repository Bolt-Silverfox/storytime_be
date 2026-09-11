# Config-injection defense (anti-worm gate)

Layered defense against the self-propagating build-time worm that appends an
obfuscated RCE payload to auto-run config files (postcss/eslint/jest/next/…) and
executes it on every lint/build. It has hit this org three times, each time
evading the previous gate by picking an **unlisted config filename** and
**mutating its marker**. This gate is therefore **filename-agnostic and
marker-agnostic** — it detects the injection _structurally_.

## Components

| Piece                                | Where                                                                                        | Role                                                                                                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/scan-injection.sh`          | `Bolt-Silverfox/storytime-ci` only; fetched at the pinned `SCANNER_REF`                       | The detector. Scans git-tracked files. Consumers vendor no copy — the reusable workflow checks it out and runs it. A local copy may exist for the pre-commit hook only, and is allowed to drift.                                              |
| `.githooks/pre-commit`               | every repo                                                                                   | Local early-warning (scans staged files). Bypassable.                                                                                                                                                                                        |
| `.github/workflows/malware-scan.yml` | `Bolt-Silverfox/storytime-ci` (canonical, reusable; dedicated repo, history never rewritten) | CI gate + weekly deep scan. Every repo, including `storytime_be`, calls it via a thin caller.                                                                                                                                                |
| thin caller workflow                 | every repo (`storytime_be` included)                                                         | Invokes the reusable workflow pinned to a full 40-char `storytime-ci` commit SHA (a `# malware-scan-vN` comment may annotate it, but the pin itself must never be a bare tag); the weekly deep scan runs in each caller on its own schedule. |
| branch protection                    | GitHub settings (owner)                                                                      | Makes the CI scan **required** → merge-blocking.                                                                                                                                                                                             |

## How detection works (no filename list, no single marker)

`scan-injection.sh` walks `git ls-files` (so `node_modules`/build output are
excluded automatically) and flags a file on **any** of:

1. **Overlong line** (>500 chars) in an **executable** JS/TS module — the
   obfuscated blob is always one absurd line. Not applied to `.json`/data, which
   is legitimately minified and inert.
2. **Require-hijack / obfuscation hallmarks** — `global[...]=require`,
   `global.X=require`, `String.fromCharCode(`, dense `_0x…` hex identifiers.
   Grepped in **all** scanned files (code + json + vue/svelte).
3. **Known marker families** — `global['!']`, `A8-2503` (cheap fast-path).

False positives (a genuinely minified/vendored _tracked_ file) are cleared by
adding its `sha256␠␠path` to `.ci-scan-allow.txt` **after review**.

## Enable the local hook (one-time, per clone)

```bash
git config core.hooksPath .githooks
```

Bypassable with `git commit --no-verify` — it is convenience, not the guarantee.
The **CI required check is the real gate**.

## Single source, no drift

The logic lives only in `scripts/scan-injection.sh` in
`Bolt-Silverfox/storytime-ci`, and since `storytime-ci@5f4e23d` there is nothing
to keep in sync: the reusable workflow checks that repo out at its own pinned
`SCANNER_REF` and runs the detector from there. A consumer carries **a pin and
nothing else**.

> **Changed in `storytime-ci@5f4e23d` (was: vendor + `SCAN_SCRIPT_SHA256`).**
> Every repo used to vendor an identical copy of the script, with the reusable
> workflow pinning its `sha256` as `SCAN_SCRIPT_SHA256` and failing closed if a
> copy was missing, stale or tampered. That gate no longer exists, because the
> thing it guarded no longer exists — there is no second copy for CI to verify.
> `SCAN_SCRIPT_SHA256` is gone from the workflow; do not reintroduce it, and do
> not add a drift check for any local copy.

This repo still keeps `scripts/scan-injection.sh` for the `.githooks/pre-commit`
early warning. **CI does not read that file.** It is therefore allowed to drift:
a stale local copy can weaken a local warning, never the merge gate. Refresh it
when convenient from the SHA this repo's own caller already trusts (not `main`):

```bash
pin=$(grep -oE 'malware-scan\.yml@[0-9a-f]{40}' .github/workflows/malware-scan.yml | cut -d@ -f2)
curl -fsSL "https://raw.githubusercontent.com/Bolt-Silverfox/storytime-ci/${pin}/scripts/scan-injection.sh" \
  -o scripts/scan-injection.sh
```

### Updating the detector

Both steps happen in `storytime-ci`; consumers are untouched unless you want the
new detector immediately.

1. Edit `scripts/scan-injection.sh` in `Bolt-Silverfox/storytime-ci`.
2. In a **second commit in the same PR**, set `SCANNER_REF` to the SHA of commit
   1, and land the PR with a **merge commit** — squash and rebase both rewrite
   that SHA and orphan the pin. Two `storytime-ci`-only self-checks enforce this:
   the script at `HEAD` must be byte-identical to the copy at `SCANNER_REF`, and
   `SCANNER_REF` must stay reachable from `main`.
3. Optionally bump each consumer's `uses:` pin to pick the change up. A consumer
   left on an older pin keeps running the detector that pin names — older, not
   broken.

The canonical, fuller version of this document lives at
`docs/config-injection-defense.md` in `Bolt-Silverfox/storytime-ci`.

## Rollout to another repo

1. Add the thin caller workflow (see `docs/security/malware-scan-caller.example.yml`).
   There is no script to copy.
2. Add `.storytime-ci/` to `.gitignore` — the workflow **fails the job** if the
   caller tracks anything under that path, since `actions/checkout` clears the
   directory the scanner is fetched into.
3. Optionally add `.githooks/pre-commit` plus a local copy of the script, for a
   local early warning only. See the drift note above.
4. Push; confirm the `malware-scan` check runs green.
4. **Owner:** add the check to branch protection (below).

## Make it merge-blocking (owner action — GitHub UI)

For each repo, for each protected/deploy branch (`dev`, `develop-v1.3.0`,
`main`, `staging`, release branches):

1. **Settings → Branches → Branch protection rules → Add/Edit** for the branch
   (or branch pattern).
2. Enable **Require status checks to pass before merging**.
3. Search and require the check by name. **The name differs by repo:**
   - in **storytime-ci** (self-scan of the canonical repo): `config-injection + disguised-font scan`
   - in **every other repo** (thin caller job named `scan`): `scan / config-injection + disguised-font scan`
4. Recommended: also enable **Require branches to be up to date before merging**
   and protect `.github/` + `scripts/scan-injection.sh` with a CODEOWNERS review
   so the gate itself can't be quietly weakened.

Until step 2–3 are done the scan runs but does **not** block merges.
