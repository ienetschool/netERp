import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { NotFoundError, BusinessRuleError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { NotificationsService } from '../platform/notifications.service.js';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import { messageSendSchema, addParticipantSchema } from '@erp/validation';
import type { z } from 'zod';

type Principal = RequestPrincipal;
type MessageSendInput = z.infer<typeof messageSendSchema>;
type AddParticipantInput = z.infer<typeof addParticipantSchema>;

const MESSAGE_PREVIEW_LENGTH = 110;

/** Only fields a chat surface needs from a user (no relation to User exists). */
const userDirectoryFields = {
  id: true,
  displayName: true,
  email: true,
} satisfies Prisma.UserSelect;

/** Users may be addressed when they hold a role in the company or an employee record there. */
function belongsToCompany(companyId: string): Prisma.UserWhereInput {
  return {
    OR: [{ roles: { some: { companyId } } }, { employee: { is: { companyId } } }],
  };
}

/**
 * Chat (PRD Stage 10; DATA-MODEL §22, USER-FLOWS §19.1).
 *
 * Flow per USER-FLOWS §19.1: create conversation → add participants → send
 * message → persist → create notification → update unread count.
 *
 * Access model: a conversation is visible only to its participants (membership
 * is checked before any read or write), and every conversation is additionally
 * company-scoped. Participants carry user ids only — DATA-MODEL §22 defines no
 * relation to User — so display names are resolved separately by the caller.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private scopeGuard(principal: Principal, companyId: string): void {
    if (principal.companyIds && !principal.companyIds.includes(companyId)) {
      throw new NotFoundError('Resource not found in your scope');
    }
  }

  /**
   * Loads a conversation and asserts the caller is a participant. Returns 404
   * (never 403) for non-members so conversation ids cannot be probed.
   */
  private async requireMembership(
    principal: Principal,
    conversationId: string,
  ): Promise<{ companyId: string; name: string | null; role: string; type: string }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, companyId: true, name: true, type: true },
    });
    if (!conversation) throw new NotFoundError('Conversation not found');
    this.scopeGuard(principal, conversation.companyId);

    const membership = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: principal.userId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundError('Conversation not found');

    return {
      companyId: conversation.companyId,
      name: conversation.name,
      role: membership.role,
      type: conversation.type,
    };
  }

  // ---- Conversations ------------------------------------------------------

  async createConversation(
    principal: Principal,
    input: {
      companyId: string;
      type: 'DIRECT' | 'GROUP';
      name?: string | null;
      participantUserIds: string[];
    },
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const me = principal.userId;

    const recipientIds = [...new Set(input.participantUserIds)];
    if (recipientIds.includes(me)) {
      throw new BusinessRuleError('You cannot add yourself as a participant');
    }
    if (input.type === 'DIRECT' && recipientIds.length !== 1) {
      throw new BusinessRuleError('A direct chat has exactly one recipient');
    }

    // Participants must be active users of this company.
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { in: recipientIds },
        status: 'ACTIVE',
        ...belongsToCompany(input.companyId),
      },
      select: userDirectoryFields,
    });
    if (candidates.length !== recipientIds.length) {
      throw new NotFoundError('One or more participants not found in your company');
    }

    // One direct chat per pair: return the existing one instead of duplicating.
    const directRecipientId = input.type === 'DIRECT' ? recipientIds[0] : undefined;
    if (directRecipientId) {
      const existing = await this.prisma.conversation.findFirst({
        where: {
          companyId: input.companyId,
          type: 'DIRECT',
          AND: [
            { participants: { some: { userId: me } } },
            { participants: { some: { userId: directRecipientId } } },
          ],
        },
        select: {
          id: true,
          companyId: true,
          type: true,
          name: true,
          createdById: true,
          lastMessageAt: true,
          createdAt: true,
          participants: { select: { userId: true, role: true } },
        },
      });
      const memberIds = existing?.participants.map((p) => p.userId) ?? [];
      if (existing && memberIds.length === 2) {
        return { ...existing, participants: existing.participants, reused: true };
      }
    }

    const conversation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          companyId: input.companyId,
          type: input.type,
          name: input.name ?? null,
          createdById: me,
          participants: {
            create: [
              { userId: me, role: 'OWNER' },
              ...recipientIds.map((userId) => ({ userId, role: 'MEMBER' })),
            ],
          },
        },
        select: {
          id: true,
          companyId: true,
          type: true,
          name: true,
          createdById: true,
          lastMessageAt: true,
          createdAt: true,
          participants: { select: { userId: true, role: true } },
        },
      });

      await this.audit.record(
        {
          actorUserId: me,
          action:
            input.type === 'DIRECT'
              ? 'communication.direct_created'
              : 'communication.group_created',
          resourceType: 'conversation',
          resourceId: created.id,
          companyId: input.companyId,
          requestId,
          metadata: { type: input.type, participantCount: recipientIds.length + 1 },
        },
        tx,
      );

      return created;
    });

    const conversationLabel = conversation.name ?? 'the conversation';
    for (const userId of recipientIds) {
      await this.notifications.notify({
        userId,
        companyId: input.companyId,
        type: 'COMMUNICATION_PARTICIPANT_ADDED',
        title: 'You were added to a conversation',
        message: conversationLabel,
        resourceType: 'conversation',
        resourceId: conversation.id,
        channels: ['IN_APP'],
      });
    }

    return { ...conversation, reused: false };
  }

  async listConversations(principal: Principal, query: { page: number; pageSize: number }) {
    const where: Prisma.ConversationWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      participants: { some: { userId: principal.userId } },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        select: {
          id: true,
          companyId: true,
          type: true,
          name: true,
          createdById: true,
          lastMessageAt: true,
          createdAt: true,
          participants: { select: { userId: true, role: true, lastReadAt: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              senderUserId: true,
              content: true,
              createdAt: true,
              messageType: true,
            },
          },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const conversations = await Promise.all(
      rows.map(async (row) => {
        const mine = row.participants.find((p) => p.userId === principal.userId);
        const since = mine?.lastReadAt ?? new Date(0);
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: row.id,
            senderUserId: { not: principal.userId },
            createdAt: { gt: since },
          },
        });
        return { ...row, unreadCount, lastReadAt: mine?.lastReadAt ?? null };
      }),
    );

    return { rows: conversations, total };
  }

  // ---- Messages -----------------------------------------------------------

  async listMessages(
    principal: Principal,
    conversationId: string,
    query: { page: number; pageSize: number },
  ) {
    await this.requireMembership(principal, conversationId);

    const where: Prisma.MessageWhereInput = { conversationId, deletedAt: null };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        select: {
          id: true,
          conversationId: true,
          senderUserId: true,
          messageType: true,
          content: true,
          documentId: true,
          createdAt: true,
          editedAt: true,
        },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.message.count({ where }),
    ]);
    return { rows, total };
  }

  async sendMessage(
    principal: Principal,
    conversationId: string,
    input: MessageSendInput,
    requestId: string | null,
  ) {
    const conversation = await this.requireMembership(principal, conversationId);
    const me = principal.userId;

    const message = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.message.create({
        data: {
          conversationId,
          senderUserId: me,
          messageType: 'TEXT',
          content: input.content,
          documentId: input.documentId ?? null,
        },
        select: {
          id: true,
          conversationId: true,
          senderUserId: true,
          messageType: true,
          content: true,
          documentId: true,
          createdAt: true,
          editedAt: true,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });

      await this.audit.record(
        {
          actorUserId: me,
          action: 'communication.message_sent',
          resourceType: 'message',
          resourceId: saved.id,
          companyId: conversation.companyId,
          requestId,
          metadata: { conversationId },
        },
        tx,
      );

      return saved;
    });

    // USER-FLOWS §19.1: persist → create notification → unread count follows
    // from each recipient's lastReadAt.
    const recipients = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: me } },
      select: { userId: true },
    });
    const preview =
      input.content.length > MESSAGE_PREVIEW_LENGTH
        ? `${input.content.slice(0, MESSAGE_PREVIEW_LENGTH)}…`
        : input.content;
    const label = conversation.name ?? 'the conversation';
    for (const { userId } of recipients) {
      await this.notifications.notify({
        userId,
        companyId: conversation.companyId,
        type: 'CHAT_MESSAGE',
        title: `New message in ${label}`,
        message: preview,
        resourceType: 'message',
        resourceId: message.id,
        channels: ['IN_APP'],
      });
    }

    return message;
  }

  // ---- Participants -------------------------------------------------------

  async addParticipant(
    principal: Principal,
    conversationId: string,
    input: AddParticipantInput,
    requestId: string | null,
  ) {
    const conversation = await this.requireMembership(principal, conversationId);
    if (conversation.type === 'DIRECT') {
      throw new BusinessRuleError('Participants cannot be added to a direct chat');
    }
    if (conversation.role !== 'OWNER') {
      throw new BusinessRuleError('Only the conversation owner can add participants');
    }

    const candidate = await this.prisma.user.findFirst({
      where: {
        id: input.userId,
        status: 'ACTIVE',
        ...belongsToCompany(conversation.companyId),
      },
      select: userDirectoryFields,
    });
    if (!candidate) throw new NotFoundError('Participant not found in your company');

    const already = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: input.userId } },
      select: { id: true },
    });
    if (already) throw new BusinessRuleError('User is already in this conversation');

    const participant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.conversationParticipant.create({
        data: { conversationId, userId: input.userId, role: 'MEMBER' },
        select: {
          id: true,
          conversationId: true,
          userId: true,
          role: true,
          lastReadAt: true,
          joinedAt: true,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'communication.participant_added',
          resourceType: 'conversation_participant',
          resourceId: created.id,
          companyId: conversation.companyId,
          requestId,
          metadata: { conversationId, addedUserId: input.userId },
        },
        tx,
      );
      return created;
    });

    await this.notifications.notify({
      userId: input.userId,
      companyId: conversation.companyId,
      type: 'COMMUNICATION_PARTICIPANT_ADDED',
      title: 'You were added to a conversation',
      message: conversation.name ?? 'the conversation',
      resourceType: 'conversation',
      resourceId: conversationId,
      channels: ['IN_APP'],
    });

    return participant;
  }

  /**
   * Marks the caller's read cursor. Unread counts are derived from this value
   * (messages after lastReadAt sent by someone else), so no counter is stored.
   */
  async markRead(principal: Principal, conversationId: string, requestId: string | null) {
    const conversation = await this.requireMembership(principal, conversationId);

    const updated = await this.prisma.withReconnect((db) =>
      db.conversationParticipant.update({
        where: { conversationId_userId: { conversationId, userId: principal.userId } },
        data: { lastReadAt: new Date() },
        select: { lastReadAt: true },
      }),
    );

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'communication.read_receipt',
      resourceType: 'conversation',
      resourceId: conversationId,
      companyId: conversation.companyId,
      requestId,
      metadata: { lastReadAt: updated.lastReadAt?.toISOString() ?? null },
    });

    return { lastReadAt: updated.lastReadAt };
  }

  /**
   * Directory of users addressable in a company. Chat payloads carry user ids
   * only (DATA-MODEL §22 defines no User relation), so the surface resolves
   * display names through this endpoint instead.
   */
  async listDirectory(principal: Principal, companyId: string, search?: string) {
    this.scopeGuard(principal, companyId);
    // AND-composed so a search term never widens past the company scope.
    const AND: Prisma.UserWhereInput[] = [belongsToCompany(companyId)];
    if (search) {
      AND.push({
        OR: [
          { displayName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.UserWhereInput = { status: 'ACTIVE', AND };

    const rows = await this.prisma.user.findMany({
      where,
      select: userDirectoryFields,
      orderBy: { displayName: 'asc' },
      take: 50,
    });
    return { rows, total: rows.length };
  }
}
