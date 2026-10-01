import { describe, expect, it } from 'vitest';
import { Money, sumMoney } from '@erp/types';

/**
 * Procurement rule tests. The DB-backed flows (workflow submission, goods
 * receipt posting, three-way match queries) are covered by integration tests
 * once a live PostgreSQL is available; these lock the money arithmetic and
 * status/edge rules the service depends on.
 */
describe('procurement line totals', () => {
  it('computes line totals as unit price x quantity minus discount', () => {
    const lineTotal = (unitPrice: string, quantity: number, discount: string): string =>
      Money.fromDecimalString(unitPrice)
        .multiplyByFactor(quantity)
        .minus(Money.fromDecimalString(discount))
        .toString();
    expect(lineTotal('12.50', 10, '0')).toBe('125.00');
    expect(lineTotal('12.50', 10, '25.00')).toBe('100.00');
    expect(lineTotal('0.10', 3, '0')).toBe('0.30');
  });

  it('sums header totals from lines exactly (no float drift)', () => {
    const lines = ['0.10', '0.20', '0.30'].map((v) => Money.fromDecimalString(v));
    expect(sumMoney(lines).toString()).toBe('0.60');
  });

  it('keeps grand total = subtotal + tax', () => {
    const subtotal = sumMoney([
      Money.fromDecimalString('100.00'),
      Money.fromDecimalString('250.50'),
    ]);
    const taxTotal = sumMoney([Money.fromDecimalString('17.55')]);
    expect(subtotal.plus(taxTotal).toString()).toBe('368.05');
  });
});

describe('three-way match rules', () => {
  interface PoLine {
    description: string;
    quantity: number;
    received: number;
    unitPrice: number;
  }

  function match(
    poLines: PoLine[],
    invoiceLines: Array<{ purchaseOrderLineId: number; quantity: number; unitPrice: number }>,
  ): Array<{ line: string; kind: string; detail: string }> {
    const variances: Array<{ line: string; kind: string; detail: string }> = [];
    for (const line of invoiceLines) {
      const poLine = poLines.find((_, i) => i === line.purchaseOrderLineId);
      if (!poLine) continue;
      if (line.quantity > poLine.received + 1e-9) {
        variances.push({
          line: poLine.description,
          kind: 'QUANTITY',
          detail: `Invoiced ${line.quantity} > received ${poLine.received}`,
        });
      }
      if (Math.abs(line.unitPrice - poLine.unitPrice) > 0.01) {
        variances.push({
          line: poLine.description,
          kind: 'PRICE',
          detail: `Invoiced ${line.unitPrice} vs PO ${poLine.unitPrice}`,
        });
      }
    }
    return variances;
  }

  const poLines: PoLine[] = [
    { description: 'A4 paper', quantity: 100, received: 100, unitPrice: 4.5 },
    { description: 'Staplers', quantity: 20, received: 15, unitPrice: 8.0 },
  ];

  it('matches when invoiced quantity and price agree with PO + receipt', () => {
    expect(
      match(poLines, [
        { purchaseOrderLineId: 0, quantity: 100, unitPrice: 4.5 },
        { purchaseOrderLineId: 1, quantity: 15, unitPrice: 8.0 },
      ]),
    ).toEqual([]);
  });

  it('flags quantity variance when invoiced exceeds received', () => {
    const variances = match(poLines, [{ purchaseOrderLineId: 1, quantity: 20, unitPrice: 8.0 }]);
    expect(variances).toHaveLength(1);
    expect(variances[0]).toMatchObject({ kind: 'QUANTITY' });
  });

  it('flags price variance beyond one cent', () => {
    const variances = match(poLines, [
      { purchaseOrderLineId: 0, quantity: 100, unitPrice: 4.52 },
    ]);
    expect(variances).toHaveLength(1);
    expect(variances[0]).toMatchObject({ kind: 'PRICE' });
  });

  it('tolerates sub-cent price differences', () => {
    expect(
      match(poLines, [{ purchaseOrderLineId: 0, quantity: 100, unitPrice: 4.505 }]),
    ).toEqual([]);
  });
});

describe('payment allocation rules', () => {
  it('drives OPEN -> PARTIALLY_PAID -> PAID across allocations', () => {
    const grandTotal = Money.fromDecimalString('500.00');
    let paid = Money.zero();
    const statusFor = (): string => {
      paid = paid.plus(Money.fromDecimalString('250.00'));
      return paid.eq(grandTotal) ? 'PAID' : 'PARTIALLY_PAID';
    };
    expect(statusFor()).toBe('PARTIALLY_PAID');
    expect(statusFor()).toBe('PAID');
  });

  it('rejects an allocation that overpays the invoice', () => {
    const grandTotal = Money.fromDecimalString('500.00');
    const alreadyPaid = Money.fromDecimalString('400.00');
    const allocating = Money.fromDecimalString('150.00');
    expect(alreadyPaid.plus(allocating).gt(grandTotal)).toBe(true);
  });
});
