# Sandboxed Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contain build-time RCE (the config-injection worm family and any supply-chain payload) so that even if attacker code executes during CI or a local build, it cannot reach real secrets, exfiltrate over the network, or persist.

**Architecture:** Defense-in-depth around the *payoff*, not the vector. Phase 1 hardens GitHub Actions CI: egress filtering (block outbound to un-allowlisted hosts), install-script suppression, and secret minimization so untrusted steps run without secrets on disk. Phase 2 gives developers an opt-in devcontainer so local `build`/`lint`/`test` run in a disposable container with no host credentials. The config-injection gate (already shipped) stops infected files landing; this plan removes the reward if one ever executes.

**Tech Stack:** GitHub Actions, `step-security/harden-runner` (egress control), pnpm 10 / npm, Docker + Dev Containers.

## Global Constraints

- **NEVER run `prisma migrate dev`** — `DATABASE_URL` points at the shared prod/dev RDS (`emerj-shared-db.cvq22s4q62o3.eu-west-1.rds.amazonaws.com`). This plan touches no migrations.
- **No Claude signature in commits or PRs** — no `Co-Authored-By` / `Generated-with` lines. Verify with `git log -1 --format=%b`.
- **Pin every third-party action to a full commit SHA**, matching the repo's existing convention (e.g. `actions/checkout@3d3c42e…`). Tags in this plan's code blocks are replaced with SHAs in the pinning step of each task.
- **Push over HTTPS:** `git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/<repo>.git" HEAD:<branch>`.
- **Do not handle secrets directly.** This plan never prints, copies, or edits secret *values*; it only changes *when/where* `secrets.*` are materialized. Rotation stays an owner action.
- Package managers: `storytime_be`/`storytime-fe`/`storytime_superadmin` = pnpm; `storytime-mobile`/`storytime-waitlist-*` = npm (verify per repo before editing).
- Verification for CI tasks means **pushing a branch and reading the Actions run** — there is no local runner. Each task's "run to verify" step names the exact run/artifact to inspect.

---

## File Structure

**Phase 1 — CI hardening (pilot: `storytime_be`, then replicate):**
- Modify: `storytime_be/.github/workflows/dev-deploy.yml` — add harden-runner to every job; `--ignore-scripts` on installs; move/trim secret materialization.
- Create: `storytime_be/.github/actions/harden/action.yml` — composite action wrapping the pinned harden-runner call + shared egress allowlist, so all jobs/repos stay in sync (single source, like the malware-scan reusable workflow).
- Modify (replication): the deploy/CI workflow in each other repo to call the composite action and add `--ignore-scripts`.

**Phase 2 — Dev sandbox (pilot: `storytime_be`):**
- Create: `storytime_be/.devcontainer/devcontainer.json`
- Create: `storytime_be/.devcontainer/Dockerfile`
- Create: `storytime_be/docs/security/sandboxed-dev.md`

---

## Phase 1 — CI hardening

### Task 1: Egress audit (harden-runner, audit mode)

Discover the *actual* outbound destinations each job needs before blocking anything. harden-runner in `audit` mode never fails the build; it records egress to the run summary.

**Files:**
- Modify: `storytime_be/.github/workflows/dev-deploy.yml` (add a first step to jobs `quality`, `build`, `test`, `auto-format`, `deploy`)

**Interfaces:**
- Produces: an egress audit in each job's run summary → the allowlist used by Task 2.

- [ ] **Step 1: Add harden-runner (audit) as the first step of the `quality` job**

Insert immediately after `runs-on:` / before `Checkout` in the `quality` job:

```yaml
      - name: Harden runner (audit)
        uses: step-security/harden-runner@v2
        with:
          egress-policy: audit
```

- [ ] **Step 2: Repeat for `build`, `test`, `auto-format`, and `deploy` jobs**

Add the identical `Harden runner (audit)` step as the FIRST step of each of those jobs (before their `Checkout`).

- [ ] **Step 3: Pin the action to a SHA**

Resolve the latest v2 release commit and replace the tag:

```bash
gh api repos/step-security/harden-runner/releases/latest --jq '.tag_name'
gh api repos/step-security/harden-runner/git/refs/tags/<tag_name> --jq '.object.sha'
# Replace every `step-security/harden-runner@v2` with `@<sha> # <tag_name>`
```

- [ ] **Step 4: Commit and push to a branch**

```bash
cd storytime_be
git checkout -b security/sandbox-ci develop-v1.3.0
git add .github/workflows/dev-deploy.yml
git commit -m "ci(security): add harden-runner egress audit to all dev-deploy jobs"
git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/storytime_be.git" HEAD:security/sandbox-ci
```

- [ ] **Step 5: Open a PR and run to verify**

```bash
gh pr create --repo Bolt-Silverfox/storytime_be --base develop-v1.3.0 --head security/sandbox-ci \
  --title "ci(security): sandbox CI — egress audit" --body "Audit-only harden-runner; no enforcement yet."
```
Expected: all jobs PASS. Open each job's run summary → "Egress" section lists the hosts it contacted. **Record these** (registry, github, RDS host, deploy host `52.18.195.224`, Grafana OTLP, codecov, etc.) — they become the Task 2 allowlist.

---

### Task 2: Egress enforcement (harden-runner, block mode) via composite action

Turn the audited egress into an enforced allowlist, and factor it into one composite action so every job and repo shares the same policy (no drift — same principle as the malware-scan reusable workflow).

**Files:**
- Create: `storytime_be/.github/actions/harden/action.yml`
- Modify: `storytime_be/.github/workflows/dev-deploy.yml` (replace the five audit steps with the composite)

**Interfaces:**
- Consumes: the egress host list recorded in Task 1 Step 5.
- Produces: `./.github/actions/harden` composite, reused by Task 5's replication.

- [ ] **Step 1: Write the composite action**

`storytime_be/.github/actions/harden/action.yml` (fill `allowed-endpoints` from the Task 1 audit; the list below is the expected baseline — add/remove to match what audit actually showed):

```yaml
name: Harden runner
description: Pinned harden-runner with the org's shared egress allowlist.
runs:
  using: composite
  steps:
    - uses: step-security/harden-runner@<sha> # <tag> — same pin as Task 1
      with:
        egress-policy: block
        disable-sudo: true
        allowed-endpoints: >
          github.com:443
          api.github.com:443
          objects.githubusercontent.com:443
          codeload.github.com:443
          registry.npmjs.org:443
          nodejs.org:443
          emerj-shared-db.cvq22s4q62o3.eu-west-1.rds.amazonaws.com:5432
          52.18.195.224:22
          otlp-gateway-prod-eu-west-2.grafana.net:443
          keyserver.ubuntu.com:443
```

- [ ] **Step 2: Replace the audit steps with the composite in every job**

In `dev-deploy.yml`, replace each `Harden runner (audit)` step with:

```yaml
      - name: Harden runner
        uses: ./.github/actions/harden
```

Note: `deploy` opens an SSH connection to `52.18.195.224:22` and talks to RDS `:5432` — both are in the allowlist above; confirm they matched the audit.

- [ ] **Step 3: Add a deliberate out-of-policy egress canary to prove blocking**

Temporarily add this step to the `build` job (after Harden runner) to confirm enforcement, then remove it in Step 5:

```yaml
      - name: Egress canary (expected to be BLOCKED)
        run: curl -m 10 -sSf https://example.com >/dev/null && echo "NOT BLOCKED — policy failed" || echo "blocked as expected"
```

- [ ] **Step 4: Push and run to verify enforcement**

```bash
git add .github/actions/harden/action.yml .github/workflows/dev-deploy.yml
git commit -m "ci(security): enforce egress allowlist via shared harden composite"
git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/storytime_be.git" HEAD:security/sandbox-ci
```
Expected: real jobs PASS (every needed host was allowlisted). The canary step logs "blocked as expected" **and** harden-runner reports a blocked outbound to `example.com` in the summary. If a real job fails on a blocked host, add that host to `allowed-endpoints` and re-run — do NOT widen to `*`.

- [ ] **Step 5: Remove the canary, commit**

```bash
# delete the "Egress canary" step from dev-deploy.yml
git add .github/workflows/dev-deploy.yml
git commit -m "ci(security): remove egress canary after verifying enforcement"
git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/storytime_be.git" HEAD:security/sandbox-ci
```
Expected: all jobs PASS with enforcement on.

---

### Task 3: Suppress install lifecycle scripts

Belt-and-suspenders: stop dependency (and root) lifecycle scripts from executing during CI installs. pnpm 10 already blocks *dependency* build scripts by default, but `--ignore-scripts` also blocks root `prepare`/`postinstall` and is the primary defense for the npm-based repos in Task 5.

**Files:**
- Modify: `storytime_be/.github/workflows/dev-deploy.yml` (every `pnpm install` line)

- [ ] **Step 1: Add `--ignore-scripts` to each install invocation**

Change every occurrence of:

```yaml
        run: pnpm install --frozen-lockfile
```
to:
```yaml
        run: pnpm install --frozen-lockfile --ignore-scripts
```
(There are installs in `quality`, `build`, `test`, and `auto-format`.)

- [ ] **Step 2: Confirm the build still needs no script-driven step**

If `pnpm db:generate` (Prisma) or `pnpm build` relies on a postinstall that no longer runs, invoke it explicitly as its own step (it already is: `Generate Prisma client` runs `pnpm db:generate`). No change expected — Prisma generate is an explicit step, not a lifecycle hook.

- [ ] **Step 3: Push and run to verify**

```bash
git add .github/workflows/dev-deploy.yml
git commit -m "ci(security): install with --ignore-scripts (no lifecycle execution)"
git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/storytime_be.git" HEAD:security/sandbox-ci
```
Expected: `build` and `test` jobs still PASS (Prisma client generated by the explicit step; app builds). If a job fails because a real dependency needed its build script, add that one package to `pnpm.onlyBuiltDependencies` in `package.json` (reviewed allowlist) rather than dropping `--ignore-scripts`.

---

### Task 4: Secret minimization in the build job

The `build` job writes the entire `secrets.ENV_FILE` to `.env` **before** install and build. With Task 3 install no longer runs untrusted scripts, but `pnpm build` still executes repo config (nest-cli/webpack). Ensure the compile step does not require the full secret set on disk; keep secrets only where genuinely needed (`test` migrations, `deploy`).

**Files:**
- Modify: `storytime_be/.github/workflows/dev-deploy.yml` (`build` job)

- [ ] **Step 1: Determine whether `pnpm build` needs `.env`**

Add a temporary diagnostic: in the `build` job, move the `Create .env file` step to AFTER `Build`, push, and observe. NestJS compilation (`nest build`) is a TypeScript compile and does not read runtime env; it should succeed with no `.env`.

- [ ] **Step 2: If build passes without `.env`, remove secret materialization from `build`**

Delete the `Create .env file` and the `Cleanup sensitive files` steps from the `build` job entirely (build no longer touches secrets). Leave them intact in `test` (needs a DB env for migrate/tests) and `deploy`.

- [ ] **Step 3: If build genuinely needs a value, write the minimal subset**

Only if Step 1 shows a build-time failure: replace the full `${{ secrets.ENV_FILE }}` dump with the specific variables the build needs, e.g.:

```yaml
      - name: Create build .env (minimal)
        run: |
          cat > .env << 'EOF'
          NODE_ENV=production
          EOF
```
Do NOT reintroduce the full `ENV_FILE` into the build job.

- [ ] **Step 4: Push and run to verify**

```bash
git add .github/workflows/dev-deploy.yml
git commit -m "ci(security): keep full secrets out of the build job"
git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/storytime_be.git" HEAD:security/sandbox-ci
```
Expected: `build` PASSES with no full-secret `.env` present while compiling. `test`/`deploy` unchanged and green.

- [ ] **Step 5: Merge Phase 1 for storytime_be**

```bash
gh pr merge <PR#> --repo Bolt-Silverfox/storytime_be --merge
```
Expected: merge triggers a dev deploy; confirm the `deploy` job succeeds end-to-end (SSH + restart) with enforcement + minimization live.

---

### Task 5: Replicate to the other repos

Extend the same three controls (harden composite, `--ignore-scripts`, secret minimization) to every repo's CI, reusing the composite action.

**Files:**
- Create per repo: `.github/actions/harden/action.yml` (identical bytes to storytime_be's; hash-verify like the malware scanner)
- Modify per repo: the deploy/CI workflow(s)

- [ ] **Step 1: Inventory each repo's workflows and package manager**

```bash
for r in storytime-fe storytime_superadmin storytime-mobile storytime-waitlist-be storytime-waitlist-fe; do
  echo "== $r =="; gh api repos/Bolt-Silverfox/$r/contents/.github/workflows --jq '.[].name' 2>/dev/null
done
```
Record which use `npm ci` vs `pnpm install` (npm repos need `--ignore-scripts` most — npm runs scripts by default).

- [ ] **Step 2: For each repo, add the harden composite + `--ignore-scripts`, one branch/PR per repo**

Copy `.github/actions/harden/action.yml`, add `- name: Harden runner / uses: ./.github/actions/harden` as the first step of each job, and append `--ignore-scripts` to installs (`npm ci --ignore-scripts` for the npm repos). Start each repo in `audit` first (flip the composite's `egress-policy` to `audit` for the first run), read its egress, then switch to `block` with that repo's allowlist.

- [ ] **Step 3: Verify and merge each**

Expected per repo: audit run reveals egress → block run passes with allowlist → merge. Log any repo whose CI can't be hardened without breakage and stop for review rather than widening egress to `*`.

---

## Phase 2 — Developer sandbox (devcontainer)

Local `build`/`lint`/`test` are where the worm's reservoir lived. A devcontainer makes those disposable and credential-free.

### Task 6: Reference devcontainer for storytime_be

**Files:**
- Create: `storytime_be/.devcontainer/devcontainer.json`
- Create: `storytime_be/.devcontainer/Dockerfile`

**Interfaces:**
- Produces: an opt-in container that bind-mounts the repo but mounts NO host credentials.

- [ ] **Step 1: Write the Dockerfile**

`storytime_be/.devcontainer/Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
WORKDIR /workspace
```

- [ ] **Step 2: Write devcontainer.json (no host credential mounts)**

`storytime_be/.devcontainer/devcontainer.json`:

```json
{
  "name": "storytime_be (sandboxed)",
  "build": { "dockerfile": "Dockerfile" },
  "workspaceFolder": "/workspace",
  "runArgs": ["--init"],
  "mounts": [],
  "remoteEnv": { "GIT_CONFIG_GLOBAL": "/dev/null" },
  "postCreateCommand": "pnpm install --frozen-lockfile --ignore-scripts",
  "customizations": { "vscode": { "extensions": ["dbaeumer.vscode-eslint"] } }
}
```
The empty `mounts` and nulled git config mean the container sees no `~/.npmrc`, `~/.ssh`, `~/.aws`, or host git identity. `git push`/`gh auth` happen on the HOST, never inside the container.

- [ ] **Step 3: Verify the container builds and installs cleanly**

Run (or have a reviewer with Docker run): `devcontainer up --workspace-folder storytime_be` (or "Reopen in Container" in VS Code).
Expected: container builds, `pnpm install --ignore-scripts` completes, `pnpm build` works. Confirm `cat ~/.npmrc` inside the container is empty/absent and `ssh -T git@github.com` fails (no keys) — proving the credential surface is gone.

- [ ] **Step 4: Commit**

```bash
git add .devcontainer/
git commit -m "chore(security): add credential-free devcontainer for local builds"
```

---

### Task 7: Document and set rollout expectations

**Files:**
- Create: `storytime_be/docs/security/sandboxed-dev.md`

- [ ] **Step 1: Write the doc**

Cover: why (build-time RCE reservoir), how to open the devcontainer, the rule that pushes/auth stay on the host, and that this is **opt-in** first (one reference container per stack: Nest here, Next for the FE/admin repos, Expo for mobile — created as follow-ups). Link `docs/security/config-injection-defense.md` and the sandbox spec.

- [ ] **Step 2: Commit and open the Phase 2 PR**

```bash
git add docs/security/sandboxed-dev.md
git commit -m "docs(security): sandboxed local development guide"
git push "https://x-access-token:$(gh auth token)@github.com/Bolt-Silverfox/storytime_be.git" HEAD:security/sandbox-dev
gh pr create --repo Bolt-Silverfox/storytime_be --base develop-v1.3.0 --head security/sandbox-dev \
  --title "security: developer sandbox (devcontainer) + guide" --body "Phase 2 of sandboxed-builds: opt-in credential-free devcontainer."
```

---

## Self-Review

**Spec coverage:**
- A1 least-privilege tokens — the workflow already sets per-job `permissions:`; harden-runner adds `disable-sudo`. Covered (Task 2). *No new task needed; noted.*
- A2 no secrets in build/lint jobs — Task 4 (build); `quality`/lint already writes no `.env`. Covered.
- A3 egress control — Tasks 1–2. Covered.
- A4 `--ignore-scripts` + allowlist — Task 3 (+ Task 5 for npm repos). Covered.
- B devcontainer — Tasks 6–7. Covered.
- Rollout order (pilot storytime_be → replicate) — Tasks 1–4 then Task 5. Covered.
- Open question "egress mechanism" — resolved to harden-runner (Task 1–2). "devcontainer opt-in vs mandated" — resolved to opt-in (Task 7). "build+deploy same job" — audited: already separate; exposure was secret-before-install, addressed by Task 4.

**Placeholder scan:** allowlist hosts are concrete (from known infra + audit); the audit step exists precisely so the list is evidence-based, not guessed. Action SHAs are resolved by an explicit command step, not left blank.

**Type consistency:** composite path `./.github/actions/harden` is referenced identically in Tasks 2 and 5; `egress-policy` values (`audit`→`block`) consistent; `--ignore-scripts` wording consistent across Tasks 3 and 5.
