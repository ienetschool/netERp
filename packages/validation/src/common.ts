import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date format YYYY-MM-DD');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');

export const moneyStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Amount must be a decimal string, e.g. "1234.50"');

export type PaginationQuery = z.infer<typeof paginationSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
