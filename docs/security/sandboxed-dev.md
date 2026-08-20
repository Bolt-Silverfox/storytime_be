# Sandboxed local development (devcontainer)

## Why: Build-time RCE reservoir

The config-injection worm is **build-time RCE** — it executes when `eslint`, `postcss`, or other build tools load a poisoned config file. While the [config-injection gate](./config-injection-defense.md) stops infected configs from merging, any build that runs *before detection* (typically on a developer's machine) executes attacker code with your ambient credentials: `.env` files, `~/.npmrc`, SSH keys, git tokens, and local AWS credentials.

A sandboxed devcontainer removes the *payoff* of a payload: even if malicious code runs during `pnpm install` or `pnpm lint`, it cannot reach real secrets, the network, or persistence. See the [full design spec](../superpowers/specs/2026-08-19-sandboxed-builds-design.md) for threat model and rationale.

## Getting started (opt-in)

This devcontainer is **opt-in** — it is a reference implementation for the NestJS stack. Equivalent sandboxes for Next.js (FE/admin) and Expo (mobile) are planned follow-ups.

### Prerequisites

- **Docker Desktop** (Windows/Mac) or **Docker + Docker Compose** (Linux)
- **VS Code** with the Dev Containers extension (`ms-vscode-remote.remote-containers`)
- Alternatively, the [DevContainer CLI](https://github.com/devcontainers/cli) (all platforms)

### Opening the devcontainer

**Option 1: VS Code (recommended)**

1. Open the repo in VS Code.
2. A green prompt appears: **"Reopen in Container"**. Click it, or press `F1` and select "Dev Containers: Reopen in Container".
3. VS Code rebuilds the image and reopens the workspace *inside* the container.

**Option 2: DevContainer CLI**

```bash
devcontainer up --workspace-folder .
```

This spins up the container without VS Code.

### What the sandbox provides

- **No host credentials**: `.devcontainer/devcontainer.json` specifies `"mounts": []` (empty) and `GIT_CONFIG_GLOBAL=/dev/null`, removing access to `~/.npmrc`, `~/.ssh`, `~/.aws`, git config, and GitHub tokens.
- **Disposable build environment**: the container is ephemeral; discard and rebuild if anything looks suspicious.
- **Repo bind-mount** (read-write): your working tree is mounted at `/workspace`; all edits sync bidirectionally. The container has no write access outside the workspace.
- **pnpm pre-configured**: `pnpm install --frozen-lockfile --ignore-scripts` runs on container creation, allowing only audited build scripts via the explicit allowlist in `pnpm-workspace.yaml`.

## The credential rule: git push and auth stay on the host

**Inside the container, you cannot:**
- Push to git remotes (no SSH keys, no git config, no `gh` CLI tokens)
- Access AWS, Stripe, or other credentials
- Exfiltrate data over the network

**All credential operations must happen on the host:**

```bash
# Inside the container: edit, test, lint
pnpm lint
pnpm test

# Back on the host: commit and push
git add .
git commit -m "..."
git push
gh pr create ...
```

This separation is intentional. If the container process spawns malicious code, it has nowhere to send secrets and no way to mutate your git history or tokens.

## Verifying the container

A reviewer must confirm the sandbox is working before rollout:

1. **Build the image:**
   ```bash
   docker build -f .devcontainer/Dockerfile -t storytime_be:sandbox .
   ```
   Should complete without error.

2. **Spin up the container and verify credential surface:**
   ```bash
   docker run --rm -it \
     -v "$(pwd):/workspace" \
     -w /workspace \
     storytime_be:sandbox bash
   ```

3. **Inside the container, run these checks:**
   ```bash
   # npmrc should be empty or absent
   cat ~/.npmrc 2>/dev/null || echo "✓ No ~/.npmrc"

   # SSH keys should be absent
   ssh -T git@github.com 2>&1 | grep -q "Permission denied\|no such file" \
     && echo "✓ No SSH keys" || echo "✗ Unexpected SSH success"

   # Workspace should be mounted and populated
   ls -la /workspace | grep -q "package.json" \
     && echo "✓ Workspace mounted" || echo "✗ Workspace not found"

   # pnpm install should succeed (with --ignore-scripts)
   pnpm install --frozen-lockfile --ignore-scripts 2>&1 | tail -5
   ```

4. **Workspace mount caveat:** If `pnpm install` fails with a "workspace not found" or empty `/workspace`, adjust the `workspaceFolder` in `.devcontainer/devcontainer.json`. The default assumes a single-folder workspace. For multi-root setups, try:
   ```json
   "workspaceFolder": "/workspaces/storytime_be"
   ```
   or add an explicit `workspaceMount` binding:
   ```json
   "workspaceMount": "source=/absolute/path/to/storytime_be,target=/workspace,readonly=false"
   ```

## Reference docs

- [Config-injection defense gate](./config-injection-defense.md) — how the CI malware scanner works
- [Sandboxed builds design spec](../superpowers/specs/2026-08-19-sandboxed-builds-design.md) — threat model, CI hardening, and rollout plan
