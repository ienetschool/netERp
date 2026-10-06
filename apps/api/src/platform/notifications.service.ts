import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import type { Prisma } from '@erp/prisma';

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';

export interface NotifyInput {
  userId: string;
  companyId?: string | null;
  type: string;
  title: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  channels?: NotificationChannel[];
}

/**
 * Central notification service (CLAUDE.md §25, ARCHITECTURE.md §28).
 * The in-app record is created synchronously (same transaction when provided);
 * external channels are enqueued for the worker so provider availability never
 * blocks business transactions.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotifyInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const channels = input.channels ?? ['IN_APP'];

    const preferenceRows = await client.notificationPreference.findMany({
      where: { userId: input.userId },
    });
    const prefMap = new Map(preferenceRows.map((p) => [`${p.eventType}:${p.channel}`, p.enabled]));

    for (const channel of channels) {
      const enabled = prefMap.get(`${input.type}:${channel}`) ?? true;
      if (!enabled) continue;

      const notification = await client.notification.create({
        data: {
          userId: input.userId,
          companyId: input.companyId ?? null,
          type: input.type,
          title: input.title,
          message: input.message,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          channel,
          status: channel === 'IN_APP' ? 'UNREAD' : 'UNREAD',
        },
      });

      if (channel !== 'IN_APP') {
        await client.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            provider: channel.toLowerCase(),
            status: 'PENDING',
          },
        });
      }
    }
  }

  async listForUser(userId: string, onlyUnread: boolean) {
    return this.prisma.notification.findMany({
      where: { userId, ...(onlyUnread ? { status: 'UNREAD' } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, status: 'UNREAD' } });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { status: 'READ', readAt: new Date() },
    });
  }
}
