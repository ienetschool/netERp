import { z } from 'zod';
import { uuidSchema, dateOnlySchema } from './common.js';

// ---------------------------------------------------------------------------
// Reporting (DATA-MODEL §23, USER-FLOWS §21)
// ---------------------------------------------------------------------------

/**
 * Filters supported by the report engine (UI-UX §21: date range, company,
 * branch, department, warehouse, cost center). Every field is optional; the
 * engine rejects any filter a given report does not declare, so a caller can
 * never widen a report's own scope by passing an unknown filter.
 */
export const reportFiltersSchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    companyId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
    departmentId: uuidSchema.optional(),
    warehouseId: uuidSchema.optional(),
    costCenterId: uuidSchema.optional(),
    status: z.string().trim().max(40).optional(),
    customerId: uuidSchema.optional(),
    supplierId: uuidSchema.optional(),
    productId: uuidSchema.optional(),
  })
  .strict()
  // A date range must not run backwards. Enforced here so every consumer of
  // the filters (run, drill-down, export, saved, scheduled) inherits it.
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export const reportSortingSchema = z
  .object({
    field: z.string().trim().min(1).max(60),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

// Kept as a plain object schema (not a refined ZodEffects) so the drill-down
// schema below can extend it.
const reportRunShape = z
  .object({
    filters: reportFiltersSchema.optional(),
    grouping: z.array(z.string().trim().min(1).max(60)).max(4).default([]),
    sorting: reportSortingSchema.nullish(),
    columns: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
  })
  .strict();

export const reportRunSchema = reportRunShape;

/**
 * Drill-down reuses the run shape and adds the group being expanded. It is a
 * separate schema rather than a field on `reportRunSchema` so a plain run can
 * never smuggle a groupKey through.
 */
export const reportDrillDownSchema = reportRunShape.extend({
  groupKey: z.record(z.string().trim().min(1).max(60), z.string().max(200)).default({}),
});

export const reportExportCreateSchema = z.object({
  reportDefinitionId: uuidSchema,
  format: z.enum(['CSV', 'JSON']).default('CSV'),
  filters: reportFiltersSchema.optional(),
});

// ---- Saved report configuration -------------------------------------------

export const savedReportCreateSchema = z.object({
  reportDefinitionId: uuidSchema,
  name: z.string().trim().min(1, 'Name is required').max(160),
  filters: reportFiltersSchema.optional(),
  columns: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  sorting: reportSortingSchema.nullish(),
  grouping: z.array(z.string().trim().min(1).max(60)).max(4).default([]),
});

// ---- Scheduled reports ----------------------------------------------------

/**
 * Schedules are structured rather than raw cron so the worker can compute the
 * next run deterministically and a caller cannot inject an arbitrary spec.
 */
export const reportScheduleSpecSchema = z
  .object({
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected 24h time HH:mm'),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
  })
  .strict()
  .refine((v) => v.frequency !== 'WEEKLY' || v.dayOfWeek !== undefined, {
    message: 'dayOfWeek is required for WEEKLY schedules',
    path: ['dayOfWeek'],
  })
  .refine((v) => v.frequency !== 'MONTHLY' || v.dayOfMonth !== undefined, {
    message: 'dayOfMonth is required for MONTHLY schedules',
    path: ['dayOfMonth'],
  });

export const scheduledReportCreateSchema = z
  .object({
    reportDefinitionId: uuidSchema,
    schedule: reportScheduleSpecSchema,
    timezone: z.string().trim().min(1).max(60).default('UTC'),
    filters: reportFiltersSchema.optional(),
    outputFormat: z.enum(['CSV', 'JSON']).default('CSV'),
    deliveryChannel: z.enum(['IN_APP', 'EMAIL']).default('IN_APP'),
    recipientConfiguration: z
      .object({
        userIds: z.array(uuidSchema).max(25).default([]),
        emails: z.array(z.string().trim().email()).max(25).default([]),
      })
      .strict()
      .default({ userIds: [], emails: [] }),
  })
  .strict();

export const scheduledReportStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'DISABLED']),
});

export type ReportFilters = z.infer<typeof reportFiltersSchema>;
export type ReportRunInput = z.infer<typeof reportRunSchema>;
export type ReportDrillDownInput = z.infer<typeof reportDrillDownSchema>;
export type ReportExportCreateInput = z.infer<typeof reportExportCreateSchema>;
export type SavedReportCreateInput = z.infer<typeof savedReportCreateSchema>;
export type ReportScheduleSpec = z.infer<typeof reportScheduleSpecSchema>;
export type ScheduledReportCreateInput = z.infer<typeof scheduledReportCreateSchema>;
