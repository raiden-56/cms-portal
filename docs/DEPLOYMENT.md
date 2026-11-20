# Deployment and operations

## What runs

| Component | Image / runtime | Needs |
| --- | --- | --- |
| API | `apps/api/Dockerfile` (Node 22, non-root, tini) | PostgreSQL, Redis, object storage |
| Admin | `apps/admin/Dockerfile` (static files on nginx) | Reachable API URL |
| PostgreSQL 15+ | managed service recommended | — |
| Redis 7+ | managed service recommended; `maxmemory-policy noeviction` | — |
| Object storage | AWS S3, Cloudflare R2 or any S3-compatible store | — |

The API process serves HTTP and also runs the webhook worker, the scheduler and the WebSocket gateway. All coordination goes through Redis (BullMQ queues, pub/sub, rate-limit counters, cache versions), so any number of API instances can run behind a load balancer — background jobs execute once across the fleet.

## Build and run

```bash
docker build -f apps/api/Dockerfile   -t registry.example.com/meridian-api:1.0.0 .
docker build -f apps/admin/Dockerfile -t registry.example.com/meridian-admin:1.0.0 \
  --build-arg VITE_API_URL=https://cms-api.example.com .
```

The API container applies pending database migrations on start (`prisma migrate deploy`, safe to run on every boot and from several instances) and then listens on `PORT`. Its health endpoint is `GET /health` (200 when PostgreSQL and Redis are reachable, 503 otherwise) — use it for container health checks and load-balancer probes.

For a single-host deployment, `docker compose --profile full up -d --build` runs everything from `docker-compose.yml`; copy `.env.example` to `.env` and set the secrets first.

## Configuration

All settings are environment variables, validated at startup — the server exits with a precise message rather than running misconfigured. The full annotated list is `apps/api/.env.example`. The ones that matter in production:

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | Enables secure cookies and hides error internals |
| `DATABASE_URL` | Use TLS (`?sslmode=require`) and a pooled connection where available |
| `REDIS_URL` | `rediss://` for TLS |
| `JWT_SECRET` | ≥ 32 random characters. Rotating it signs everyone out and invalidates preview links |
| `ENCRYPTION_KEY` | 64 hex characters. Encrypts webhook secrets at rest — **back it up**; losing it means re-creating every webhook secret |
| `ADMIN_ORIGIN` | Exact origin(s) of the admin, comma-separated. Only these may call the management API with credentials |
| `PUBLIC_API_URL` | Public URL of the API; used in media and preview URLs |
| `TRUST_PROXY` | Set to your proxy hop count or CIDR so client IPs (audit log, rate limits) are correct |
| `ALLOW_REGISTRATION=false` | After creating your organization, make sign-up invite-only |
| `STORAGE_DRIVER=s3` + `S3_*` | Use object storage; the `local` driver is for development and single-host setups |
| `MEDIA_CDN_URL` | Optional CDN origin in front of `/media` (URLs are immutable — cache them for a year) |
| `WEBHOOK_ALLOW_PRIVATE_URLS=false` | Keep false so webhooks cannot target internal addresses |

Serve the admin and the API on the same registrable domain (for example `cms.example.com` and `cms-api.example.com`): the session cookie is `SameSite=Strict`, `HttpOnly` and, in production, `Secure`.

### Reverse proxy

Terminate TLS in front of both containers. For the API, forward `Upgrade`/`Connection` headers for `/api/v1/events` (WebSocket), allow request bodies up to `MAX_UPLOAD_MB` on `/admin/api/projects/*/media`, and pass `X-Forwarded-For`. Enable HSTS at the proxy.

## Database

- **Migrations** live in `apps/api/prisma/migrations` and are the only way the schema changes. Create them with `npm run db:migrate` in development; production only ever runs `migrate deploy`.
- **Content-model changes are not database migrations.** Adding a field to a content type updates rows, not tables, and is applied transactionally by the application with an impact preview.
- Size the pool to your instance count (`?connection_limit=` on `DATABASE_URL`).

## Backup and restore

Three things hold state. Back up all three on the same schedule.

| What | How | Restore |
| --- | --- | --- |
| PostgreSQL | Managed point-in-time recovery, or `pg_dump -Fc` nightly plus WAL archiving | `pg_restore --clean --if-exists` into an empty database, then start the API (migrations reconcile) |
| Media bucket | Bucket versioning + cross-region replication, or scheduled `rclone sync` | Sync back; asset rows reference object keys, so keys must be preserved |
| Secrets | `JWT_SECRET`, `ENCRYPTION_KEY`, storage credentials in your secret manager | Required to read encrypted webhook secrets after a restore |

```bash
# Logical backup
pg_dump -Fc --no-owner "$DATABASE_URL" > meridian-$(date +%F).dump
# Restore into a fresh database
pg_restore --clean --if-exists --no-owner -d "$NEW_DATABASE_URL" meridian-2026-01-01.dump
```

Redis holds only derived or transient data (caches, rate-limit counters, queued webhook deliveries, presence). It does not need backing up; after losing it, pending webhook deliveries can be redelivered from the delivery log, and scheduled publishes are unaffected because schedules live in PostgreSQL.

Test a restore at least quarterly: restore into a scratch environment, start the API, sign in, and fetch a page through the delivery API.

Beyond infrastructure backups, the product itself protects content: every save is a version that can be restored, deletes go to a trash first, schema changes that would discard values require confirmation, and replaced media keeps its id.

## Monitoring

| Signal | Where |
| --- | --- |
| Liveness / readiness | `GET /health` |
| Logs | Structured JSON on stdout (pino): one line per request with `id`, `method`, `path`, `status`, `ms`; errors with stack traces. Secrets and auth headers are redacted |
| Request correlation | `X-Request-Id` on every response and in every error body |
| API traffic, error rate, latency | **Analytics** in the admin (hourly counters per key and content type) |
| Webhook health | **Developers → Webhooks** (per-delivery log, failures, redelivery) and the dashboard's queue indicator |
| Audit | **Administration → Audit Logs** (who changed what, with before/after), exportable as CSV |

Alert on: `/health` failing; 5xx rate above your baseline; webhook queue `failed` count rising; `entry.schedule_failed` audit events (a scheduled publish that could not run); disk or bucket usage.

Ship stdout to your log platform and scrape `/health` from your uptime monitor. The JSON log lines carry enough to build latency and error dashboards without extra instrumentation.

## Security checklist

- [ ] TLS everywhere; HSTS at the proxy
- [ ] `JWT_SECRET` and `ENCRYPTION_KEY` generated per environment, stored in a secret manager
- [ ] `ALLOW_REGISTRATION=false` after initial setup
- [ ] `ADMIN_ORIGIN` lists only your admin origin
- [ ] `WEBHOOK_ALLOW_PRIVATE_URLS=false`
- [ ] Database and Redis not reachable from the internet
- [ ] Object storage bucket private (files are served through `/media`, optionally via CDN)
- [ ] Read-only keys in browsers; preview and read/write keys only on servers, with expiry
- [ ] Least-privilege roles; review **Audit Logs** and active API keys periodically
- [ ] Backups verified by an actual restore

## Upgrading

1. Take a database backup.
2. Deploy the new API image — it applies its migrations on start. With several instances, roll them one at a time.
3. Deploy the new admin image.

When you add migrations of your own, keep each one compatible with the previous release (add columns before using them, remove them a release after they stop being read) so a rolling deploy never leaves an instance facing a schema it cannot use.
