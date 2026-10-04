import { describe, expect, it } from 'vitest';
import { isConnectionLoss } from '../src/index.js';

/**
 * `withReconnect` replays an operation exactly once when the pooled connection
 * is gone. Replaying a query that failed for any other reason — a unique
 * constraint, a bad filter — would hide the real error or duplicate work, so the
 * classifier has to be narrow.
 */
describe('isConnectionLoss', () => {
  it('recognises the Prisma connection-gone codes', () => {
    for (const code of ['P1001', 'P1002', 'P1008', 'P1017']) {
      expect(isConnectionLoss({ code })).toBe(true);
    }
  });

  it('recognises a closed pooler socket with no code', () => {
    expect(isConnectionLoss({ message: 'Server has closed the connection.' })).toBe(true);
    expect(isConnectionLoss({ message: 'Connection closed.' })).toBe(true);
  });

  it('never retries a query that failed for its own reasons', () => {
    expect(isConnectionLoss({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isConnectionLoss({ code: 'P2025', message: 'Record to update not found' })).toBe(false);
    expect(isConnectionLoss({ message: 'Division by zero' })).toBe(false);
  });

  it('ignores values that are not errors', () => {
    expect(isConnectionLoss(undefined)).toBe(false);
    expect(isConnectionLoss(null)).toBe(false);
    expect(isConnectionLoss('Server has closed the connection.')).toBe(false);
  });
});