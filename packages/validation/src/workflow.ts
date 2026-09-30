import { z } from 'zod';
import { uuidSchema } from './common.js';

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
});

export const workflowActSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'CANCEL']),
    comments: z.string().max(2000).optional(),
    rejectionReason: z.string().max(2000).optional(),
  })
  .refine((v) => v.decision !== 'REJECT' || !!v.rejectionReason, {
    message: 'A rejection reason is required',
    path: ['rejectionReason'],
  });

export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowActInput = z.infer<typeof workflowActSchema>;
