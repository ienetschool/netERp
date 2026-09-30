import { describe, expect, it } from 'vitest';
import {
  workflowActSchema,
  workflowDefinitionSchema,
} from '../src/workflow.js';

describe('workflowActSchema', () => {
  it('requires a rejection reason when rejecting', () => {
    const bad = workflowActSchema.safeParse({ decision: 'REJECT' });
    expect(bad.success).toBe(false);

    const good = workflowActSchema.safeParse({
      decision: 'REJECT',
      rejectionReason: 'Amount exceeds delegation',
    });
    expect(good.success).toBe(true);
  });

  it('accepts approve without extra fields', () => {
    expect(workflowActSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
    expect(workflowActSchema.safeParse({ decision: 'CANCEL' }).success).toBe(true);
  });

  it('rejects unknown decisions', () => {
    expect(workflowActSchema.safeParse({ decision: 'MAYBE' }).success).toBe(false);
  });
});

describe('workflowDefinitionSchema', () => {
  const base = {
    name: 'Purchase approval',
    entityType: 'purchase_order',
    states: [
      { code: 'DRAFT', name: 'Draft', isInitial: true, isTerminal: false },
      { code: 'APPROVED', name: 'Approved', isInitial: false, isTerminal: true },
    ],
    transitions: [{ from: 'DRAFT', to: 'APPROVED', action: 'approve' }],
  };

  it('accepts a minimal valid definition', () => {
    expect(workflowDefinitionSchema.safeParse(base).success).toBe(true);
  });

  it('enforces UPPER_SNAKE_CASE state codes', () => {
    const bad = {
      ...base,
      states: base.states.map((s, i) =>
        i === 0 ? { ...s, code: 'draft' } : s,
      ),
    };
    expect(workflowDefinitionSchema.safeParse(bad).success).toBe(false);
  });

  it('requires at least two states and one transition', () => {
    expect(
      workflowDefinitionSchema.safeParse({ ...base, states: [base.states[0]] }).success,
    ).toBe(false);
    expect(workflowDefinitionSchema.safeParse({ ...base, transitions: [] }).success).toBe(false);
  });

  it('rejects non-uuid companyId when provided', () => {
    expect(
      workflowDefinitionSchema.safeParse({ ...base, companyId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});
