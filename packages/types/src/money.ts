import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/**
 * Exact-decimal monetary value. All financial arithmetic in the ERP MUST go
 * through this type (DATA-MODEL.md §31, ARCHITECTURE.md §36 — no binary
 * floating point for authoritative amounts).
 */
export class Money {
  private constructor(private readonly value: Decimal) {
    Object.freeze(this);
  }

  static fromDecimalString(input: string): Money {
    if (!/^-?\d+(\.\d+)?$/.test(input)) {
      throw new Error(`Invalid monetary amount: ${input}`);
    }
    return new Money(new Decimal(input));
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  static ofIntegerUnits(units: number): Money {
    return new Money(new Decimal(units));
  }

  plus(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  minus(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  multiplyByFactor(factor: string | number): Money {
    return new Money(this.value.mul(new Decimal(factor)));
  }

  allocate(weights: string[]): Money[] {
    const totalWeight = weights.reduce((acc, w) => acc.plus(new Decimal(w)), new Decimal(0));
    if (totalWeight.isZero()) {
      throw new Error('Cannot allocate by a total weight of zero');
    }
    const raw = weights.map((w) => this.value.mul(new Decimal(w)).div(totalWeight));
    // Largest-remainder allocation so parts always sum exactly to the total.
    const rounded = raw.map((r) => r.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    let diff = this.value.minus(rounded.reduce((acc, r) => acc.plus(r), new Decimal(0)));
    const order = raw
      .map((r, i) => ({ i, frac: r.minus(rounded[i] as Decimal).abs() }))
      .sort((a, b) => b.frac.minus(a.frac).toNumber());
    let idx = 0;
    while (!diff.isZero() && order.length > 0) {
      const target = order[idx % order.length] as { i: number };
      const step = diff.isNegative() ? new Decimal(-0.01) : new Decimal(0.01);
      rounded[target.i] = (rounded[target.i] as Decimal).plus(step);
      diff = diff.minus(step);
      idx++;
    }
    return rounded.map((r) => new Money(r));
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  gt(other: Money): boolean {
    return this.value.gt(other.value);
  }

  gte(other: Money): boolean {
    return this.value.gte(other.value);
  }

  lt(other: Money): boolean {
    return this.value.lt(other.value);
  }

  lte(other: Money): boolean {
    return this.value.lte(other.value);
  }

  mul(other: Money): Money {
    return new Money(this.value.mul(other.value));
  }

  /** Exact-decimal division at the configured precision (28 significant digits). */
  div(other: Money): Money {
    if (other.value.isZero()) throw new Error('Division by zero');
    return new Money(this.value.div(other.value));
  }

  abs(): Money {
    return new Money(this.value.abs());
  }

  eq(other: Money): boolean {
    return this.value.eq(other.value);
  }

  /** Canonical string for DTOs and database NUMERIC columns. */
  toString(): string {
    return this.value.toFixed(2, Decimal.ROUND_HALF_UP);
  }

  /** Presentation only — never for authoritative math. */
  toNumber(): number {
    return this.value.toNumber();
  }
}

export function sumMoney(values: Money[]): Money {
  return values.reduce((acc, v) => acc.plus(v), Money.zero());
}
