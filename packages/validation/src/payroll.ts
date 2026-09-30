import { z } from 'zod';
import { dateOnlySchema, moneyStringSchema, uuidSchema } from './common.js';

export const payFrequencySchema = z.enum(['MONTHLY', 'SEMI_MONTHLY', 'BI_WEEKLY', 'WEEKLY']);

export const payDayRuleSchema = z.enum(['LAST_DAY_OF_MONTH', 'FIXED_DAY', 'NEAREST_WORKING_DAY']);

export const payGroupCreateSchema = z.object({
  companyId: uuidSchema,
  name: z.string().min(1).max(120),
  frequency: payFrequencySchema,
  currencyId: uuidSchema,
  payDayRule: payDayRuleSchema.default('LAST_DAY_OF_MONTH'),
  /** Day of month for FIXED_DAY; ignored by other rules. */
  payDayValue: z.number().int().min(1).max(31).optional(),
});

export const salaryComponentInputSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(30)
      .regex(/^[A-Z0-9_]+$/, 'Component codes are UPPER_SNAKE_CASE'),
    name: z.string().min(1).max(120),
    type: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION']),
    calculationMethod: z.enum(['FLAT', 'PERCENT_OF_BASE']),
    /** FLAT amount as a decimal string. */
    value: moneyStringSchema.optional(),
    /** Percent of base salary (0-100) as a decimal string. */
    percentage: moneyStringSchema.optional(),
    accountId: uuidSchema.nullish(),
    taxable: z.boolean().default(true),
  })
  .refine(
    (c) => (c.calculationMethod === 'FLAT' ? c.value !== undefined : c.percentage !== undefined),
    {
      message: 'FLAT components require value; PERCENT_OF_BASE components require percentage',
    },
  );

export const salaryStructureCreateSchema = z.object({
  companyId: uuidSchema,
  name: z.string().min(1).max(120),
  currencyId: uuidSchema,
  components: z.array(salaryComponentInputSchema).min(1, 'At least one component is required'),
});

export const salaryAssignmentCreateSchema = z.object({
  employeeId: uuidSchema,
  salaryStructureId: uuidSchema,
  effectiveFrom: dateOnlySchema,
  baseSalary: moneyStringSchema,
});

export const payrollRunCreateSchema = z
  .object({
    companyId: uuidSchema,
    branchId: uuidSchema.nullish(),
    payGroupId: uuidSchema,
    periodStart: dateOnlySchema,
    periodEnd: dateOnlySchema,
    paymentDate: dateOnlySchema,
  })
  .refine((r) => new Date(r.periodEnd) >= new Date(r.periodStart), {
    message: 'Period end is before period start',
    path: ['periodEnd'],
  });

export const payrollRunListSchema = z.object({
  status: z
    .enum([
      'DRAFT',
      'CALCULATING',
      'CALCULATED',
      'PENDING_APPROVAL',
      'APPROVED',
      'POSTED',
      'PAID',
      'CANCELLED',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type PayGroupCreateInput = z.infer<typeof payGroupCreateSchema>;
export type SalaryStructureCreateInput = z.infer<typeof salaryStructureCreateSchema>;
export type SalaryAssignmentCreateInput = z.infer<typeof salaryAssignmentCreateSchema>;
export type PayrollRunCreateInput = z.infer<typeof payrollRunCreateSchema>;
export type PayrollRunListInput = z.infer<typeof payrollRunListSchema>;
