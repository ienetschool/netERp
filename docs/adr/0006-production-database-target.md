# ADR-0006: Production database target — PostgreSQL-first, MariaDB conflict open

**Status:** Accepted — Option A adopted (PostgreSQL alongside the shared host)
**Decision date:** 2026-10-06

## Context
`CLAUDE.md` §73 describes a production host running MariaDB, while `ARCHITECTURE.md`
and `DATA-MODEL.md` mandate PostgreSQL. The implementation uses
PostgreSQL-specific features (advisory locks for numbering, JSONB + partial indexes,
Postgres-typed migrations).

## Decision
Build PostgreSQL-first per the architecture docs. Do **not** silently switch the
Prisma datasource to MariaDB. Record the conflict in
`docs/deployment-db-conflict.md` and require an explicit owner decision —
recommended: provision PostgreSQL (managed or on the host) rather than porting.

### Resolution (2026-10-06)
The system owner selected **Option A — PostgreSQL alongside**. Production therefore
keeps PostgreSQL as the system of record. The managed Supabase Postgres project
already in use (`Royals ERP Project`, ref `<supabase-project-ref>`, region `us-west-2`)
is the production database; `DATABASE_URL` for the deployed environment points at it.
MariaDB on the shared host is **not** used by the application and no port is planned.

Deployment target: the existing shared host that `erp.ienet.online` already resolves
to (`76.13.98.31`), reverse-proxying to the Node API and the Next.js front end, with
Postgres remaining managed off-host.

## Consequences
- Spec guarantees (gap-free numbering, JSONB querying, migration parity) hold.
- Production deployment is unblocked on the database dimension.
- The shared host does not need a local database; no MariaDB port is required.
- No credentials from §73 are committed to the repository.
