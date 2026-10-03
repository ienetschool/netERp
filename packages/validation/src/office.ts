import { z } from 'zod';
import { uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// Visitors (USER-FLOWS §18.1: register → check in → check out)
// ---------------------------------------------------------------------------

export const visitorCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  name: z.string().trim().min(1, 'Visitor name is required').max(160),
  companyName: z.string().trim().max(160).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().nullish(),
  hostEmployeeId: uuidSchema.nullish(),
  purpose: z.string().trim().max(500).nullish(),
});

export const visitorCheckInSchema = z.object({
  purpose: z.string().trim().max(500).nullish(),
});

export const visitorCheckOutSchema = z.object({
  notes: z.string().trim().max(500).nullish(),
});

// ---------------------------------------------------------------------------
// Call log
// ---------------------------------------------------------------------------

export const callCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  callerName: z.string().trim().min(1, 'Caller name is required').max(160),
  callerPhone: z.string().trim().max(40).nullish(),
  recipientEmployeeId: uuidSchema.nullish(),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  notes: z.string().trim().max(2000).nullish(),
  callTime: z.coerce.date().nullish(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('INBOUND'),
});

export const callCompleteSchema = z.object({
  notes: z.string().trim().max(2000).nullish(),
});

// ---------------------------------------------------------------------------
// Correspondence (USER-FLOWS §18.2: register → number → attach → assign → close)
// ---------------------------------------------------------------------------

export const correspondenceCreateSchema = z
  .object({
    companyId: uuidSchema,
    branchId: uuidSchema.nullish(),
    direction: z.enum(['INCOMING', 'OUTGOING', 'INTERNAL']),
    correspondenceType: z.enum(['LETTER', 'EMAIL', 'FAX', 'PARCEL', 'OTHER']).default('LETTER'),
    sender: z.string().trim().min(1, 'Sender is required').max(160),
    recipient: z.string().trim().min(1, 'Recipient is required').max(160),
    subject: z.string().trim().min(1, 'Subject is required').max(200),
    receivedAt: z.coerce.date().nullish(),
    sentAt: z.coerce.date().nullish(),
    documentId: uuidSchema.nullish(),
  })
  .refine(
    (v) => (v.direction === 'INCOMING' ? v.receivedAt != null : true),
    { message: 'Incoming correspondence requires a received date', path: ['receivedAt'] },
  )
  .refine(
    (v) => (v.direction === 'OUTGOING' ? v.sentAt != null : true),
    { message: 'Outgoing correspondence requires a sent date', path: ['sentAt'] },
  );

export const correspondenceAssignSchema = z.object({
  assignedTo: uuidSchema,
});

// ---------------------------------------------------------------------------
// File room (USER-FLOWS §18.3: register → classify → locate → issue → return)
// ---------------------------------------------------------------------------

export const fileCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  title: z.string().trim().min(1, 'Title is required').max(200),
  category: z.string().trim().max(80).nullish(),
  locationCode: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const fileIssueSchema = z.object({
  issuedToEmployeeId: uuidSchema,
  dueAt: z.coerce.date().nullish(),
  note: z.string().trim().max(500).nullish(),
});

export const fileReturnSchema = z.object({
  note: z.string().trim().max(500).nullish(),
});

export const fileArchiveSchema = z.object({
  note: z.string().trim().max(500).nullish(),
});

export type VisitorCreateInput = z.infer<typeof visitorCreateSchema>;
export type CallCreateInput = z.infer<typeof callCreateSchema>;
export type CorrespondenceCreateInput = z.infer<typeof correspondenceCreateSchema>;
export type FileCreateInput = z.infer<typeof fileCreateSchema>;
