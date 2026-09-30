import { describe, expect, it } from 'vitest';
import { loginSchema, changePasswordSchema } from '../src/auth.js';
import { moneyStringSchema, paginationSchema } from '../src/common.js';
import { createBranchSchema } from '../src/organization.js';

describe('loginSchema', () => {
  it('accepts a valid login', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'password123' });
    expect(result.success).toBe(true);
  });

  it('rejects bad email and short passwords', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'password123' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'user@example.com', password: 'short' }).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('enforces complexity', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'password123', newPassword: 'SimplePass1' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'password123', newPassword: 'ComplexPass1!' }).success).toBe(true);
  });
});

describe('moneyStringSchema', () => {
  it('accepts decimal strings only', () => {
    expect(moneyStringSchema.safeParse('1234.50').success).toBe(true);
    expect(moneyStringSchema.safeParse('-10.25').success).toBe(true);
    expect(moneyStringSchema.safeParse('1,234.50').success).toBe(false);
    expect(moneyStringSchema.safeParse('12.5.1').success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it('applies defaults and bounds', () => {
    const parsed = paginationSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ pageSize: 5000 }).success).toBe(false);
  });
});

describe('createBranchSchema', () => {
  it('requires a UUID company and code format', () => {
    const ok = createBranchSchema.safeParse({
      companyId: '4b2f0d3e-1c2b-4a4d-9f0a-2b3c4d5e6f70',
      code: 'HQ-1',
      name: 'Headquarters',
    });
    expect(ok.success).toBe(true);
    const bad = createBranchSchema.safeParse({ companyId: 'not-a-uuid', code: 'HQ', name: 'HQ' });
    expect(bad.success).toBe(false);
  });
});
