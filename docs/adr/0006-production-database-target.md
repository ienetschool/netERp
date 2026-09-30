# ADR-0006: Production database target — PostgreSQL-first, MariaDB conflict open

**Status:** Accepted (code) / **Open decision** (deployment)

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

## Consequences
- Spec guarantees (gap-free numbering, JSONB querying, migration parity) hold.
- Production deployment is blocked until the database target is decided.
- A MariaDB port would require redesigning numbering and rewriting migration SQL.
- No credentials from §73 are committed to the repository.
