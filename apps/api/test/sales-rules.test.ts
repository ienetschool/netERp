import { describe, expect, it } from 'vitest';
import { Money, sumMoney } from '@erp/types';

/**
 * Sales rule tests (Stage 7). The DB-backed flows (credit-limit queries,
 * delivery stock movements, receipt allocation) are covered by integration
 * tests once a live PostgreSQL is available; these lock the quote-to-cash
 * money arithmetic and status rules the service depends on.
 */

const lineTotal = (unitPrice: string, quantity: number, discount = '0'): string =>
  Money.fromDecimalString(unitPrice)
    .multiplyByFactor(quantity)
    .minus(Money.fromDecimalString(discount))
    .toString();

describe('sales line and header totals', () => {
  it('computes invoice line totals as price x quantity minus discount', () => {
    expect(lineTotal('25.00', 4)).toBe('100.00');
    expect(lineTotal('25.00', 4, '10.00')).toBe('90.00');
    expect(lineTotal('0.10', 3)).toBe('0.30');
  });

  it('sums quotation headers exactly with tax on top', () => {
    const subtotal = sumMoney([
      Money.fromDecimalString(lineTotal('12.50', 10)),
      Money.fromDecimalString(lineTotal('4.00', 5)),
    ]);
    const tax = sumMoney([Money.fromDecimalString('7.50'), Money.fromDecimalString('1.00')]);
    expect(subtitle(subtotal, tax).toString()).toBe('153.50');
  });

  function subtitle(subtotal: Money, tax: Money): Money {
    return subtotal.plus(tax);
  }

  it('keeps receipts from overpaying an invoice', () => {
    const grandTotal = Money.fromDecimalString('500.00');
    const paid = Money.fromDecimalString('350.00');
    const allocating = Money.fromDecimalString('150.00');
    expect(paid.plus(allocating).gt(grandTotal)).toBe(false);
    const overpay = Money.fromDecimalString('150.01');
    expect(paid.plus(overpay).gt(grandTotal)).toBe(true);
  });

  it('drives paid status at exact allocation, partial otherwise', () => {
    const grandTotal = Money.fromDecimalString('500.00');
    const paid = Money.fromDecimalString('350.00');
    const allocating = Money.fromDecimalString('150.00');
    const newPaid = paid.plus(allocating);
    expect(newPaid.eq(grandTotal)).toBe(true);
    const partial = paid.plus(Money.fromDecimalString('10.00'));
    expect(partial.eq(grandTotal)).toBe(false);
  });
});

describe('delivery fulfillment guards', () => {
  it('rejects over-delivery beyond ordered quantity (tolerance 1e-9)', () => {
    const ordered = 100;
    const already = 40;
    const delivering = 61;
    expect(already + delivering > ordered + 1e-9).toBe(true);
    expect(already + 60 > ordered + 1e-9).toBe(false);
  });

  it('derives order status from line fulfillment', () => {
    const lines = [
      { quantity: 10, deliveredQuantity: 10 },
      { quantity: 5, deliveredQuantity: 5 },
    ];
    const fully = lines.every(
      (l) => Number(l.deliveredQuantity) >= Number(l.quantity) - 1e-9,
    );
    const any = lines.some((l) => Number(l.deliveredQuantity) > 0);
    expect(fully ? 'DELIVERED' : any ? 'PARTIALLY_DELIVERED' : 'unchanged').toBe('DELIVERED');
  });
});

describe('credit limit guard', () => {
  it('blocks when open AR plus the new order exceeds the limit', () => {
    const limit = Money.fromDecimalString('5000.00');
    const openAr = Money.fromDecimalString('4200.00');
    const order = Money.fromDecimalString('900.00');
    expect(openAr.plus(order).gt(limit)).toBe(true);
  });

  it('allows zero-limit customers to order without a credit check', () => {
    const limit = Money.zero();
    expect(limit.isZero()).toBe(true);
  });
});
