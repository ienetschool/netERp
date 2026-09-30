import { z } from 'zod';
import { dateOnlySchema } from './common.js';

const codeSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/, 'Code may contain letters, numbers, dash and underscore');

export const createCompanySchema = z.object({
  code: codeSchema,
  name: z.string().min(2).max(200),
  legalName: z.string().max(200).optional(),
  registrationNumber: z.string().max(80).optional(),
  taxNumber: z.string().max(80).optional(),
  timezone: z.string().max(64).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  website: z.string().max(200).optional(),
  baseCurrencyId: z.string().uuid().optional(),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export const createBranchSchema = z.object({
  companyId: z.string().uuid(),
  code: codeSchema,
  name: z.string().min(2).max(200),
  type: z.string().max(40).optional(),
  timezone: z.string().max(64).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
});

export const updateBranchSchema = createBranchSchema.partial().omit({ companyId: true });

export const createDepartmentSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  code: codeSchema,
  name: z.string().min(2).max(200),
});

export const updateDepartmentSchema = createDepartmentSchema
  .partial()
  .omit({ companyId: true, branchId: true });

export const createCostCenterSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  code: codeSchema,
  name: z.string().min(2).max(200),
  description: z.string().max(500).optional(),
});

export const createWarehouseSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid(),
  code: codeSchema,
  name: z.string().min(2).max(200),
  type: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
});

export const createWarehouseLocationSchema = z.object({
  warehouseId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  code: codeSchema,
  name: z.string().min(2).max(200),
  locationType: z.string().max(40).optional(),
});

export const financialPeriodSchema = z.object({
  companyId: z.string().uuid(),
  fiscalYear: z.number().int().min(2000).max(2100),
  periodNo: z.number().int().min(1).max(13),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
});

export type CreateCompanyDto = z.infer<typeof createCompanySchema>;
export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>;
export type CreateBranchDto = z.infer<typeof createBranchSchema>;
export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;
export type CreateCostCenterDto = z.infer<typeof createCostCenterSchema>;
export type CreateWarehouseDto = z.infer<typeof createWarehouseSchema>;
export type CreateWarehouseLocationDto = z.infer<typeof createWarehouseLocationSchema>;
