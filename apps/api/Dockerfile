# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile -t meridian-api .

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
# Manifests first, so dependency layers stay cached until they change.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/

# Production dependencies only (this is what ships).
FROM base AS deps
RUN npm ci --no-audit --no-fund --omit=dev -w @meridian/api --include-workspace-root

# Full toolchain to compile the server and generate the Prisma client.
FROM base AS build
RUN npm ci --no-audit --no-fund -w @meridian/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @meridian/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# The generated Prisma client and its query engine.
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
RUN mkdir -p /app/apps/api/storage && chown -R node:node /app/apps/api
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
# Pending migrations are applied before the server starts; `migrate deploy` is safe to run on every boot.
CMD ["sh", "-c", "node /app/node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
