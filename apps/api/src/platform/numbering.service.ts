import { Injectable } from '@nestjs/common';
import type { Prisma } from '@erp/prisma';
import { BusinessRuleError } from '../common/errors.js';

export const DOCUMENT_TYPES = {
  SUPPLIER: 'SUPPLIER',
  PURCHASE_REQUEST: 'PURCHASE_REQUEST',
  RFQ: 'RFQ',
  SUPPLIER_QUOTATION: 'SUPPLIER_QUOTATION',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  GOODS_RECEIPT: 'GOODS_RECEIPT',
  SUPPLIER_INVOICE: 'SUPPLIER_INVOICE',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  SALES_QUOTATION: 'SALES_QUOTATION',
  SALES_ORDER: 'SALES_ORDER',
  DELIVERY: 'DELIVERY',
  CUSTOMER_INVOICE: 'CUSTOMER_INVOICE',
  CUSTOMER_RECEIPT: 'CUSTOMER_RECEIPT',
  JOURNAL: 'JOURNAL',
  JOURNAL_REVERSAL: 'JOURNAL_REVERSAL',
  STOCK_TRANSFER: 'STOCK_TRANSFER',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  ASSET: 'ASSET',
} as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[keyof typeof DOCUMENT_TYPES];

const PREFIXES: Record<string, string> = {
  SUPPLIER: 'SUP',
  PURCHASE_REQUEST: 'PR',
  RFQ: 'RFQ',
  SUPPLIER_QUOTATION: 'SQ',
  PURCHASE_ORDER: 'PO',
  GOODS_RECEIPT: 'GRN',
  SUPPLIER_INVOICE: 'SINV',
  SUPPLIER_PAYMENT: 'PAY',
  SALES_QUOTATION: 'QT',
  SALES_ORDER: 'SO',
  DELIVERY: 'DEL',
  CUSTOMER_INVOICE: 'INV',
  CUSTOMER_RECEIPT: 'RCT',
  JOURNAL: 'JE',
  JOURNAL_REVERSAL: 'JER',
  STOCK_TRANSFER: 'STR',
  STOCK_ADJUSTMENT: 'ADJ',
  ASSET: 'FA',
};

const FALLBACK_PREFIX = 'DOC';

/**
 * Central document numbering (CLAUDE.md §50: generated server-side,
 * concurrency-safe). Format: PREFIX-YYYY-NNNNNN scoped by company/type/year.
 * The increment happens inside the caller's transaction using a row lock
 * (SELECT ... FOR UPDATE via Prisma raw query) so concurrent posts cannot
 * collide.
 */
@Injectable()
export class NumberingService {
  /**
   * Allocates the next document number. MUST be called inside the same
   * transaction as the business record that stores the number.
   */
  async nextDocumentNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: DocumentType,
    at: Date = new Date(),
  ): Promise<string> {
    const fiscalYear = at.getUTCFullYear();
    const prefix = PREFIXES[documentType] ?? FALLBACK_PREFIX;

    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`seq:${companyId}:${documentType}:${fiscalYear}`}))`;

    const sequence = await tx.documentSequence.upsert({
      where: {
        companyId_documentType_fiscalYear: { companyId, documentType, fiscalYear },
      },
      update: { nextNumber: { increment: 1 } },
      create: { companyId, documentType, fiscalYear, prefix, nextNumber: 2 },
    });

    // upsert returns the row AFTER increment; the allocated number is nextNumber - 1.
    const allocated = sequence.nextNumber - 1n;
    if (allocated <= 0n) {
      throw new BusinessRuleError('Document sequence allocation failed');
    }
    return `${prefix}-${fiscalYear}-${allocated.toString().padStart(6, '0')}`;
  }

  /** Preview only — never used to persist official numbers. */
  previewFormat(documentType: DocumentType): string {
    const prefix = PREFIXES[documentType] ?? FALLBACK_PREFIX;
    return `${prefix}-${new Date().getUTCFullYear()}-000001`;
  }
}
