# Sandboxed build environment for storytime-be.
# Node 22 (project requires >=20) with pnpm pinned to the repo's packageManager.
# Deliberately minimal: no credentials, no cloud CLIs, no host mounts (see
# devcontainer.json and docs/security/sandbox-dev.md).
FROM node:22-bookworm-slim

# Enable Corepack and pin pnpm to the version in package.json's packageManager.
# Pinning avoids pulling an arbitrary (potentially compromised) pnpm at runtime.
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

# The base image already ships a non-root 'node' user; devcontainer.json runs
# as that user. Nothing here writes host credentials into the image.
WORKDIR /workspaces/storytime-be

# Make 'node' the image default user (not just remoteUser), so any entrypoint
# other than the Dev Container lifecycle also runs unprivileged. Corepack was
# already enabled above as root, so its shims in /usr/local/bin stay usable.
USER node
