# ---------------------------------------------------------------------------
# Production image for the Storytime API (NestJS).
#
# Target host: a single arm64 EC2 box (t4g.small, 2 GiB) running every service
# under Docker behind Caddy. The image MUST be built for linux/arm64 — the AMI
# architecture follows the instance type, so an amd64 image simply will not
# execute (exec format error).
#
#   docker buildx build --platform linux/arm64 -t <ecr>/storytime/api:<tag> .
#
# The api container is memory-capped by the orchestrator (see NODE_OPTIONS in
# the runtime stage) and the box has only tens of MiB of headroom in total, so
# this image deliberately runs exactly ONE long-lived process (node). No tini/dumb-init, no pm2, no cron, no supervisor.
# Node is PID 1; `app.enableShutdownHooks()` in src/main.ts installs the
# SIGTERM/SIGINT handlers, so `docker stop` drains cleanly without an init
# shim. (Cost of that choice: no zombie reaper. The only child this image ever
# forks is the short-lived Google Play verification script below, which is
# reaped by execFile's own waitpid, so there is nothing to orphan.)
#
# NOTHING SECRET IS BAKED IN. There is no .env in the image (.dockerignore
# excludes .env*). All configuration arrives at runtime from SSM as real
# environment variables. src/main.ts does `import 'dotenv/config'`, which is a
# no-op when no .env file exists and never overrides an already-set variable.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24
ARG PNPM_VERSION=10.15.1

# ---------------------------------------------------------------------------
# base — shared toolchain layer
#
# Debian bookworm-slim, NOT Alpine, and this is not a style preference:
#   * bcrypt@6 is a native addon. It ships prebuilt binaries for linux-arm64
#     against GLIBC only; on musl prebuild-install finds no match and falls
#     back to compiling with node-gyp, which then needs python3/make/g++ in
#     the final toolchain and produces a musl-only binary. Both bcrypt and
#     bcryptjs are used in this codebase (4 and 2 source files respectively),
#     so neither can be dropped to sidestep this.
#   * Prisma's generator block in prisma/schema.prisma pins
#     binaryTargets = ["native"], which means the query engine is resolved at
#     `prisma generate` time for the generating machine's arch AND libc. A
#     client generated on glibc will not load on musl and vice versa. Keeping
#     every stage on the same base image family is what makes "native" safe
#     here, and is why this Dockerfile does not need to edit schema.prisma to
#     add an explicit binaryTarget.
# Node 24 (current LTS line) is used here at the deployment owner's direction;
# engines.node in package.json is ">=20.0.0", so it is in range. Note this is
# AHEAD of the NODE_VERSION: '22' pinned in the .github deploy workflows and
# .devcontainer — those drive the legacy PM2 path, not this image.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# manifests — the exact set of files an install needs, isolated so that a
# source-only change does not bust the (slow) install layer cache.
#
# pnpm-workspace.yaml IS LOAD-BEARING and is the subtlest trap in this build.
# It is listed in .gitignore (line 61) yet is git-tracked, so it is easy to
# assume it is disposable. It carries `onlyBuiltDependencies`, and under
# pnpm 10 postinstall scripts are blocked by default unless the package is
# named there. Without this file in the build context: bcrypt never runs its
# install script (no binary -> ERR_DLOPEN_FAILED at boot) and @prisma/engines
# never downloads (no query engine -> Prisma cannot start). .dockerignore must
# therefore never exclude it; if you change .dockerignore, re-verify with
#   docker build --no-cache --target manifests --progress=plain .
# ---------------------------------------------------------------------------
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Fail loudly at build time rather than mysteriously at runtime.
RUN test -s pnpm-workspace.yaml \
    && grep -q 'onlyBuiltDependencies' pnpm-workspace.yaml

# ---------------------------------------------------------------------------
# prod-deps — the node_modules that actually ships.
#
# Production dependencies only: this keeps @swc/core, jest, typescript and
# @mermaid-js/mermaid-cli (+ puppeteer) out of the runtime image entirely.
#
# `prisma generate` runs HERE, against the production tree, so the Prisma
# client and its native library engine are produced by the same arch/libc that
# will load them (see the binaryTargets note above). Only prisma/schema.prisma
# is copied in — deliberately NOT prisma/prisma.config.ts, which is TypeScript
# and would drag ts-node + typescript into the runtime image just to be parsed.
# Everything that config supplies (schema path, migrations path, DATABASE_URL)
# is already the CLI default or read from env by the datasource block.
#
# build-essential/python3 are present only as a fallback path for bcrypt: the
# linux-arm64 glibc prebuild normally downloads, but if prebuild-install ever
# 404s we want a compile, not a broken image. They are discarded with this
# stage and never reach the runtime layer.
# ---------------------------------------------------------------------------
FROM manifests AS prod-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --prod
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm exec prisma generate

# ---------------------------------------------------------------------------
# build — compiles TypeScript. Needs the full dependency tree (@nestjs/cli).
#
# `prisma generate` is repeated here because nest build type-checks against
# the generated @prisma/client types; this copy of the client is thrown away
# with the stage, only the one from prod-deps ships.
#
# nest build emits to dist/ with tsconfig.build.json rootDir=./src, so the
# entrypoint is dist/main.js (flat — there is no dist/src/). nest-cli.json
# also copies **/*.ejs email templates into dist as assets.
# ---------------------------------------------------------------------------
FROM manifests AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec prisma generate \
    && pnpm run build \
    && test -f dist/main.js

# ---------------------------------------------------------------------------
# python-deps — the Google Play purchase verification interpreter.
#
# WHY THIS IS IN THE IMAGE AT ALL: src/payment/google-verification.service.ts
# resolves `path.join(process.cwd(), 'scripts')` and execFile()s
# scripts/verify_google_purchase.py, defaulting the interpreter to
# scripts/.venv/bin/python3 (overridable via PYTHON_PATH). That script does
# Workload Identity Federation against the EC2 instance metadata service and
# then calls the Android Publisher API — the service's own header explains the
# work is delegated to Python because the Node google-auth-library mishandles
# AWS IMDS. Omitting it does not degrade gracefully: every Google Play
# purchase verification fails with a bare execFile ENOENT on a path that does
# not exist, which is a genuinely confusing production failure.
#
# THE COST, stated honestly: ~45 MiB of image for a CPython runtime plus
# google-auth and requests, and a transient ~35 MiB RSS child process each
# time a purchase is verified. Against a container cap of a few hundred MiB that spike is
# real but bounded and rare (one purchase at a time, sub-second), whereas
# broken IAP is permanent. If the memory ceiling ever becomes the binding
# constraint, the right fix is to move verification out of this container, not
# to silently delete the interpreter.
#
# The venv is built in its own stage so that pip/setuptools/ensurepip never
# land in the production image; only the resolved site-packages are copied.
# The venv is not relocatable, so /app/scripts/.venv here must equal the path
# in the runtime stage, and both stages must share the same base image (same
# python3 minor version) for the interpreter symlink to resolve.
# ---------------------------------------------------------------------------
FROM base AS python-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/requirements.txt /app/scripts/requirements.txt
RUN python3 -m venv /app/scripts/.venv \
    && /app/scripts/.venv/bin/pip install --no-cache-dir --upgrade pip \
    && /app/scripts/.venv/bin/pip install --no-cache-dir -r /app/scripts/requirements.txt

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# python3 only (no pip, no venv module) — see python-deps.
#
# libssl3 (NOT the `openssl` CLI package) is what the Prisma library engine
# actually needs: `objdump -p libquery_engine-debian-openssl-3.0.x.so.node`
# lists NEEDED libssl.so.3 and NEEDED libcrypto.so.3, which libssl3 provides.
# The node:*-bookworm-slim base already ships libssl3, so this is belt-and-
# braces against a future base-image slimming rather than a fix for a current
# failure; installing `openssl` instead would additionally drag in a CLI binary
# the runtime never invokes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 libssl3 \
    && rm -rf /var/lib/apt/lists/*

# NODE_OPTIONS — this is a correctness setting, not a tuning knob.
#
# Measured on node:24-bookworm-slim, `v8.getHeapStatistics().heap_size_limit`
# inside a container run with `docker run -m <cap>`:
#
#     -m 192m -> 259 MiB      -m 512m -> 259 MiB
#     -m 256m -> 259 MiB      -m 640m -> 368 MiB
#     -m 384m -> 259 MiB      -m   1g -> 560 MiB
#
# So V8 does read the cgroup limit, but it only scales the default old-space
# down to a ~259 MiB floor. Below a cap of roughly 512 MiB that floor is the
# binding value, and at the small end (a 256 MiB cap) V8 believes it may grow
# to more than the whole container — it keeps allocating instead of collecting
# under pressure and the kernel OOM killer SIGKILLs the process, which surfaces
# as a container restart with no application-level error.
#
# 320 MiB is pinned for a 512 MiB cap (the api container is being reduced from
# 640 MiB to make room for the waitlist services on the same box). That leaves
# ~190 MiB for everything that is NOT old space: V8's new/code space, the
# native heap, Prisma's in-process library engine, Buffers/ArrayBuffers (which
# live outside the old-space budget), and the transient python child described
# above. Pinning it also makes the limit independent of host RAM detection, so
# the same image behaves identically on the build machine and on the t4g.
#
# IF THE CAP CHANGES, CHANGE THIS — keep it near 60-65% of the cap, and note
# that going much above ~259 MiB per the table is *loosening* V8 relative to
# its own default rather than tightening it. It can also be overridden at run
# time; the orchestrator's NODE_OPTIONS replaces this value, it does not append.
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=320

WORKDIR /app

# Production dependency tree with the arch-matched Prisma client baked in.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# Compiled output (dist/main.js + .ejs email templates).
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=python-deps --chown=node:node /app/scripts/.venv ./scripts/.venv

# MIGRATIONS. There is no separate migration runner in this deployment, so the
# prisma CLI, prisma/schema.prisma and all of prisma/migrations ship in the
# image and migrations are applied against the running container:
#
#   docker exec -it storytime-api pnpm exec prisma migrate deploy
#     (or: docker exec -it storytime-api node_modules/.bin/prisma migrate deploy)
#
# This is intentional rather than running migrate on container start: 104
# migrations against a single shared Postgres must not race N restarting
# containers, and a failed migration should not turn into a crash-loop that
# takes the API down. Deploy = pull image, start container, then exec the
# migration once by hand (or from the deploy job).
# `prisma` is a production dependency for exactly this reason; note that
# prisma/prisma.config.ts is NOT shipped, so the CLI uses its defaults
# (./prisma/schema.prisma) and reads DATABASE_URL from the environment via the
# datasource block.
COPY --chown=node:node prisma/schema.prisma ./prisma/schema.prisma
COPY --chown=node:node prisma/migrations ./prisma/migrations
COPY --chown=node:node package.json ./package.json
# process.cwd()-relative asset, see python-deps.
COPY --chown=node:node scripts/verify_google_purchase.py ./scripts/verify_google_purchase.py

# winston writes logs/error.log and logs/combined.log RELATIVE TO CWD, but only
# when NODE_ENV=production (shared/config/logger.config.ts:69-81). /app is owned
# by root, so without this the very first log line fails with
# `EACCES: permission denied, mkdir 'logs'` and the process exits before it ever
# binds a port — a crash that cannot reproduce in dev, because the file
# transports do not exist there.
RUN mkdir -p /app/logs && chown node:node /app/logs

# Never run as root. The node images already provide uid/gid 1000 `node`.
USER node

EXPOSE 3000

# Liveness only. The global prefix is `api/v1` (src/main.ts), so `/health` is a
# 404 — the real path is /api/v1/health, an empty terminus check that touches
# no dependency. Do NOT point this at /api/v1/health/ready: that one probes
# Postgres, Redis, SMTP and the queue and returns 503, which would make Docker
# kill the API whenever a downstream blips. Uses node's global fetch (>=18)
# because this image intentionally has no curl/wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form: node is PID 1 and receives SIGTERM directly from `docker stop`.
CMD ["node", "dist/main.js"]
