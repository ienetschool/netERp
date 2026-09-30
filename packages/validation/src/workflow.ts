import { z } from 'zod';
import { uuidSchema, moneyStringSchema } from './common.js';

export const workflowStateSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_]+$/, 'State codes are UPPER_SNAKE_CASE'),
  name: z.string().min(1).max(100),
  isInitial: z.boolean().default(false),
  isTerminal: z.boolean().default(false),
});

export const workflowAmountRuleSchema = z.object({
  minAmount: moneyStringSchema.optional(),
  maxAmount: moneyStringSchema.optional(),
  approverType: z.enum(['USER', 'ROLE']),
  approverId: uuidSchema,
});

export const workflowTransitionInputSchema = z.object({
  from: z.string().min(1).max(50),
  to: z.string().min(1).max(50),
  action: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, 'Actions are lower_snake_case'),
  approverType: z.enum(['USER', 'ROLE']).optional(),
  approverId: uuidSchema.optional(),
  /** Optional amount-threshold bands; first match wins, [min, max) semantics. */
  amountRules: z.array(workflowAmountRuleSchema).min(1).optional(),
  /** Entity field supplying the amount when amountRules are declared. */
  amountField: z.string().min(1).max(50).optional(),
});

export const workflowDefinitionSchema = z.object({
  companyId: uuidSchema.nullish(),
  name: z.string().min(1).max(150),
  entityType: z.string().min(1).max(50),
  states: z.array(workflowStateSchema).min(2, 'At least two states are required'),
  transitions: z.array(workflowTransitionInputSchema).min(1, 'At least one transition is required'),
});

export const workflowStartSchema = z.object({
  entityType: z.string().min(1).max(50),
  entityId: uuidSchema,
  companyId: uuidSchema.nullish(),
});

export const workflowTransitionSchema = z.object({
  action: z.string().min(1).max(50),
  /** Decimal-string amount of the underlying entity (for threshold routing). */
  amount: moneyStringSchema.optional(),
});

export const workflowActSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'CANCEL']),
    comments: z.string().max(2000).optional(),
    rejectionReason: z.string().max(2000).optional(),
    /** Entity amount, threaded to the next step's threshold routing. */
    amount: moneyStringSchema.optional(),
  })
  .refine((v) => v.decision !== 'REJECT' || !!v.rejectionReason, {
    message: 'A rejection reason is required',
    path: ['rejectionReason'],
  });

export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowActInput = z.infer<typeof workflowActSchema>;
