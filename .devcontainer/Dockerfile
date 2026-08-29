# Sandboxed build environment for storytime-be.
# Node 22 (project requires >=20) with pnpm pinned to the repo's packageManager.
# Deliberately minimal: no credentials, no cloud CLIs, no host mounts (see
# devcontainer.json and docs/security/sandbox-dev.md).
FROM node:22-bookworm-slim

# Shared Corepack home so the pnpm that root prepares below is usable by the
# non-root 'node' user after the USER switch. Without this each user has its own
# ~/.cache/node/corepack, and `pnpm` would try to re-download after the switch.
ENV COREPACK_HOME=/opt/corepack

# Enable Corepack and pin pnpm to the version in package.json's packageManager.
# Pinning avoids pulling an arbitrary (potentially compromised) pnpm at runtime.
# Hand the prepared cache to 'node' so it can run pnpm without a network fetch.
RUN corepack enable \
    && corepack prepare pnpm@10.15.1 --activate \
    && chown -R node:node "$COREPACK_HOME"

# Bake the credential guard INTO the image rather than running the copy that
# lives in the mounted (and therefore mutable) workspace — a poisoned workspace
# must not be able to tamper with the check that is meant to protect it.
COPY verify-no-workspace-credentials.sh /usr/local/bin/verify-no-workspace-credentials.sh
RUN chmod 0555 /usr/local/bin/verify-no-workspace-credentials.sh

# The base image already ships a non-root 'node' user; devcontainer.json runs
# as that user. Nothing here writes host credentials into the image.
WORKDIR /workspaces/storytime-be

# Make 'node' the image default user (not just remoteUser), so any entrypoint
# other than the Dev Container lifecycle also runs unprivileged.
USER node
