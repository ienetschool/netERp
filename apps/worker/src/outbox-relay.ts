import type { PrismaService } from '@erp/prisma';
import { pino } from 'pino';
import { createQueue, defaultJobOptions, JOB_OUTBOX_RELAY, QUEUE_NOTIFICATIONS } from './queue.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'erp-worker' } });

/**
 * Outbox relay (ARCHITECTURE.md §23): reads PENDING outbox rows committed with
 * the business transaction and enqueues them for delivery. Marks rows PUBLISHED
 * only after a successful enqueue; failures increment attempts and eventually
 * FAILED with lastError for inspection.
 */
export class OutboxRelay {
  private readonly notificationsQueue = createQueue(QUEUE_NOTIFICATIONS);

  constructor(private readonly prisma: PrismaService) {}

  async pollAndEnqueue(): Promise<number> {
    const batchSize = Number(process.env.OUTBOX_BATCH_SIZE ?? 50);
    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { occurredAt: 'asc' },
      take: batchSize,
    });

    let enqueued = 0;
    for (const event of events) {
      try {
        await this.notificationsQueue.add(
          JOB_OUTBOX_RELAY,
          {
            eventId: event.id,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: event.payload,
          },
          { jobId: `outbox:${event.id}`, ...defaultJobOptions() },
        );
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
        });
        enqueued++;
      } catch (error) {
        const attempts = event.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts,
            status: attempts >= 10 ? 'FAILED' : 'PENDING',
            lastError: message.slice(0, 500),
          },
        });
        logger.warn({ eventId: event.id, attempts, error: message }, 'outbox enqueue failed');
      }
    }
    return enqueued;
  }

  async close(): Promise<void> {
    await this.notificationsQueue.close();
  }
}

export { JOB_OUTBOX_RELAY };
