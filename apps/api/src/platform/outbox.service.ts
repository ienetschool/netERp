import { Injectable } from '@nestjs/common';
import type { Prisma } from '@erp/prisma';

export interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox (DATA-MODEL.md §21, ARCHITECTURE.md §23).
 * `emit` must be called (and awaited) inside the same transaction as the
 * business change it describes — an unawaited create races the transaction
 * commit and crashes the process with an unhandled rejection; the worker
 * relays events to BullMQ afterwards.
 */
@Injectable()
export class OutboxService {
  async emit(input: OutboxEventInput, tx: Prisma.TransactionClient): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }

  async emitAndWait(input: OutboxEventInput, tx: Prisma.TransactionClient): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }
}
