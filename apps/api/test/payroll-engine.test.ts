import { describe, expect, it } from 'vitest';
import { percentToFactor } from '../src/payroll/payroll.service.js';
import { BusinessRuleError } from '../src/common/errors.js';
import { Money } from '@erp/types';

/**
 * Payroll engine unit tests. The DB-backed lifecycle (calculation, workflow
 * submission, posting) is covered by integration tests once a live PostgreSQL
 * is available; these lock the exact-decimal percentage math.
 */
describe('percentToFactor', () => {
  it('shifts the decimal point two places', () => {
    expect(percentToFactor('7.5')).toBe('0.075');
    expect(percentToFactor('100')).toBe('1.00');
    expect(percentToFactor('0.5')).toBe('0.005');
    expect(percentToFactor('12.34')).toBe('0.1234');
    expect(percentToFactor('0')).toBe('0.00');
  });

  it('keeps single-digit percentages exact', () => {
    expect(percentToFactor('5')).toBe('0.05');
    expect(percentToFactor('10')).toBe('0.10');
  });

  it('rejects negative and malformed percentages', () => {
    expect(() => percentToFactor('-5')).toThrow(BusinessRuleError);
    expect(() => percentToFactor('abc')).toThrow(BusinessRuleError);
    expect(() => percentToFactor('')).toThrow(BusinessRuleError);
  });

  it('yields exact-decimal component amounts (no binary float drift)', () => {
    // 7.3 percent of 4333.33 must round HALF_UP to 316.33 — binary float
    // arithmetic would produce 316.32999999999998 on some paths.
    const base = Money.fromDecimalString('4333.33');
    const amount = base.multiplyByFactor(percentToFactor('7.3')).toString();
    expect(amount).toBe('316.33');
  });
});
