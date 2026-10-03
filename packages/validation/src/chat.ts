import { z } from 'zod';
import { uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// Chat (DATA-MODEL §22: conversations / participants / messages)
// ---------------------------------------------------------------------------

export const conversationCreateSchema = z
  .object({
    companyId: uuidSchema,
    type: z.enum(['DIRECT', 'GROUP']).default('GROUP'),
    name: z.string().trim().max(160).nullish(),
    participantUserIds: z.array(uuidSchema).min(1, 'At least one participant is required').max(50),
  })
  .refine((v) => (v.type === 'GROUP' ? v.name != null && v.name.length > 0 : true), {
    message: 'Group conversations require a name',
    path: ['name'],
  });

export const messageSendSchema = z.object({
  content: z.string().trim().min(1, 'Message content is required').max(4000),
  documentId: uuidSchema.nullish(),
});

export const addParticipantSchema = z.object({
  userId: uuidSchema,
});

export const markReadSchema = z.object({});

export type ConversationCreateInput = z.infer<typeof conversationCreateSchema>;
export type MessageSendInput = z.infer<typeof messageSendSchema>;
export type AddParticipantInput = z.infer<typeof addParticipantSchema>;
