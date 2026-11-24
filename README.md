# Meridian

A headless content platform: model content without code, build pages visually, run an editorial workflow, and deliver everything to any website or app through REST, GraphQL, webhooks and WebSockets.

- **Content modeling** — content types, components and dynamic zones with 34 field types, validation, conditional logic, and schema changes that migrate existing content safely.
- **Page builder** — drag-and-drop pages made of blocks, stored as framework-neutral data that each frontend renders with its own components.
- **Publishing engine** — drafts, autosave, full version history with restore, review and approval, scheduling, and atomic multi-entry releases.
- **Delivery API** — generated REST and GraphQL endpoints, filtering, sorting, relation population, locales, image transformations, OpenAPI, and a TypeScript SDK. Published content is available the moment it is published; drafts never leave through a public endpoint.
- **Multi-tenant by construction** — organizations → projects → environments, with role-based permissions enforced on the server for every request.

> **Try it without installing anything:** https://raiden-56.github.io/cms-portal/ — the admin in guest mode, with demo data kept only in your browser.
>
> Current status, test results and what is not built yet: [`DEVELOPMENT_PROGRESS.md`](DEVELOPMENT_PROGRESS.md).

## Quick start

Requirements: Node.js 22+, Docker.

```bash
npm install

# 1. PostgreSQL and Redis (host ports 5440 and 6390, so they do not clash with other projects)
docker compose up -d postgres redis

# 2. Configure the API
cp apps/api/.env.example apps/api/.env
#    then set JWT_SECRET and ENCRYPTION_KEY — the file shows the commands that generate them

# 3. Create the database schema and load demo content
npm run db:deploy
npm run db:seed

# 4. Run the API (http://localhost:4000) and the admin (http://localhost:5180)
npm run dev
```

Open <http://localhost:5180> and sign in with the demo account from `apps/api/.env.example` (`SEED_EMAIL` / `SEED_PASSWORD`). The seed prints a read-only API key you can try straight away:

```bash
curl -H "Authorization: Bearer <key>" "http://localhost:4000/api/v1/pages?path=/"
curl -H "Authorization: Bearer <key>" "http://localhost:4000/api/v1/articles?populate=author&sort=-publishedOn"
```

Prefer to start empty? Skip the seed and choose **Create an organization** on the sign-in page.

## Connect an application

```ts
import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({ baseURL: 'http://localhost:4000', apiKey: process.env.MERIDIAN_API_KEY });

const page = await cms.pages.getByPath('/about');
const articles = await cms.content('articles').find({ limit: 10, sort: '-publishedOn' });
```

In the admin, **Developers → Integrations** walks through this for Next.js, React, Vue, Angular, React Native, Flutter and plain HTTP, generates the key, and verifies the connection. See the [developer guide](docs/DEVELOPER_GUIDE.md) and the [Next.js example](examples/nextjs).

## Repository

```
apps/api        Express + Prisma API: management, delivery (REST + GraphQL), media, webhooks, scheduler
apps/admin      React + Vite + MUI admin
packages/shared Field catalogue, validation, page-block model, permissions (used by API and admin)
packages/sdk    @meridian/sdk
examples/nextjs Reference frontend integration
docs            Architecture, developer, deployment and admin guides
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and admin together, with reload |
| `npm run dev:api` / `npm run dev:admin` | One of them |
| `npm run infra:up` / `infra:down` | Start / stop PostgreSQL and Redis |
| `npm run db:migrate` | Create and apply a migration after changing `schema.prisma` (development) |
| `npm run db:deploy` | Apply pending migrations (production, CI) |
| `npm run db:seed` | Load the demo organization, project and content |
| `npm test` | All unit and integration tests |
| `npm run test:e2e` | Browser end-to-end tests (Playwright) |
| `npm run typecheck` | TypeScript across every workspace |
| `npm run build` | Production builds of the SDK, API and admin |

## Tests

```bash
npm test
```

- `packages/shared` — validation, rich-text sanitising, block-tree operations, workflow and role definitions.
- `packages/sdk` — query building, caching and ETag revalidation, retries, browser key guard, webhook signature verification.
- `apps/api` — integration tests against a real PostgreSQL schema and Redis database (isolated from development data): authentication, tenant isolation, role permissions, content modeling and migrations, the full draft → review → publish → deliver → update → restore lifecycle through REST and GraphQL, scheduling, releases, webhooks with retries, WebSocket events, media, pages, and a connected frontend revalidating through the SDK.

The API tests need the Docker services running. They use the `test` schema and Redis database 1 defined in `apps/api/.env.test`, and refuse to run against anything else.

## Configuration

Every setting is an environment variable, documented in [`apps/api/.env.example`](apps/api/.env.example) (API), [`apps/admin/.env.example`](apps/admin/.env.example) (admin) and [`.env.example`](.env.example) (Docker Compose). The API validates its configuration on boot and exits with a clear message if anything is wrong.

## Documentation

| | |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | How the system is put together, and why |
| [Developer guide](docs/DEVELOPER_GUIDE.md) | REST, GraphQL, SDK, pages and blocks, preview, webhooks |
| [Deployment](docs/DEPLOYMENT.md) | Docker, configuration, backup and restore, monitoring, security checklist |
| [Admin guide](docs/ADMIN_GUIDE.md) | For editors and administrators |
| [SDK reference](packages/sdk/README.md) | `@meridian/sdk` |
| OpenAPI | `GET /api/v1/openapi.json` (per environment), or **Developers → API Explorer** |

## Production

```bash
docker build -f apps/api/Dockerfile   -t meridian-api .
docker build -f apps/admin/Dockerfile -t meridian-admin --build-arg VITE_API_URL=https://cms-api.example.com .
```

or, on one host, `docker compose --profile full up -d --build`. Read [Deployment](docs/DEPLOYMENT.md) first — especially secrets, backups and the security checklist.
