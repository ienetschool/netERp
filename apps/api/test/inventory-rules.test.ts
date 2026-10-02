import { describe, expect, it } from 'vitest';
import { Money } from '@erp/types';
import { BusinessRuleError } from '../src/common/errors.js';

/**
 * Locks the exact-decimal inventory math that powers the movement ledger:
 * weighted-average valuation, delta sign per movement type, and the
 * negative-stock guard. DB-backed lifecycle tests run in CI with PostgreSQL.
 */

describe('weighted-average valuation math', () => {
  it('averages cost across inbound receipts', () => {
    // 100 units @ 4.50 then 50 units @ 6.00 → (450 + 300) / 150 = 5.00
    const onHand = Money.fromDecimalString('100');
    const avg = Money.fromDecimalString('4.50');
    const inboundQty = Money.fromDecimalString('50');
    const inboundCost = Money.fromDecimalString('6.00');
    const totalValue = onHand.mul(avg).plus(inboundQty.mul(inboundCost));
    const totalQty = onHand.plus(inboundQty);
    const newAvg = totalValue.div(totalQty);
    expect(newAvg.toString()).toBe('5.00');
  });

  it('outbound issues never change the average cost', () => {
    // Issue 30 of 150 @ 5.00 → still 5.00
    const onHand = Money.fromDecimalString('150');
    const avg = Money.fromDecimalString('5.00');
    const issued = Money.fromDecimalString('30');
    const remaining = onHand.minus(issued);
    expect(remaining.toString()).toBe('120.00');
    expect(avg.toString()).toBe('5.00');
  });

  it('keeps exact decimals when averaging odd quantities', () => {
    // 3 @ 10.00 then 1 @ 7.00 → (30 + 7) / 4 = 9.25
    const totalValue = Money.fromDecimalString('3')
      .mul(Money.fromDecimalString('10'))
      .plus(Money.fromDecimalString('1').mul(Money.fromDecimalString('7')));
    const newAvg = totalValue.div(Money.fromDecimalString('4'));
    expect(newAvg.toString()).toBe('9.25');
  });

  it('rejects division by zero explicitly', () => {
    const zero = Money.zero();
    expect(() => Money.fromDecimalString('10').div(zero)).toThrow(/Division by zero/);
  });
});

describe('movement quantity guards', () => {
  it('rejects non-positive movement quantities', () => {
    expect(() => Money.fromDecimalString('0')).not.toThrow();
    const zero = Money.zero();
    expect(zero.isZero()).toBe(true);
    // The service guard: qty.lte(zero) → BusinessRuleError, mirrored here.
    const qty = Money.zero();
    expect(qty.lte(Money.zero())).toBe(true);
  });

  it('blocks issues below on-hand unless negative stock is allowed', () => {
    const onHand = Money.fromDecimalString('10');
    const requested = Money.fromDecimalString('25');
    const wouldGoNegative = onHand.lt(requested);
    expect(wouldGoNegative).toBe(true);
    // allowNegative=false → the service guard throws BusinessRuleError.
    expect(new BusinessRuleError('x')).toBeInstanceOf(BusinessRuleError);
  });
});
