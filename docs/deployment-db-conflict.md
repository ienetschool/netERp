# Deployment database conflict — MariaDB target vs PostgreSQL architecture

**Status: RESOLVED (2026-10-06) — Option A adopted: PostgreSQL alongside.**

The system owner chose **Option A**. Production runs PostgreSQL as the system of record
(the managed Supabase project already in use, ref `<supabase-project-ref>`); the shared
host that `erp.ienet.online` resolves to (`76.13.98.31`) only serves the application and
reverse proxy. MariaDB is unused and **no port is planned**. The conflict below is kept
for the record.

## The conflict

- `CLAUDE.md` **§73** (deployment instructions) places production on a shared host:
  MariaDB at `DB_HOST=76.13.98.31`, database `erp`, exposed via
  `https://erp.ienet.online`, application path
  `/var/www/vhosts/ienet.online/erp.ienet.online`.
- `ARCHITECTURE.md` and `DATA-MODEL.md` mandate **PostgreSQL** as the system of record,
  and the implementation relies on PostgreSQL-specific features:
  - `pg_advisory_xact_lock` for gap-free document numbering (`NumberingService`)
  - JSONB columns and GIN/partial indexes in the foundation migration
  - Prisma provider `postgresql` in `packages/prisma/prisma/schema.prisma`

## Why this is not silently resolved

Switching the Prisma datasource to MariaDB is **not** a drop-in change:

1. `pg_advisory_xact_lock` has no MariaDB equivalent — document numbering would need a
   `SELECT ... FOR UPDATE` counter-table redesign or application-level locking.
2. JSONB queries, partial indexes, and several migration SQL statements do not port.
3. The seed, migrations, and CI job all assume a Postgres service.

Per CLAUDE.md's own instruction, this conflict is **documented rather than silently
switched**: the codebase remains PostgreSQL-first, and the MariaDB target is recorded
here as an open decision for the system owner.

## Options

| Option | Summary | Trade-offs |
| --- | --- | --- |
| **A. PostgreSQL alongside** (recommended) | Run Postgres (managed or self-hosted) for the ERP; keep the shared host for static hosting/reverse proxy | Cleanest fit to architecture; requires provisioning a second database |
| B. Port to MariaDB | Re-provider Prisma, replace advisory locks, rewrite JSONB/partial-index SQL | Loses spec guarantees, rework in numbering + migration, ongoing dual-dialect burden |
| C. Defer | Keep Postgres-first code, deploy only after Option A is approved | Blocks production go-live until decided |

## Credentials hygiene

Connection details and credentials mentioned in CLAUDE.md §73 are **deliberately not
committed** to this repository. Secrets belong in the deployment environment
(`.env` on the host / secrets manager), never in git.
