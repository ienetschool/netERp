import { describe, expect, it } from 'vitest';
import { Money, sumMoney } from '../src/money.js';

describe('Money', () => {
  it('adds and subtracts exactly', () => {
    const a = Money.fromDecimalString('0.10');
    const b = Money.fromDecimalString('0.20');
    expect(a.plus(b).toString()).toBe('0.30');
    expect(b.minus(a).toString()).toBe('0.10');
  });

  it('avoids binary floating point drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 with Number; Money must return 0.30
    const result = Money.fromDecimalString('0.1').plus(Money.fromDecimalString('0.2'));
    expect(result.toString()).toBe('0.30');
  });

  it('rejects non-numeric input', () => {
    expect(() => Money.fromDecimalString('abc')).toThrow();
    expect(() => Money.fromDecimalString('1,234.50')).toThrow();
    expect(() => Money.fromDecimalString('NaN')).toThrow();
  });

  it('allocates with largest remainder so parts sum exactly', () => {
    const parts = Money.fromDecimalString('100.00').allocate(['1', '1', '1']);
    expect(parts.map((p) => p.toString())).toEqual(['33.34', '33.33', '33.33']);
    const total = sumMoney(parts);
    expect(total.toString()).toBe('100.00');
  });

  it('allocates uneven weights exactly', () => {
    const parts = Money.fromDecimalString('10.00').allocate(['3', '7']);
    expect(sumMoney(parts).toString()).toBe('10.00');
    expect(parts[0]?.toString()).toBe('3.00');
    expect(parts[1]?.toString()).toBe('7.00');
  });

  it('refuses zero-weight allocation', () => {
    expect(() => Money.fromDecimalString('10.00').allocate(['0', '0'])).toThrow();
  });

  it('compares amounts correctly', () => {
    const a = Money.fromDecimalString('5.00');
    const b = Money.fromDecimalString('5.00');
    const c = Money.fromDecimalString('6.00');
    expect(a.eq(b)).toBe(true);
    expect(c.gt(a)).toBe(true);
    expect(a.gte(b)).toBe(true);
  });
});
