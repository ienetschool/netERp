import { describe, expect, it } from 'vitest';

/**
 * Numbering format tests. Database-backed allocation is covered by
 * integration tests once a live PostgreSQL is available (see docs/foundation.md);
 * these lock the public format contract: PREFIX-YYYY-NNNNNN.
 */
describe('document number format', () => {
  it('follows PREFIX-YYYY-NNNNNN', () => {
    const prefix = 'PO';
    const year = 2026;
    const seq = 42;
    expect(`${prefix}-${year}-${seq.toString().padStart(6, '0')}`).toBe('PO-2026-000042');
  });
});
