# ADR-0001: Modular monolith with a separate worker process

**Status:** Accepted

## Context
The PRD spans many modules (IAM, documents, workflow, accounting, procurement, sales,
inventory) across 12 delivery stages. The team is small and the deployment target is a
single application host.

## Decision
Build a single NestJS application structured as feature modules (`iam`, `platform`),
with a separate lightweight BullMQ worker process (`apps/worker`) for asynchronous
jobs (outbox relay, notification delivery).

## Consequences
- Single deployable API; module boundaries enforced by Nest modules, ready to extract later.
- Async work does not block request handling and survives deploys via Redis queues.
- No cross-service transaction complexity; one database, one Prisma schema.
