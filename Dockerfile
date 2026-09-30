# syntax=docker/dockerfile:1

# Node 22 LTS: better-sqlite3 11.x ships prebuilt binaries for it on x64 and
# arm64, so installs normally download a binary instead of compiling.
ARG NODE_VERSION=22

# ── base: runtime settings shared by every stage ──────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PORT=3000 \
    TMS_DB_PATH=/data/tms.db \
    TMS_UPLOADS_DIR=/data/uploads
WORKDIR /app/server
# /data is the volume mount point. Creating it here means a fresh named volume
# inherits node:node ownership, so the non-root app user can write to it.
RUN mkdir -p /data/uploads && chown -R node:node /data
EXPOSE 3000

# ── deps: production node_modules ─────────────────────────────────────────────
# The compiler toolchain is only a fallback for platforms without a prebuilt
# better-sqlite3 binary; it never reaches the runtime image.
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; \
    else npm install --omit=dev --no-audit --no-fund; fi

# ── app: code + deps, runs as the unprivileged `node` user ────────────────────
# Files are owned by root, so the app can read its own code but not modify it.
# Dependencies sit at /node_modules, outside /app: Node still finds them by
# walking up parent directories, and the dev bind mount over /app can't hide them.
FROM base AS app
COPY --from=deps /app/server/node_modules /node_modules
COPY server/package.json server/server.js server/schema.sql ./
COPY index.html favicon.svg /app/
COPY css   /app/css
COPY js    /app/js
COPY pages /app/pages
COPY --chmod=755 docker/backup.sh  /usr/local/bin/tms-backup
COPY --chmod=755 docker/restore.sh /usr/local/bin/tms-restore
USER node
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s --start-interval=2s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/accounts',{method:'HEAD'}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# ── dev: restarts on server changes; compose.dev.yaml bind-mounts the repo ────
FROM app AS dev
ENV NODE_ENV=development
COPY tests /app/tests
CMD ["node", "--watch", "server.js"]

# ── prod (default target) ─────────────────────────────────────────────────────
FROM app AS prod
ENV NODE_ENV=production
CMD ["node", "server.js"]
