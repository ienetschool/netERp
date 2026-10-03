import { z } from 'zod';
import { dateOnlySchema, moneyStringSchema, uuidSchema } from './common.js';

// ---- Chart of accounts --------------------------------------------------------

export const accountTypeSchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
]);

export const normalBalanceSchema = z.enum(['DEBIT', 'CREDIT']);

export const accountCreateSchema = z.object({
  companyId: uuidSchema,
  parentId: uuidSchema.nullish(),
  accountCode: z.string().min(1).max(20),
  accountName: z.string().min(1).max(200),
  accountType: accountTypeSchema,
  normalBalance: normalBalanceSchema,
  isControlAccount: z.boolean().default(false),
  isPostable: z.boolean().default(true),
});

export const accountUpdateSchema = z.object({
  accountName: z.string().min(1).max(200).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  isPostable: z.boolean().optional(),
});

// ---- Journals -------------------------------------------------------------------

export const journalTypeSchema = z.enum([
  'GENERAL',
  'SALES',
  'PURCHASE',
  'CASH',
  'BANK',
  'PAYROLL',
  'INVENTORY',
  'ASSET',
  'TAX',
  'ADJUSTMENT',
  'REVERSAL',
]);

export const journalLineSchema = z
  .object({
    accountId: uuidSchema,
    description: z.string().max(300).optional(),
    debit: moneyStringSchema.optional(),
    credit: moneyStringSchema.optional(),
    currencyId: uuidSchema.nullish(),
    exchangeRate: z.string().max(30).nullish(),
    customerId: uuidSchema.nullish(),
    supplierId: uuidSchema.nullish(),
    employeeId: uuidSchema.nullish(),
    productId: uuidSchema.nullish(),
    departmentId: uuidSchema.nullish(),
    costCenterId: uuidSchema.nullish(),
  })
  .refine(
    (l) => {
      const d = Number(l.debit ?? '0');
      const c = Number(l.credit ?? '0');
      return (d > 0) !== (c > 0) && d >= 0 && c >= 0;
    },
    { message: 'Each line needs exactly one of debit or credit greater than zero' },
  );

export const journalCreateSchema = z
  .object({
    companyId: uuidSchema,
    branchId: uuidSchema.nullish(),
    journalDate: dateOnlySchema,
    journalType: journalTypeSchema.default('GENERAL'),
    description: z.string().max(500).optional(),
    sourceType: z.string().max(60).nullish(),
    sourceId: uuidSchema.nullish(),
    sourceDocumentNo: z.string().max(60).nullish(),
    lines: z.array(journalLineSchema).min(2, 'A journal needs at least two lines'),
  })
  .refine(
    (j) => {
      const debits = j.lines.reduce((acc, l) => acc + Number(l.debit ?? '0'), 0);
      const credits = j.lines.reduce((acc, l) => acc + Number(l.credit ?? '0'), 0);
      return Math.abs(debits - credits) < 0.005;
    },
    { message: 'Journal debits and credits must balance' },
  );

export const journalSubmitSchema = z.object({
  /** Amount override for threshold-based approval routing; defaults to total debits. */
  amount: moneyStringSchema.optional(),
});

export const journalReverseSchema = z.object({
  reason: z.string().min(3).max(500),
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type JournalCreateInput = z.infer<typeof journalCreateSchema>;
