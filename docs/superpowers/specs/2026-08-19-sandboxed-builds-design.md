# Design: sandboxed builds (contain build-time RCE)

**Status:** draft spec (not yet approved for implementation).
**Motivation:** the config-injection worm is *build-time RCE* — it executes when
`eslint`/`postcss`/`next build`/`jest` load a poisoned config. The
[config-injection gate](../security/config-injection-defense.md) stops infected
files from *landing*, but any build that runs before detection (or on a
developer's machine outside CI) executes attacker code with the ambient
credentials of that environment. Sandboxing removes the *payoff*: even if a
payload runs, it can't reach real secrets, the network, or persistence.

## Threat model (what a sandbox must deny)

A malicious install/build script or poisoned config, when executed, tries to:
1. Read credentials — `.env`, `~/.npmrc`, `~/.aws`, `~/.ssh`, cloud metadata,
   CI secrets in env.
2. Exfiltrate over the network (the observed worm fetches/eval-s remote code).
3. Persist — write to shell rc files, cron, git hooks, or re-inject configs.
4. Move laterally — push to remotes using ambient git/gh tokens.

## Two environments, different fixes

### A. CI (highest leverage, do first)
GitHub-hosted runners are already ephemeral VMs, but they still carry **real
secrets in env** and outbound network. Harden:

1. **Least-privilege tokens.** `permissions:` block minimal per workflow
   (`contents: read` unless a job needs more). Already done on `malware-scan.yml`.
2. **No secrets in build/lint jobs.** Split pipelines: *build/lint/test* jobs run
   with **no secrets** in env; only *deploy* jobs (which don't run untrusted
   build tooling on unreviewed code) get secrets, and only after the gate +
   review have passed. A poisoned config in a PR then executes in a secret-less
   job.
3. **Egress control.** Add a network-policy step (e.g. block outbound except the
   package registry) via a runner-level firewall action, or run install/build in
   a container with `--network=none` after dependencies are fetched.
4. **`--ignore-scripts` by default** for installs, with an explicit reviewed
   allowlist of packages that genuinely need lifecycle scripts (the repos
   already gate this with pnpm `onlyBuiltDependencies`). Extend to npm repos.

### B. Developer machines (the reservoir problem)
The Aug-9 wave originated from **one developer's working tree** that kept
re-injecting configs. A dev sandbox makes local builds disposable:

1. **Devcontainer** (`.devcontainer/`) — builds/lints/tests run inside a
   container with the repo bind-mounted read-write but **no host credential
   mounts**, no host `~/.npmrc`/`~/.ssh`, and constrained egress. A payload that
   runs sees an empty, disposable box.
2. **Separate the credential surface** — git push / gh auth happen on the host,
   never inside the build container; the container cannot push.
3. **Rebuild-on-demand** — treat the container as cattle; if anything looks off,
   discard and rebuild from the image.

## Rollout order (proposed)

1. **CI job split (A2) + egress (A3)** — biggest immediate risk reduction, no dev
   workflow change. Pilot on `storytime_be`, then replicate via the same
   reusable-workflow pattern as the gate.
2. **`--ignore-scripts` + allowlist (A4)** across npm repos.
3. **Devcontainer (B)** — one reference `.devcontainer` per stack (Nest, Next,
   Expo), opt-in first, then default.

## Open questions (for approval before building)

- Egress control mechanism: runner-level firewall action vs containerized
  `--network=none` post-fetch — depends on what the org's runners allow.
- Devcontainer adoption: opt-in vs mandated; affects how aggressively to strip
  host mounts.
- Does splitting secret-bearing deploy jobs from build jobs conflict with any
  current workflow that builds *and* deploys in one job? (Audit
  `dev-deploy.yml`/`staging-deploy.yml`/`deploy-prod.yml` first.)

## Non-goals

- Not a replacement for the config-injection gate — defense in depth; both ship.
- Not a full runner re-architecture (self-hosted isolation) unless the egress
  requirement forces it.
