import { Injectable } from '@nestjs/common';
import type { Prisma } from '@erp/prisma';
import { PrismaService } from '@erp/prisma';

export interface AuditEventInput {
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Cross-cutting audit service (CLAUDE.md §46, ARCHITECTURE.md §37).
 * When called inside a business transaction, pass the Prisma transaction
 * client so the audit row commits atomically with the business change.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        companyId: event.companyId ?? null,
        branchId: event.branchId ?? null,
        requestId: event.requestId ?? null,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        beforeData: event.beforeData ?? undefined,
        afterData: event.afterData ?? undefined,
        metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
