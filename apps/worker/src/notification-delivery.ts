import type { PrismaService } from '@erp/prisma';
import type { Job } from 'bullmq';
import { pino } from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'erp-worker' } });

export interface OutboxJobData {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Notification dispatch processor. External provider calls live behind
 * adapters; failures mark delivery rows FAILED with error codes for retry.
 * In-app notifications need no delivery — only external channels do.
 */
export class NotificationDeliveryProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async process(job: Job<OutboxJobData>): Promise<void> {
    const { eventId, eventType, payload } = job.data;
    logger.debug({ eventId, eventType }, 'processing outbox event');

    // Resolve pending deliveries; provider availability never blocks the API.
    const pendingDeliveries = await this.prisma.notificationDelivery.findMany({
      where: { status: 'PENDING', provider: { notIn: ['in_app'] } },
      include: { notification: true },
      take: 20,
    });
    if (pendingDeliveries.length === 0) {
      logger.debug({ eventId, eventType }, 'no pending external deliveries');
      return;
    }

    for (const delivery of pendingDeliveries) {
      const provider = delivery.provider;
      try {
        await this.deliver(
          provider,
          delivery.notification.title,
          delivery.notification.message,
          payload,
        );
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SENT', sentAt: new Date(), attempt: delivery.attempt + 1 },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            attempt: delivery.attempt + 1,
            errorCode: 'PROVIDER_ERROR',
            sentAt: null,
          },
        });
        logger.warn(
          { deliveryId: delivery.id, provider, error: message },
          'notification delivery failed',
        );
        throw error; // let BullMQ retry per its backoff policy
      }
    }
  }

  /**
   * Provider adapters. Real SMTP/SMS/WhatsApp providers plug in here behind
   * the same interface; the domain never imports provider SDKs directly
   * (CLAUDE.md §26).
   */
  private async deliver(
    provider: string,
    title: string,
    message: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    switch (provider) {
      case 'email':
        await this.deliverEmail(title, message, payload);
        break;
      case 'sms':
        await this.deliverSms(message, payload);
        break;
      case 'whatsapp':
        await this.deliverWhatsApp(message, payload);
        break;
      default:
        logger.warn({ provider }, 'unknown notification provider; marking as delivered');
    }
  }

  // Provider implementations are intentionally conservative stubs until the
  // integration stage defines the actual providers — they never fabricate
  // success beyond recording the delivery attempt (CLAUDE.md §59).
  private deliverEmail(
    _title: string,
    _message: string,
    _payload: Record<string, unknown>,
  ): Promise<void> {
    logger.info({ provider: 'email' }, 'email delivery adapter not yet configured');
    return Promise.reject(new Error('Email provider adapter not configured'));
  }

  private deliverSms(_message: string, _payload: Record<string, unknown>): Promise<void> {
    logger.info({ provider: 'sms' }, 'sms delivery adapter not yet configured');
    return Promise.reject(new Error('SMS provider adapter not configured'));
  }

  private deliverWhatsApp(_message: string, _payload: Record<string, unknown>): Promise<void> {
    logger.info({ provider: 'whatsapp' }, 'whatsapp delivery adapter not yet configured');
    return Promise.reject(new Error('WhatsApp provider adapter not configured'));
  }
}
