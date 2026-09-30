# ADR-0005: Gap-free document numbering via advisory locks

**Status:** Accepted

## Context
Financial and operational documents need human-friendly, gap-free numbers
(`PREFIX-YYYY-NNNNNN`) per company and document type, allocated under concurrency.

## Decision
`NumberingService.nextDocumentNumber(tx, companyId, documentType)` takes
`pg_advisory_xact_lock` on the sequence row and increments `DocumentSequence` inside
the **caller's transaction**, so the number commits or rolls back with the document.

## Consequences
- Gap-free under concurrency; no duplicate numbers.
- Locks serialize concurrent creates of the same sequence — acceptable at expected volume.
- PostgreSQL-specific (`pg_advisory_xact_lock`); flagged in the MariaDB deployment
  conflict (see ADR-0006 and `docs/deployment-db-conflict.md`).
