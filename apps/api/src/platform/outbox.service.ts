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
 * `emit` must be called inside the same transaction as the business change it
 * describes; the worker relays events to BullMQ afterwards.
 */
@Injectable()
export class OutboxService {
  emit(input: OutboxEventInput, tx: Prisma.TransactionClient): void {
    void tx.outboxEvent
      .create({
        data: {
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload: input.payload as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        // Surface in logs via worker; event creation failures abort the tx.
        throw new Error('Outbox event creation failed');
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
