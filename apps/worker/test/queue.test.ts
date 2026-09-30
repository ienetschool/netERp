import { describe, expect, it } from 'vitest';
import { JOB_OUTBOX_RELAY, JOB_NOTIFY_DISPATCH, QUEUE_NOTIFICATIONS, QUEUE_OUTBOX } from '../src/queue.js';

describe('queue contract', () => {
  it('exposes stable queue and job names', () => {
    expect(QUEUE_OUTBOX).toBe('outbox');
    expect(QUEUE_NOTIFICATIONS).toBe('notifications');
    expect(JOB_OUTBOX_RELAY).toBe('outbox.relay');
    expect(JOB_NOTIFY_DISPATCH).toBe('notify.dispatch');
  });
});
