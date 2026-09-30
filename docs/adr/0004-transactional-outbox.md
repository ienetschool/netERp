# ADR-0004: Transactional outbox for async effects

**Status:** Accepted

## Context
Notifications and future integrations must not be lost when the API commits a
transaction but the side effect (email, queue job) fails or the process dies.

## Decision
Use the transactional outbox pattern: services write `OutboxEvent` rows (PENDING) in
the same transaction as their state change; a worker relay polls PENDING events,
enqueues them on BullMQ, and marks them PUBLISHED (or FAILED after 10 attempts).

## Consequences
- At-least-once delivery; consumers must be idempotent.
- No dual-write inconsistency between Postgres and Redis.
- Relay polling is simple and dependency-free; can move to LISTEN/NOTIFY later if latency demands.
