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
Sentry 11. Until then `@opentelemetry/*` (major and minor) and `@sentry/*`
(major) are ignored in `.github/dependabot.yml` and excluded from the
`minor-and-patch` group (patch updates still arrive as individual PRs).

Known breakage:

- `@opentelemetry/sdk-node` no longer re-exports tracing; `metricReader`
  became `metricReaders`; `sdk-trace-base` was removed. Affects
  `src/otel-setup.ts` lines 1, 131, 186, 218 (and 22-26, 220-225).
- The lockfile mixes OTel majors if packages are bumped individually.
- `@sentry/opentelemetry` 10 peers `@opentelemetry/core` and
  `sdk-trace-base` `^2`.
- Sentry 11 touches `src/sentry-setup.ts` lines 2, 40, 47.

When doing the migration: bump all OTel and Sentry packages in one PR, update
both setup files, then remove the `ignore` entries and the group exclusions.

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
  `src/common/esm-compat/esm-only-deps.spec.ts` guards this.
- If a manual bump supersedes a Dependabot PR, close the PR and reference the
  superseding PR.
