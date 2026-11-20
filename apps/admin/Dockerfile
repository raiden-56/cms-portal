# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/admin/Dockerfile --build-arg VITE_API_URL=https://cms.example.com -t meridian-admin .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY packages/shared packages/shared
COPY apps/admin apps/admin
# The API URL is compiled into the bundle.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w @meridian/admin

FROM nginx:1.27-alpine AS runtime
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
