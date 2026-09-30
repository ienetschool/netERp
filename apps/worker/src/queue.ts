import type { Processor, JobsOptions, ConnectionOptions } from 'bullmq';
import { Queue, Worker } from 'bullmq';

export const QUEUE_OUTBOX = 'outbox';
export const QUEUE_NOTIFICATIONS = 'notifications';

export const JOB_OUTBOX_RELAY = 'outbox.relay';
export const JOB_NOTIFY_DISPATCH = 'notify.dispatch';

export function redisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return { url, maxRetriesPerRequest: null };
}

export function createQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnection() });
}

export function createWorker(name: string, processor: Processor, concurrency = 5): Worker {
  return new Worker(name, processor, { connection: redisConnection(), concurrency });
}

export function defaultJobOptions(): JobsOptions {
  return {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  };
}
