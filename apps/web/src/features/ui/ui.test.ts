import { describe, expect, it } from 'vitest';
import { toneForStatus } from '@erp/ui';

describe('toneForStatus', () => {
  it('maps common statuses to semantic tones', () => {
    expect(toneForStatus('APPROVED')).toBe('success');
    expect(toneForStatus('PENDING_APPROVAL')).toBe('info');
    expect(toneForStatus('REJECTED')).toBe('danger');
    expect(toneForStatus('CHANGES_REQUESTED')).toBe('warning');
    expect(toneForStatus('DRAFT')).toBe('warning');
  });
});
