import { describe, expect, it } from 'vitest';
import { PermissionSet, allPermissionKeys, permissionKey } from '../src/index.js';

describe('PermissionSet', () => {
  it('matches exact keys', () => {
    const set = new PermissionSet(['procurement.purchase_order.view']);
    expect(set.has('procurement.purchase_order.view')).toBe(true);
    expect(set.has('procurement.purchase_order.approve')).toBe(false);
  });

  it('supports module wildcards', () => {
    const set = new PermissionSet(['procurement.*']);
    expect(set.has('procurement.purchase_order.approve')).toBe(true);
    expect(set.has('inventory.stock.view')).toBe(false);
  });

  it('supports resource wildcards', () => {
    const set = new PermissionSet(['procurement.purchase_order.*']);
    expect(set.has('procurement.purchase_order.approve')).toBe(true);
    expect(set.has('procurement.goods_receipt.view')).toBe(false);
  });

  it('supports the platform wildcard', () => {
    const set = new PermissionSet(['*']);
    expect(set.has('accounting.journal.post')).toBe(true);
  });

  it('evaluates any/all combinations', () => {
    const set = new PermissionSet(['a.b.view', 'a.b.edit']);
    expect(set.hasAny(['a.b.view', 'a.b.delete'])).toBe(true);
    expect(set.hasAll(['a.b.view', 'a.b.delete'])).toBe(false);
    expect(set.hasAll(['a.b.view', 'a.b.edit'])).toBe(true);
  });
});

describe('permission catalog', () => {
  it('builds the full catalog without duplicates', () => {
    const keys = allPermissionKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(500);
  });

  it('round-trips key parsing', () => {
    const key = permissionKey('hr', 'employee', 'view');
    expect(key).toBe('hr.employee.view');
  });
});
