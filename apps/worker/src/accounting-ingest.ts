import type { Job } from 'bullmq';
import type { PrismaService } from '@erp/prisma';

export interface AccountingJobData {
  eventId: string;
  eventType: string;
  payload: { journal?: Record<string, unknown> };
}

/** Outbox event types that carry a journal payload for GL ingestion. */
export const ACCOUNTING_EVENT_TYPES = new Set([
  'sales.customer_invoice.posted',
  'sales.customer_receipt.posted',
  'procurement.supplier_invoice.posted',
  'procurement.supplier_payment.posted',
  'procurement.goods_receipt.posted',
  'payroll.run.posted',
]);

/**
 * GL ingestion processor. Creates an already-POSTED journal from the event's
 * journal payload, idempotent on sourceType+sourceId (see AccountingService).
 * The worker path runs when Redis is available; without Redis the API's
 * import-from-outbox endpoint performs the same ingest.
 */
export class AccountingIngestProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async process(job: Job): Promise<void> {
    const data = job.data as unknown as AccountingJobData;
    const journal = data.payload.journal as
      | {
          journalDate?: string;
          sourceType?: string;
          sourceId?: string;
          sourceDocumentNo?: string;
          lines?: Array<{ accountId: string; side: string; amount: string; description?: string }>;
        }
      | undefined;
    if (!journal || !Array.isArray(journal.lines) || journal.lines.length === 0) return;

    if (journal.sourceType && journal.sourceId) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { sourceType: journal.sourceType, sourceId: journal.sourceId },
      });
      if (existing) return;
    }

    const journalDate = journal.journalDate
      ? new Date(`${journal.journalDate.slice(0, 10)}T00:00:00Z`)
      : new Date();
    const period = await this.prisma.financialPeriod.findFirst({
      where: { status: 'OPEN', startDate: { lte: journalDate }, endDate: { gte: journalDate } },
    });
    if (!period) throw new Error(`No open financial period covers ${journalDate.toISOString()}`);

    await this.prisma.journalEntry.create({
      data: {
        companyId: period.companyId,
        journalNo: `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        journalDate,
        financialPeriodId: period.id,
        sourceType: journal.sourceType ?? data.eventType,
        sourceId: journal.sourceId ?? null,
        sourceDocumentNo: journal.sourceDocumentNo ?? null,
        description: `Auto-imported from ${data.eventType}`,
        status: 'POSTED',
        postedAt: new Date(),
        lines: {
          create: journal.lines.map((l, i) => ({
            lineNo: i + 1,
            accountId: l.accountId,
            description: l.description ?? null,
            debit: l.side === 'DEBIT' ? l.amount : '0',
            credit: l.side === 'CREDIT' ? l.amount : '0',
          })),
        },
      },
    });
  }
}
