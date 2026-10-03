import { config as loadEnv } from 'dotenv';
loadEnv();

import { PrismaService } from '@erp/prisma';
import { pino } from 'pino';
import { OutboxRelay } from './outbox-relay.js';
import type { OutboxJobData } from './notification-delivery.js';
import { NotificationDeliveryProcessor } from './notification-delivery.js';
import { ACCOUNTING_EVENT_TYPES, AccountingIngestProcessor } from './accounting-ingest.js';
import { ReportScheduleProcessor, ReportScheduleRelay } from './reporting/scheduled-reports.js';
import { QUEUE_NOTIFICATIONS, QUEUE_REPORTS, createWorker } from './queue.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'erp-worker' } });

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  const relay = new OutboxRelay(prisma);
  const processor = new NotificationDeliveryProcessor(prisma);
  const accountingProcessor = new AccountingIngestProcessor(prisma);
  const reportProcessor = new ReportScheduleProcessor(prisma);
  const reportRelay = new ReportScheduleRelay(prisma);

  const notificationWorker = createWorker(QUEUE_NOTIFICATIONS, (job) => {
    const data = job.data as unknown as { eventType?: string };
    if (data.eventType && ACCOUNTING_EVENT_TYPES.has(data.eventType)) {
      return accountingProcessor.process(job as never);
    }
    return processor.process(job as Parameters<typeof processor.process>[0] as never);
  });

  // Scheduled reports get their own queue so a slow export never starves
  // notification delivery.
  const reportWorker = createWorker(QUEUE_REPORTS, (job) =>
    reportProcessor.process(job as Parameters<typeof reportProcessor.process>[0]),
  );
  reportWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, 'scheduled report job failed');
  });

  const pollInterval = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000);
  const reportPollInterval = Number(process.env.REPORT_SCHEDULE_POLL_INTERVAL_MS ?? 30000);
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

  const reportPollLoop = (async () => {
    while (state.running) {
      try {
        const enqueued: number = await reportRelay.pollAndEnqueue();
        if (enqueued > 0) {
          logger.info({ enqueued }, 'scheduled reports enqueued');
        }
      } catch (error: unknown) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'report schedule poll failed',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, reportPollInterval));
    }
  })();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    state.running = false;
    await Promise.race([
      Promise.all([pollLoop, new Promise((resolve) => setTimeout(resolve, pollInterval + 500))]),
      Promise.all([
        reportPollLoop,
        new Promise((resolve) => setTimeout(resolve, reportPollInterval + 500)),
      ]),
    ]);
    await reportWorker.close();
    await notificationWorker.close();
    await reportRelay.close();
    await relay.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info(
    { pollInterval, reportPollInterval },
    'ERP worker started (outbox relay + notifications + scheduled reports)',
  );
}

void main().catch((error: unknown) => {
  logger.error(
    { error: error instanceof Error ? error.stack : String(error) },
    'worker failed to start',
  );
  process.exit(1);
});

export type { OutboxJobData };
