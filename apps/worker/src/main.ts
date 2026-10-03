import { config as loadEnv } from 'dotenv';
loadEnv();

import { PrismaService } from '@erp/prisma';
import { pino } from 'pino';
import { OutboxRelay } from './outbox-relay.js';
import type { OutboxJobData } from './notification-delivery.js';
import { NotificationDeliveryProcessor } from './notification-delivery.js';
import { ACCOUNTING_EVENT_TYPES, AccountingIngestProcessor } from './accounting-ingest.js';
import { QUEUE_NOTIFICATIONS, createWorker } from './queue.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'erp-worker' } });

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  const relay = new OutboxRelay(prisma);
  const processor = new NotificationDeliveryProcessor(prisma);
  const accountingProcessor = new AccountingIngestProcessor(prisma);

  const notificationWorker = createWorker(QUEUE_NOTIFICATIONS, (job) => {
    const data = job.data as unknown as { eventType?: string };
    if (data?.eventType && ACCOUNTING_EVENT_TYPES.has(data.eventType)) {
      return accountingProcessor.process(job as never);
    }
    return processor.process(job as Parameters<typeof processor.process>[0] as never);
  });

  const pollInterval = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000);
  const state = { running: true };

  const pollLoop = (async () => {
    while (state.running) {
      try {
        const enqueued: number = await relay.pollAndEnqueue();
        if (enqueued > 0) {
          logger.info({ enqueued }, 'outbox events relayed');
        }
      } catch (error: unknown) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'outbox poll failed',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  })();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    state.running = false;
    await Promise.race([
      pollLoop,
      new Promise((resolve) => setTimeout(resolve, pollInterval + 500)),
    ]);
    await notificationWorker.close();
    await relay.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info({ pollInterval }, 'ERP worker started (outbox relay + notifications)');
}

void main().catch((error: unknown) => {
  logger.error(
    { error: error instanceof Error ? error.stack : String(error) },
    'worker failed to start',
  );
  process.exit(1);
});

export type { OutboxJobData };
