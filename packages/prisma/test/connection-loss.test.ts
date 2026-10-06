import { describe, expect, it, vi } from 'vitest';
import { isConnectionLoss, PrismaService } from '../src/index.js';

/**
 * A `PrismaService` with just enough plumbing to exercise `withReconnect`: the
 * real constructor opens a socket, which a unit test must not do.
 */
function fakeService(): { service: PrismaService; connects: () => number } {
  const service = Object.create(PrismaService.prototype) as PrismaService;
  let connects = 0;
  (service as unknown as { $connect: () => Promise<void> }).$connect = async () => {
    connects += 1;
  };
  return { service, connects: () => connects };
}

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

describe('PrismaService.withReconnect', () => {
  it('reconnects and replays the read once when the pooled socket was dropped', async () => {
    const { service, connects } = fakeService();
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: 'P1017', message: 'Server has closed the connection.' })
      .mockResolvedValueOnce('ok');

    await expect(service.withReconnect(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(connects()).toBe(1);
  });

  it('surfaces a genuine query failure without reconnecting', async () => {
    const { service, connects } = fakeService();
    const failure = { code: 'P2025', message: 'Record to update not found' };
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(service.withReconnect(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(connects()).toBe(0);
  });

  it('does not loop forever when the replay also fails', async () => {
    const { service, connects } = fakeService();
    const failure = { code: 'P1001', message: "Can't reach database server" };
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(service.withReconnect(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(connects()).toBe(1);
  });
});