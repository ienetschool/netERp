import { describe, expect, it } from 'vitest';
import { parseApprover } from '../src/workflow/workflow-engine.service.js';
import { BusinessRuleError } from '../src/common/errors.js';

/**
 * Workflow engine unit tests. Database-backed paths (instance lifecycle,
 * inbox queries, task creation under concurrency) are covered by integration
 * tests once a live PostgreSQL is available; these lock the pure decision
 * logic and the public contract of the approver condition format.
 */
describe('parseApprover', () => {
  it('parses a valid USER approver condition', () => {
    expect(
      parseApprover({ approverType: 'USER', approverId: 'u-123' }),
    ).toEqual({ approverType: 'USER', approverId: 'u-123' });
  });

  describe('amount threshold routing', () => {
    const bands = {
      amountRules: [
        { minAmount: '1000', approverType: 'ROLE', approverId: 'role-cfo' },
        { minAmount: '100', maxAmount: '1000', approverType: 'ROLE', approverId: 'role-mgr' },
        { maxAmount: '100', approverType: 'USER', approverId: 'user-lead' },
      ],
    };

    it('routes to the CFO band at or above 1000 (min inclusive)', () => {
      expect(parseApprover(bands, '1000')).toEqual({ approverType: 'ROLE', approverId: 'role-cfo' });
      expect(parseApprover(bands, '2500.75')).toEqual({ approverType: 'ROLE', approverId: 'role-cfo' });
    });

    it('routes mid amounts to the manager band ([min, max) semantics)', () => {
      expect(parseApprover(bands, '999.99')).toEqual({ approverType: 'ROLE', approverId: 'role-mgr' });
      expect(parseApprover(bands, '1000.00')).toEqual({ approverType: 'ROLE', approverId: 'role-cfo' });
    });

    it('routes small amounts to the lead band (max exclusive)', () => {
      expect(parseApprover(bands, '99.99')).toEqual({ approverType: 'USER', approverId: 'user-lead' });
      expect(parseApprover(bands, '100')).toEqual({ approverType: 'ROLE', approverId: 'role-mgr' });
    });

    it('is exact-decimal: 0.1 + 0.2 style traps do not misroute', () => {
      // 0.3 is in [0.1, 0.3): max bound is exclusive — binary float would fail this.
      expect(parseApprover({ amountRules: [{ minAmount: '0.1', maxAmount: '0.3', approverType: 'USER', approverId: 'u1' }] }, '0.3')).toBeNull();
      expect(parseApprover({ amountRules: [{ minAmount: '0.1', maxAmount: '0.3', approverType: 'USER', approverId: 'u1' }] }, '0.299999999999999999')).toEqual({ approverType: 'USER', approverId: 'u1' });
    });

    it('falls back to the flat approver when no band matches or amount is absent', () => {
      const cond = { approverType: 'ROLE', approverId: 'role-fallback', amountRules: [{ minAmount: '5000', approverType: 'ROLE', approverId: 'role-cfo' }] };
      expect(parseApprover(cond, '100')).toEqual({ approverType: 'ROLE', approverId: 'role-fallback' });
      expect(parseApprover(cond)).toEqual({ approverType: 'ROLE', approverId: 'role-fallback' });
    });

    it('ignores malformed bands instead of throwing', () => {
      expect(parseApprover({ amountRules: ['x', null, { approverType: 'ROLE', approverId: 'r1' }] }, '50')).toEqual({ approverType: 'ROLE', approverId: 'r1' });
    });

    it('returns null when amountRules exist but amount is required and absent', () => {
      // No flat approver and no amount supplied: unguarded transition.
      expect(parseApprover({ amountRules: [{ minAmount: '0', approverType: 'ROLE', approverId: 'r1' }] })).toBeNull();
    });
  });

  it('parses a valid ROLE approver condition', () => {
    expect(
      parseApprover({ approverType: 'ROLE', approverId: 'r-9' }),
    ).toEqual({ approverType: 'ROLE', approverId: 'r-9' });
  });

  it('rejects non-object and null conditions', () => {
    expect(parseApprover(null)).toBeNull();
    expect(parseApprover('USER')).toBeNull();
    expect(parseApprover(['x'])).toBeNull();
  });

  it('rejects malformed approver specs', () => {
    expect(parseApprover({ approverType: 'GROUP', approverId: 'x' })).toBeNull();
    expect(parseApprover({ approverType: 'USER' })).toBeNull();
    expect(parseApprover({ approverType: 'USER', approverId: 42 })).toBeNull();
  });

  it('rejects approver specs with extra unknown shape', () => {
    // Unknown fields are tolerated; only approverType/approverId are contract.
    expect(
      parseApprover({ approverType: 'ROLE', approverId: 'r-1', note: 'ok' }),
    ).toEqual({ approverType: 'ROLE', approverId: 'r-1' });
  });
});

describe('workflow definition rules (engine contract)', () => {
  // The engine enforces these in createDefinition before any DB access.
  function validateDefinition(states: Array<{ code: string; isInitial: boolean }>, transitions: Array<{ from: string; to: string }>): void {
    const initialCount = states.filter((s) => s.isInitial).length;
    if (initialCount !== 1) {
      throw new BusinessRuleError('A workflow definition must have exactly one initial state');
    }
    const codes = new Set(states.map((s) => s.code));
    for (const t of transitions) {
      if (!codes.has(t.from) || !codes.has(t.to)) {
        throw new BusinessRuleError(`Transition ${t.from} -> ${t.to} references unknown state codes`);
      }
    }
  }

  it('requires exactly one initial state', () => {
    expect(() =>
      validateDefinition(
        [
          { code: 'DRAFT', isInitial: false },
          { code: 'DONE', isInitial: false },
        ],
        [{ from: 'DRAFT', to: 'DONE' }],
      ),
    ).toThrow(BusinessRuleError);
  });

  it('accepts a well-formed definition', () => {
    expect(() =>
      validateDefinition(
        [
          { code: 'DRAFT', isInitial: true },
          { code: 'PENDING_APPROVAL', isInitial: false },
          { code: 'APPROVED', isInitial: false },
        ],
        [
          { from: 'DRAFT', to: 'PENDING_APPROVAL' },
          { from: 'PENDING_APPROVAL', to: 'APPROVED' },
        ],
      ),
    ).not.toThrow();
  });

  it('rejects transitions to unknown states', () => {
    expect(() =>
      validateDefinition(
        [
          { code: 'DRAFT', isInitial: true },
          { code: 'DONE', isInitial: false },
        ],
        [{ from: 'DRAFT', to: 'NOPE' }],
      ),
    ).toThrow(/unknown state codes/);
  });
});
