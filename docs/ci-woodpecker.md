# CI on Woodpecker (phase 1: checks only)

Pipelines in `.woodpecker/` run on ci.fateround.com because GitHub Actions is
unavailable. Phase 1 is CI only: no image build, no deploy, no secrets. The
GitHub workflows in `.github/workflows/` are untouched.

The repository is activated at ci.fateround.com (repo 12) and pipelines run on
every PR and on pushes to the long-lived branches. Pipelines #1-#7 failed to
load their config (a folder inside `.woodpecker/`) and stay 'not started';
ignore them. To re-run: restart a pipeline from the UI, or push a commit.
Helper scripts and `ci.env` live in `ci/woodpecker/`, not `.woodpecker/`:
Woodpecker treats every entry directly under `.woodpecker/` as a config.

## Workflow to check mapping

Woodpecker reports `ci/woodpecker/pr/<file name>` (and `/push/`) to GitHub.

| GitHub job / step | Woodpecker file | Check context | Lane |
| --- | --- | --- | --- |
| Code Quality: Format check, Lint | `lint.yaml` | `ci/woodpecker/pr/lint` | heavy |
| Code Quality: Security audit | `security.yaml` | `ci/woodpecker/pr/security` | light |
| Build | `build.yaml` | `ci/woodpecker/pr/build` | heavy |
| Test | `test.yaml` | `ci/woodpecker/pr/test` | heavy |
| (jest e2e config, payment excluded) | `e2e.yaml` | `ci/woodpecker/pr/e2e` | heavy |
| malware-scan: config-injection + disguised-font scan | `scan.yaml` | `ci/woodpecker/pr/scan` | light |
| version-check: version consistency | `version.yaml` | `ci/woodpecker/pr/version` (PRs only) | light |

Triggers: every pull request, plus pushes to `main`, `develop-v*` and
`release-v*` only (a PR already covers its own pushes). Branch protection must
be repointed to these contexts only after one run has reported each of them.

## Differences from GitHub that matter

- `security` is advisory, like GitHub's audit steps: `pnpm audit
  --audit-level=high || echo ...` prints the findings and always exits 0. It
  reports 10 high findings at the time of writing. Do not repoint it as a
  required check while it reports highs.
- Woodpecker tests the PR HEAD; GitHub tested the merge commit. A PR can be
  green on Woodpecker and still break after merge.
- No timeouts: the pinned `woodpecker-cli v3.18.1` lint rejects a step
  `timeout` key, and the workflow timeout is a repo setting on the server (not
  changed here). GitHub used 10-15 min; set the repo timeout on the server.
- `version` uses `woodpeckerci/plugin-git:2.10.1` for its `clone:` override; a
  custom clone image only works if the server's trusted-clone list allows it.
- `lint` is heavy, not light: type-aware ESLint needs a 2 GB heap (1.5 GB runs
  out of memory), far over the light lane's 768 MiB. It runs `pnpm run lint`,
  which is `eslint --fix`, exactly as GitHub did.
- `test` and `e2e` run jest with `--maxWorkers=1`, not 2: two workers are
  OOM-killed inside the 3 GiB step limit at every heap tried.
- `test` runs without `--coverage` (GitHub's dev job used it; nothing consumed
  the report). `pnpm test` already matches `test/*.e2e-spec.ts`, so `e2e` repeats
  those specs under `test/jest-e2e.json`.
- `build` has no postgres service: `prisma generate` and `nest build` never
  connect to a database.
- Not ported: the weekly shai-hulud deep scan (needs a Woodpecker cron on the
  repo), and the GitHub `workflow_dispatch` runs.
- `version` fetches the PR's target branch and tags through a `clone:`
  override; it fails closed if the target branch cannot be resolved.

## Environment

`ci/woodpecker/ci.env` holds the synthetic values (all `ci-dummy`) the GitHub job
wrote to `.env`; the only change is that the services are `postgres` and
`redis` rather than `localhost`. `ci/woodpecker/scripts/wait-for.mjs` waits for
those ports. Node is `node:24.22.1-bookworm`, pnpm is 10.15.1 (the repo's
`packageManager`) via corepack, installs use
`pnpm install --frozen-lockfile --ignore-scripts`, and the pnpm store is not
cached (spot agents start empty).

## Running a step locally

Use the same image, from the repo root. The unit and e2e steps need Postgres
and Redis; start them yourself on a private Docker network:

```sh
(
  run="wp-$(date +%s)-$$"
  docker network create "$run" || exit 1
  trap 'docker rm -f "$run-postgres" "$run-redis" >/dev/null 2>&1; docker network rm "$run" >/dev/null 2>&1' EXIT
  docker run -d --rm --name "$run-postgres" --network "$run" --network-alias postgres \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=storytime_test postgres:16-alpine
  docker run -d --rm --name "$run-redis" --network "$run" --network-alias redis redis:7-alpine

  docker run --rm --network "$run" --memory 3g -v "$PWD":/w -w /w \
    --env-file ci/woodpecker/ci.env -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
    node:24.22.1-bookworm sh -c '
      corepack enable && corepack prepare pnpm@10.15.1 --activate &&
      pnpm install --frozen-lockfile --ignore-scripts && pnpm db:generate &&
      node ci/woodpecker/scripts/wait-for.mjs postgres:5432 redis:6379 &&
      pnpm db:migrate:deploy &&
      NODE_OPTIONS=--max-old-space-size=2048 env -u ELEVEN_LABS_KEY pnpm test --maxWorkers=1
      status=$?
      find /w/node_modules -user 0 -exec chown -h "$HOST_UID:$HOST_GID" {} +
      exit $status'
)
```

The containers and network carry a per-run name (`wp-<time>-<pid>`), so the `trap`
removes only what this procedure created, on any exit, including after a failed
test command (the block runs in a subshell so cleanup happens after each attempt). The container runs as root, so it hands ownership of the
`node_modules` it created back to you before exiting, whether or not the tests
passed; only root-owned files are handed back, so existing files keep their owner. The
synthetic values are passed with `--env-file`, so an existing `.env` in your
checkout is never overwritten. `ELEVEN_LABS_KEY` is unset for jest because CI
keeps it out of the jest process too: `test/app.e2e-spec.ts` runs only when it
is set, and that suite is stale (it expects a `GET /` route the app no longer
has, and leaves jest hanging on open handles). Lint the pipeline files themselves with
`docker run --rm -v "$PWD":/w -w /w woodpeckerci/woodpecker-cli:v3.18.1 lint .woodpecker/`.

## Memory

Measured in containers with the lane limits (arm64, Docker Desktop): lint peak
about 2.6 GiB, `nest build` about 1.9 GiB, jest about 2.6 GiB (about 65 s for
130 suites), jest e2e about 2.6 GiB (about 30 s), `pnpm audit` 150 MiB. The
heavy steps sit close to the 3 GiB limit; if one is OOM-killed, lower
`--max-old-space-size` before raising anything else. Light lane (768 MiB):
`scan`, `version`, `security` only.

## OPEN DECISION (owner): runner lane for lint, build, test, e2e

State: these four use `labels: lane: heavy`, which in infra-shared is peapool's
spot lane. Storytime's own lane is `heavy-storytime`, but its IMDS hop limit is
2, so a CI step could reach the instance role that can assume the storytime
deploy roles (ExternalId would be the only barrier). So do not just switch.
Options:

- (a) Keep `heavy`: peapool hosts the jobs. No infra change; storytime CI
  shares peapool capacity and its spot interruptions.
- (b) A storytime CI-only lane with IMDS hop limit 1 and no deploy-role assume
  permission. Cleanest isolation; needs infra work and a new label.
- (c) The light lane (768 MiB) where it fits: only `scan`, `version`, `security`
  do. lint/build/test/e2e need 2-3 GiB, so this is not viable for them.

Cost: each commit queues 4 heavy workflows (lint, build, test, e2e), including
on Dependabot branches. Nothing here is changed until the owner decides.
