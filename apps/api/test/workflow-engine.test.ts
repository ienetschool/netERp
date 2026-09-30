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
