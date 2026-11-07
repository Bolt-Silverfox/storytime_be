# Dependency policy

## Default branch follows the active release line

Dependabot targets the repository default branch and reads
`.github/dependabot.yml` from it (no `target-branch` is set). When a new release
line is cut (e.g. `develop-v1.8.0`), change the default branch in GitHub
settings at the same time, otherwise Dependabot keeps opening PRs against a
stale line.

## OpenTelemetry + Sentry: joint migration pending

`@opentelemetry/*` 0.223 -> 0.300 is the OTel JS 3.0 jump. It is breaking even
though 0.x "minor" bumps look harmless, and it must be done together with
Sentry 11. Until then, in `.github/dependabot.yml`:

- `@opentelemetry/*` majors and `@sentry/*` majors are ignored.
- Minors are ignored only for the experimental 0.x OTel packages we depend on
  (`sdk-node`, `sdk-logs`, `exporter-*`, `instrumentation-http`,
  `instrumentation-express`, `auto-instrumentations-node`, `winston-transport`),
  listed by name. The stable packages (`api`, `resources`, `sdk-metrics`,
  `semantic-conventions`) still receive minor and patch updates.
  `instrumentation-express` is frozen even though it is a contrib package:
  `src/otel-setup.ts` loads it through `auto-instrumentations-node` (0.81.0
  pins `^0.71.0`), so a direct 0.72 bump would leave the running
  instrumentation on 0.71.x while installing OTel 3.0 dependencies. A new 0.x
  `@opentelemetry/*` dependency must be added to the ignore list by hand;
  otherwise its minor bumps would arrive unguarded.
- Patch updates of the ignored packages still arrive.
- `@sentry/*` and `@opentelemetry/*` each have their own Dependabot group
  (`sentry`, `otel`) and are excluded from `minor-and-patch`. The Sentry group
  matters: Sentry's global carrier is keyed by SDK version, so merging
  `@sentry/node` without `@sentry/opentelemetry` leaves two `@sentry/core`
  versions installed and spans/error context vanish silently with CI green.
  Never merge a partial Sentry bump.

Known breakage:

- `@opentelemetry/sdk-node` no longer re-exports tracing; `metricReader`
  became `metricReaders`; `sdk-trace-base` was removed. Affects
  `src/otel-setup.ts` lines 1, 131, 186, 218 (and 22-26, 220-225).
- The lockfile mixes OTel majors if packages are bumped individually.
- `@sentry/opentelemetry` 10 peers the `@opentelemetry/*` SDK packages at
  `^1.30.1 || ^2.1.0` (not `^2` only).
- Sentry 11 touches `src/sentry-setup.ts` lines 2, 40, 47.

When doing the migration: bump all OTel and Sentry packages in one PR, update
both setup files, then remove the `ignore` entries and the `minor-and-patch` exclusions.

## Release age

Prefer adopting versions that have been published for at least 14 days. This is
a convention, not enforced by tooling; check the publish date before merging a
Dependabot PR for a fresh release.

## Handling Dependabot groups

- The `minor-and-patch` group PR is reviewed as one unit: CI must be green
  (build, lint, jest, e2e). If one package breaks, do not merge the group;
  exclude or ignore that package in `dependabot.yml` and comment
  `@dependabot recreate`.
- Major bumps arrive as individual PRs. ESM-only packages (e.g. `@nestjs/*` 12)
  need an entry in the `transformIgnorePatterns` allow-list in `jest.config.js`;
  `src/common/esm-compat/esm-only-deps.spec.ts` guards this under jest, and the
  `Build` CI job smoke-requires the built `dist` output under the production
  Node major to cover the runtime side. Both checks use fixed package lists: when
  adding a package to the allow-list, also add it to the spec and to the
  "Smoke-load built output" step in `.github/workflows/dev-deploy.yml`.
- If a manual bump supersedes a Dependabot PR, close the PR and reference the
  superseding PR.
