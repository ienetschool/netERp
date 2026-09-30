# Enterprise Office ERP

Monorepo implementing the Enterprise Office ERP per the specification in [`docs/`](docs/). Stage 1 (Foundation / Core Platform) is implemented as a vertical slice.

## Stack

| Layer | Tech |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| API | NestJS 11, Prisma ORM, JWT access + rotating refresh tokens |
| Worker | BullMQ on Redis (outbox relay, notification delivery) |
| Database | PostgreSQL 16 via Prisma (see note below on production MariaDB) |
| Packages | `@erp/types`, `@erp/permissions`, `@erp/validation`, `@erp/ui`, `@erp/prisma` |

## Layout

```
apps/web        Next.js front end (port 3000)
apps/api        NestJS REST API (port 4000, prefix /api/v1)
apps/worker     BullMQ worker process
packages/*      Shared libraries (types, permissions, validation, ui, prisma)
docs/           Specification + ADRs + foundation notes
```

## Prerequisites

- Node.js 20+ (developed on Node 24)
- npm 11 (pnpm/yarn not supported)
- Docker (for PostgreSQL + Redis locally) — no other infrastructure is required

### npm install scripts

npm 11 blocks lifecycle scripts by default. The root `package.json` declares an
`allowScripts` allow-list; after `npm install`, approve it once with:

```bash
npm install-scripts approve
```

## Getting started

```bash
npm install
npm install-scripts approve      # one-time, approves prisma engines etc.
cp .env.example .env             # adjust if needed (defaults work with docker compose)

docker compose up -d postgres redis

npm run db:generate              # prisma generate
npm run db:migrate:deploy        # apply migrations
npm run db:seed                  # idempotent seed data

# development servers (separate terminals, or a process manager of your choice)
npm run dev --workspace @erp/api      # http://localhost:4000/api/v1
npm run dev --workspace @erp/web      # http://localhost:3000
npm run dev --workspace @erp/worker   # outbox + notification delivery
```

### Demo credentials

| User | Email | Password |
| --- | --- | --- |
| Admin | `admin@demo.local` | `Admin123!` |
| Manager | `manager@demo.local` | `Admin123!` |

## Quality gates

```bash
npm run typecheck --workspaces --if-present
npm run lint --workspaces --if-present
npm run test:unit --workspaces --if-present
npm run build --workspaces --if-present
```

E2E tests (Playwright) live in `apps/web/e2e/` and are excluded from the default
gates; install browsers with `npx playwright install chromium` and run
`npm run e2e --workspace @erp/web` when a running stack is available.

## Deployment note — MariaDB vs PostgreSQL

The deployment target described in `docs/CLAUDE.md` §73 is a shared host running
**MariaDB**, while the architecture (`docs/ARCHITECTURE.md`,
`docs/DATA-MODEL.md`) mandates **PostgreSQL** + Prisma features (advisory locks,
JSONB, partial indexes) that MariaDB does not provide.

This conflict is **intentionally unresolved** — see
[`docs/deployment-db-conflict.md`](docs/deployment-db-conflict.md) and
[ADR-0006](docs/adr/0006-production-database-target.md). No credentials are
committed to this repository.

## License

Internal / proprietary.
