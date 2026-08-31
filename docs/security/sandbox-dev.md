# Sandboxed local development (credential-free devcontainer)

A `.devcontainer/` that runs `build` / `lint` / `test` **without any host
credentials**. It is the local counterpart to the sandboxed CI egress audit
(#537) and a direct mitigation for the 2026-08 config-injection worm.

## Why this exists

The config-injection worm executes when a poisoned config file is loaded during
a build (`eslint.config.mjs` on `pnpm lint`, `postcss.config.mjs` on `next
build`, etc.). When it runs, it harvests whatever the build environment can
reach: `~/.npmrc` npm tokens, `~/.ssh` keys, `~/.aws`, the host git identity,
and any exported secrets — then exfiltrates and/or re-injects.

This devcontainer removes that reservoir. Builds run inside a container that
**cannot see any of those**, so even if a dependency or config is compromised,
there is nothing local for it to steal.

## The one rule: the host holds credentials, the container does not

- **Inside the container:** `build`, `lint`, `test`, `db:generate` — anything
  that only needs the source tree.
- **On the host (outside the container):** `git push`, `pnpm publish`, `gh`,
  `eas`, deploys, `git commit` signing — anything that needs a credential or
  identity.

Never mount `~/.npmrc`, `~/.ssh`, `~/.aws`, `~/.gitconfig`, or a token into the
container "for convenience." That defeats the entire point.

## What the sandbox enforces

- `mounts: []` — no host directories mounted except the workspace itself.
- `GIT_CONFIG_GLOBAL=/dev/null` — no host git identity/signing key is visible.
- `NPM_CONFIG_USERCONFIG=/dev/null` — no npm auth from inside.
- `pnpm install --frozen-lockfile --ignore-scripts` — dependency **lifecycle
  scripts do not run** on install (the classic supply-chain execution vector).
- `remoteUser: node` — non-root.
- pnpm pinned to `10.15.1` via Corepack (no arbitrary package-manager download).

## Opening it

1. Install Docker + the VS Code "Dev Containers" extension (or any devcontainer
   CLI). The container build needs Docker.
2. VS Code → "Dev Containers: Reopen in Container". First run builds the image
   and runs `pnpm install --ignore-scripts`.

## First-run: verifying the container is actually credential-free

Run these **inside** the container; each should show nothing/empty:

```sh
ls -la ~/.npmrc ~/.ssh ~/.aws ~/.gitconfig 2>&1   # → No such file or directory
git config --global --list                         # → (empty)
env | grep -iE 'token|secret|npm_config__auth|aws_' # → (empty)
```

If any of those return real data, a credential is leaking in — stop and fix the
mount/env before building.

The checks above cover the user/global configs. Because the source tree is
mounted, a **repository-local** `.npmrc` (with `_authToken`/`_auth`/`_password`)
or a `.git/config` remote URL with embedded credentials is also visible inside
the container, and `NPM_CONFIG_USERCONFIG` / `GIT_CONFIG_GLOBAL` do **not**
neutralise those. Before installing, `onCreateCommand` runs the **image-baked**
`verify-no-workspace-credentials.sh` (copied into the image at build time and
run from `PATH`, so a poisoned workspace can't tamper with its own gatekeeper),
which fails the build if it finds any — so keep secrets out of the workspace
(or use a clean worktree) rather than relying on the env vars alone.

## Caveats

- **Native rebuilds:** some packages need lifecycle scripts (`--ignore-scripts`
  skips them). If a build genuinely needs them, run
  `pnpm rebuild <pkg>` explicitly for the specific package after reviewing it —
  do not drop `--ignore-scripts` globally.
- **Workspace mount:** the source tree IS mounted (that's unavoidable), so the
  container can read/modify repo files. It cannot reach anything outside the
  workspace. Push from the host so a poisoned build can't push on your behalf.
- **This is opt-in** and does not change CI. CI has its own protections (the
  required config-injection scan and the shai-hulud deep scan).

## Editors: never auto-lint on the host

The devcontainer gives installs and builds an **isolated path** off the host —
but it does not *prevent* you from running `pnpm install`/lint/build directly on
the host — always run those in the container, never on the host. And an editor's
ESLint/PostCSS/File-Watcher integration is a separate auto-execution path: it
loads a project's **flat config as Node code the moment you open or save a
file** — outside the container, with your host credentials. The Aug-2026 config-injection worm hid
its payload *inside* `eslint.config.mjs` / `postcss.config.mjs`, so an editor
auto-lint would execute it even though you never ran a command. "Deps only in a
sandbox" does not cover this; treat it as a distinct rule.

For these repos:

- **Disable editor ESLint/PostCSS on the host.**
  - **VS Code / Cursor** (user `settings.json` — `.vscode/` is gitignored here,
    so it must be set at the user level):
    `"eslint.enable": false`, `"stylelint.enable": false`.
  - **WebStorm / IntelliJ**: Settings → Languages & Frameworks → JavaScript →
    Code Quality Tools → **ESLint → "Disable ESLint"** (stored per project); and
    Settings → Tools → **File Watchers** — disable any project-level *and*
    global watchers. File Watchers run configured Node/ESLint/Prettier/PostCSS
    commands on the host on save/change, which disabling ESLint alone does not
    stop.
- **Run lint — and any build — only inside the devcontainer**, where the config
  executes in the isolated, credential-free environment.
- PostCSS has no editor auto-exec: it only runs during a Next.js build
  (`next build` / `next dev`), which also stays in the container.
