import { z } from 'zod';
import { uuidSchema } from './common.js';

export const settingValueTypeSchema = z.enum(['string', 'number', 'boolean', 'json']);

export const settingUpsertSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_.]+$/, 'Keys are lower_snake_case, optionally dotted'),
  value: z.unknown(),
  valueType: settingValueTypeSchema,
  companyId: uuidSchema.nullish(),
  description: z.string().max(500).optional(),
});

export type SettingUpsertInput = z.infer<typeof settingUpsertSchema>;
