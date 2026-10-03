import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { Money, sumMoney } from '@erp/types';
import { BusinessRuleError, NotFoundError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { NumberingService, DOCUMENT_TYPES } from '../platform/numbering.service.js';
import { WorkflowEngineService } from '../workflow/workflow-engine.service.js';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import type { AccountCreateInput, AccountUpdateInput, JournalCreateInput } from '@erp/validation';

type Principal = RequestPrincipal & { isSuperAdmin?: boolean };

const JOURNAL_TYPE_BY_EVENT: Record<string, string> = {
  'sales.customer_invoice.posted': 'SALES',
  'procurement.supplier_invoice.posted': 'PURCHASE',
  'payroll.run.posted': 'PAYROLL',
  'sales.customer_receipt.posted': 'BANK',
  'procurement.supplier_payment.posted': 'BANK',
  'procurement.goods_receipt.posted': 'INVENTORY',
  'sales.sales_order.approved': 'GENERAL',
};

/**
 * Accounting module (PRD Stage 8): chart of accounts, journals, GL.
 *
 * Manual journals validate debit = credit, postable accounts and an OPEN
 * financial period (USER-FLOWS §13.2 posting gate) and run the workflow
 * engine (entity type `journal_entry`, approver CHIEF_ACCOUNTANT in seed).
 * Reversals create a linked, immediately-posted REVERSAL journal with
 * mirrored lines (§13.3); the original stays intact and marked REVERSED.
 * Module journals emitted on the outbox by procurement/payroll/sales are
 * ingested idempotently (dedupe on sourceType+sourceId) either by the worker
 * processor when Redis is available or by the import-from-outbox endpoint.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowEngineService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private scopeGuard(principal: Principal, companyId: string): void {
    if (principal.companyIds && !principal.companyIds.includes(companyId)) {
      throw new NotFoundError('Record not found');
    }
  }

  // ---- Chart of accounts ------------------------------------------------------

  async createAccount(principal: Principal, input: AccountCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const existing = await this.prisma.account.findUnique({
      where: {
        companyId_accountCode: { companyId: input.companyId, accountCode: input.accountCode },
      },
    });
    if (existing) {
      throw new BusinessRuleError(`Account code ${input.accountCode} already exists`);
    }
    const account = await this.prisma.account.create({
      data: {
        companyId: input.companyId,
        parentId: input.parentId ?? null,
        accountCode: input.accountCode,
        accountName: input.accountName,
        accountType: input.accountType,
        normalBalance: input.normalBalance,
        isControlAccount: input.isControlAccount,
        isPostable: input.isPostable,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.account_created',
      resourceType: 'account',
      resourceId: account.id,
      companyId: account.companyId,
      requestId,
    });
    return account;
  }

  async listAccounts(
    principal: Principal,
    query: { type?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.AccountWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.type ? { accountType: query.type } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.account.findMany({
        where,
        orderBy: [{ accountCode: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.account.count({ where }),
    ]);
    return { rows, total };
  }

  async updateAccount(
    principal: Principal,
    id: string,
    input: AccountUpdateInput,
    requestId: string | null,
  ) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundError('Account not found');
    this.scopeGuard(principal, account.companyId);
    const updated = await this.prisma.account.update({
      where: { id },
      data: {
        ...(input.accountName !== undefined ? { accountName: input.accountName } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.isPostable !== undefined ? { isPostable: input.isPostable } : {}),
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.account_updated',
      resourceType: 'account',
      resourceId: id,
      companyId: account.companyId,
      requestId,
    });
    return updated;
  }

  // ---- Financial periods ------------------------------------------------------

  async listPeriods(principal: Principal) {
    const where: Prisma.FinancialPeriodWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    return this.prisma.financialPeriod.findMany({
      where,
      orderBy: [{ fiscalYear: 'desc' }, { periodNo: 'asc' }],
    });
  }

  /** Period close (USER-FLOWS §13.4): rejects when unposted journals remain. */
  async closePeriod(principal: Principal, id: string, requestId: string | null) {
    const period = await this.prisma.financialPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundError('Financial period not found');
    this.scopeGuard(principal, period.companyId);
    if (period.status !== 'OPEN') {
      throw new BusinessRuleError(`Period is ${period.status.toLowerCase()}; only OPEN closes`);
    }
    const unresolved = await this.prisma.journalEntry.count({
      where: {
        companyId: period.companyId,
        financialPeriodId: period.id,
        status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] },
      },
    });
    if (unresolved > 0) {
      throw new BusinessRuleError(
        `Period has ${unresolved} unposted journal(s); post or cancel them before closing`,
      );
    }
    const closed = await this.prisma.financialPeriod.update({
      where: { id },
      data: { status: 'CLOSED', closedById: principal.userId, closedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.period_closed',
      resourceType: 'financial_period',
      resourceId: id,
      companyId: period.companyId,
      requestId,
      metadata: { fiscalYear: period.fiscalYear, periodNo: period.periodNo },
    });
    return closed;
  }

  // ---- Journals ---------------------------------------------------------------

  private resolveJournalType(type: string): string {
    return type;
  }

  private async assertAccountsPostable(
    tx: Prisma.TransactionClient,
    companyId: string,
    accountIds: string[],
  ): Promise<void> {
    const unique = [...new Set(accountIds)];
    const accounts = await tx.account.findMany({ where: { id: { in: unique } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    for (const id of unique) {
      const account = byId.get(id);
      if (!account || account.companyId !== companyId) {
        throw new BusinessRuleError('Journal references an account from another company');
      }
      if (account.status !== 'ACTIVE') {
        throw new BusinessRuleError(`Account ${account.accountCode} is not active`);
      }
      if (!account.isPostable) {
        throw new BusinessRuleError(
          `Account ${account.accountCode} is a control/non-posting account`,
        );
      }
    }
  }

  async createJournal(principal: Principal, input: JournalCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const journalDate = new Date(`${input.journalDate}T00:00:00Z`);
    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        companyId: input.companyId,
        status: 'OPEN',
        startDate: { lte: journalDate },
        endDate: { gte: journalDate },
      },
    });
    if (!period) {
      throw new BusinessRuleError('No open financial period covers the journal date');
    }
    await this.assertAccountsPostable(
      this.prisma,
      input.companyId,
      input.lines.map((l) => l.accountId),
    );

    const journal = await this.prisma.$transaction(
      async (tx) => {
        const journalNo = await this.numbering.nextDocumentNumber(
          tx,
          input.companyId,
          DOCUMENT_TYPES.JOURNAL,
        );
        return tx.journalEntry.create({
          data: {
            companyId: input.companyId,
            branchId: input.branchId ?? null,
            journalNo,
            journalType: this.resolveJournalType(input.journalType),
            journalDate,
            financialPeriodId: period.id,
            ...(input.sourceType ? { sourceType: input.sourceType } : {}),
            ...(input.sourceId ? { sourceId: input.sourceId } : {}),
            ...(input.sourceDocumentNo ? { sourceDocumentNo: input.sourceDocumentNo } : {}),
            description: input.description ?? null,
            status: 'DRAFT',
            createdById: principal.userId,
            lines: {
              create: input.lines.map((l, i) => ({
                lineNo: i + 1,
                accountId: l.accountId,
                description: l.description ?? null,
                debit: Money.fromDecimalString(l.debit ?? '0').toString(),
                credit: Money.fromDecimalString(l.credit ?? '0').toString(),
                ...(l.customerId ? { customerId: l.customerId } : {}),
                ...(l.supplierId ? { supplierId: l.supplierId } : {}),
                ...(l.employeeId ? { employeeId: l.employeeId } : {}),
                ...(l.productId ? { productId: l.productId } : {}),
                ...(l.departmentId ? { departmentId: l.departmentId } : {}),
                ...(l.costCenterId ? { costCenterId: l.costCenterId } : {}),
              })),
            },
          },
          include: { lines: true },
        });
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.journal_created',
      resourceType: 'journal_entry',
      resourceId: journal.id,
      companyId: journal.companyId,
      requestId,
    });
    return journal;
  }

  async listJournals(
    principal: Principal,
    query: {
      status?: string;
      type?: string;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.JournalEntryWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { journalType: query.type } : {}),
      ...(query.from || query.to
        ? {
            journalDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59Z`) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.journalEntry.findMany({
        where,
        orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { lines: { select: { debit: true, credit: true } } },
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return { rows, total };
  }

  async getJournal(principal: Principal, id: string) {
    const journal = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { account: { select: { accountCode: true, accountName: true } } },
        },
        reversedBy: { select: { journalNo: true, status: true } },
        financialPeriod: {
          select: { fiscalYear: true, periodNo: true, status: true },
        },
      },
    });
    if (!journal) throw new NotFoundError('Journal not found');
    this.scopeGuard(principal, journal.companyId);
    return journal;
  }

  async submitJournal(
    principal: Principal,
    id: string,
    amountOverride: string | undefined,
    requestId: string | null,
  ) {
    const journal = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!journal) throw new NotFoundError('Journal not found');
    this.scopeGuard(principal, journal.companyId);
    if (journal.status !== 'DRAFT') {
      throw new BusinessRuleError(`Journal is ${journal.status.toLowerCase()}, not DRAFT`);
    }
    const amount =
      amountOverride ??
      sumMoney(journal.lines.map((l) => Money.fromDecimalString(l.debit.toString()))).toString();
    const started = await this.workflow.startInstance({
      entityType: 'journal_entry',
      entityId: journal.id,
      companyId: journal.companyId,
      actorUserId: principal.userId,
    });
    await this.workflow.executeTransition({
      instanceId: started.instanceId,
      action: 'submit',
      actorUserId: principal.userId,
      amount,
    });
    const updated = await this.prisma.journalEntry.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', workflowInstanceId: started.instanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.journal_submitted',
      resourceType: 'journal_entry',
      resourceId: id,
      companyId: journal.companyId,
      requestId,
      metadata: { amount },
    });
    return updated;
  }

  /** Bridges workflow terminal states back onto the journal. */
  async applyJournalOutcome(instanceId: string, outcome: string, _actorUserId: string) {
    if (outcome === 'IN_PROGRESS') return;
    const journal = await this.prisma.journalEntry.findUnique({
      where: { workflowInstanceId: instanceId },
    });
    if (!journal || journal.status !== 'PENDING_APPROVAL') return;

    if (outcome === 'COMPLETED') {
      await this.prisma.journalEntry.update({
        where: { id: journal.id },
        data: { status: 'APPROVED' },
      });
      return;
    }
    await this.prisma.journalEntry.update({
      where: { id: journal.id },
      data: { status: outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED' },
    });
  }

  /**
   * Posting gate (USER-FLOWS §13.2): OPEN period, debits = credits, valid
   * postable accounts, single post. Any failure aborts the whole transaction.
   */
  async postJournal(principal: Principal, id: string, requestId: string | null) {
    const journal = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: true, financialPeriod: true },
    });
    if (!journal) throw new NotFoundError('Journal not found');
    this.scopeGuard(principal, journal.companyId);
    if (!['DRAFT', 'APPROVED'].includes(journal.status)) {
      throw new BusinessRuleError(`Journal is ${journal.status.toLowerCase()}; cannot post`);
    }
    if (!journal.financialPeriod || journal.financialPeriod.status !== 'OPEN') {
      throw new BusinessRuleError('Journal period is not OPEN; posting rejected');
    }
    const debits = sumMoney(journal.lines.map((l) => Money.fromDecimalString(l.debit.toString())));
    const credits = sumMoney(
      journal.lines.map((l) => Money.fromDecimalString(l.credit.toString())),
    );
    if (!debits.eq(credits) || debits.isZero()) {
      throw new BusinessRuleError('Journal debits and credits must balance and be non-zero');
    }
    await this.assertAccountsPostable(
      this.prisma,
      journal.companyId,
      journal.lines.map((l) => l.accountId),
    );

    const updated = await this.prisma.journalEntry.update({
      where: { id },
      data: { status: 'POSTED', postedById: principal.userId, postedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.journal_posted',
      resourceType: 'journal_entry',
      resourceId: id,
      companyId: journal.companyId,
      requestId,
      metadata: { journalNo: journal.journalNo, total: debits.toString() },
    });
    return updated;
  }

  /**
   * Reversal (USER-FLOWS §13.3): creates a linked REVERSAL journal with
   * mirrored lines, posts it immediately, and marks the original REVERSED.
   * The original posted history stays intact.
   */
  async reverseJournal(principal: Principal, id: string, reason: string, requestId: string | null) {
    const original = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: true, financialPeriod: true },
    });
    if (!original) throw new NotFoundError('Journal not found');
    this.scopeGuard(principal, original.companyId);
    if (original.status !== 'POSTED') {
      throw new BusinessRuleError(
        `Journal is ${original.status.toLowerCase()}; only POSTED reverses`,
      );
    }
    if (original.reversedByJournalId) {
      throw new BusinessRuleError('Journal is already reversed');
    }

    const reversal = await this.prisma.$transaction(
      async (tx) => {
        const reversalNo = await this.numbering.nextDocumentNumber(
          tx,
          original.companyId,
          DOCUMENT_TYPES.JOURNAL_REVERSAL,
        );
        const created = await tx.journalEntry.create({
          data: {
            companyId: original.companyId,
            branchId: original.branchId,
            journalNo: reversalNo,
            journalType: 'REVERSAL',
            journalDate: new Date(),
            financialPeriodId: original.financialPeriodId,
            sourceType: 'journal_reversal',
            sourceId: original.id,
            sourceDocumentNo: original.journalNo,
            description: `Reversal of ${original.journalNo}: ${reason}`.slice(0, 500),
            status: 'POSTED',
            postedById: principal.userId,
            postedAt: new Date(),
            createdById: principal.userId,
            lines: {
              create: original.lines.map((l, i) => ({
                lineNo: i + 1,
                accountId: l.accountId,
                description: l.description,
                debit: l.credit,
                credit: l.debit,
                currencyId: l.currencyId,
                exchangeRate: l.exchangeRate,
                foreignDebit: l.foreignCredit,
                foreignCredit: l.foreignDebit,
                customerId: l.customerId,
                supplierId: l.supplierId,
                employeeId: l.employeeId,
                productId: l.productId,
                departmentId: l.departmentId,
                costCenterId: l.costCenterId,
              })),
            },
          },
          include: { lines: true },
        });
        await tx.journalEntry.update({
          where: { id: original.id },
          data: { status: 'REVERSED', reversedByJournalId: created.id },
        });
        return created;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.journal_reversed',
      resourceType: 'journal_entry',
      resourceId: id,
      companyId: original.companyId,
      requestId,
      metadata: { reversalId: reversal.id, reversalNo: reversal.journalNo, reason },
    });
    return reversal;
  }

  // ---- Outbox ingestion (module journals -> GL) --------------------------------

  /**
   * Ingests one outbox journal payload idempotently (dedupe on
   * sourceType+sourceId). Creates the journal already POSTED: the emitting
   * module owns the business approval, the GL is its accounting reflection.
   */
  async ingestJournalPayload(
    principal: Principal,
    event: { eventType: string; payload: { journal?: Record<string, unknown> } },
    requestId: string | null,
  ) {
    const payloadJournal = event.payload.journal as
      | {
          journalDate?: string;
          sourceType?: string;
          sourceId?: string;
          sourceDocumentNo?: string;
          currencyId?: string;
          lines?: Array<{ accountId: string; side: string; amount: string; description?: string }>;
        }
      | undefined;
    const journalLines = payloadJournal?.lines;
    if (!payloadJournal || !Array.isArray(journalLines) || journalLines.length === 0) {
      throw new BusinessRuleError('Event payload carries no journal');
    }
    if (payloadJournal.sourceType && payloadJournal.sourceId) {
      const existing = await this.prisma.journalEntry.findFirst({
        where: { sourceType: payloadJournal.sourceType, sourceId: payloadJournal.sourceId },
      });
      if (existing) return { ingested: false, journal: existing };
    }
    const journalDate = payloadJournal.journalDate
      ? new Date(`${payloadJournal.journalDate.slice(0, 10)}T00:00:00Z`)
      : new Date();
    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
        status: 'OPEN',
        startDate: { lte: journalDate },
        endDate: { gte: journalDate },
      },
    });
    if (!period) {
      throw new BusinessRuleError('No open financial period covers the event date');
    }
    const companyId = period.companyId;
    const journal = await this.prisma.$transaction(
      async (tx) => {
        const journalNo = await this.numbering.nextDocumentNumber(
          tx,
          companyId,
          DOCUMENT_TYPES.JOURNAL,
        );
        const created = await tx.journalEntry.create({
          data: {
            companyId,
            journalNo,
            journalType: JOURNAL_TYPE_BY_EVENT[event.eventType] ?? 'GENERAL',
            journalDate,
            financialPeriodId: period.id,
            sourceType: payloadJournal.sourceType ?? event.eventType,
            sourceId: payloadJournal.sourceId ?? null,
            sourceDocumentNo: payloadJournal.sourceDocumentNo ?? null,
            description: `Auto-imported from ${event.eventType}`,
            status: 'POSTED',
            postedById: principal.userId,
            postedAt: new Date(),
            createdById: principal.userId,
            lines: {
              create: journalLines.map((l, i) => ({
                lineNo: i + 1,
                accountId: l.accountId,
                description: l.description ?? null,
                debit: l.side === 'DEBIT' ? Money.fromDecimalString(l.amount).toString() : '0',
                credit: l.side === 'CREDIT' ? Money.fromDecimalString(l.amount).toString() : '0',
              })),
            },
          },
          include: { lines: true },
        });
        return created;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'accounting.journal_imported',
      resourceType: 'journal_entry',
      resourceId: journal.id,
      companyId,
      requestId,
      metadata: { eventType: event.eventType },
    });
    return { ingested: true, journal };
  }

  /** Imports every PENDING outbox event carrying a journal payload. */
  async importFromOutbox(principal: Principal, requestId: string | null) {
    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { occurredAt: 'asc' },
      take: 100,
    });
    let imported = 0;
    let skipped = 0;
    for (const event of events) {
      const payload = event.payload as { journal?: unknown };
      if (!('journal' in payload)) continue;
      try {
        const result = await this.ingestJournalPayload(
          principal,
          { eventType: event.eventType, payload: payload as Record<string, unknown> },
          requestId,
        );
        if (result.ingested) imported += 1;
        else skipped += 1;
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
        });
      } catch (error) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts: { increment: 1 },
            lastError: error instanceof Error ? error.message.slice(0, 500) : 'ingest failed',
          },
        });
      }
    }
    return { scanned: events.length, imported, skipped };
  }

  // ---- GL reports ----------------------------------------------------------------

  /** Trial balance over POSTED journals, grouped by account. */
  async trialBalance(principal: Principal, query: { from?: string; to?: string }) {
    const companyScope = principal.companyIds ? { companyId: { in: principal.companyIds } } : {};
    const where: Prisma.JournalLineWhereInput = {
      journal: {
        status: 'POSTED',
        ...companyScope,
        ...(query.from || query.to
          ? {
              journalDate: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
                ...(query.to ? { lte: new Date(`${query.to}T23:59:59Z`) } : {}),
              },
            }
          : {}),
      },
    };
    const lines = await this.prisma.journalLine.findMany({
      where,
      include: {
        account: {
          select: { accountCode: true, accountName: true, accountType: true, normalBalance: true },
        },
      },
    });
    const byAccount = new Map<
      string,
      {
        accountId: string;
        accountCode: string;
        accountName: string;
        accountType: string;
        normalBalance: string;
        debit: Money;
        credit: Money;
      }
    >();
    for (const line of lines) {
      const key = line.accountId;
      const entry = byAccount.get(key) ?? {
        accountId: line.accountId,
        accountCode: line.account.accountCode,
        accountName: line.account.accountName,
        accountType: line.account.accountType,
        normalBalance: line.account.normalBalance,
        debit: Money.zero(),
        credit: Money.zero(),
      };
      entry.debit = entry.debit.plus(Money.fromDecimalString(line.debit.toString()));
      entry.credit = entry.credit.plus(Money.fromDecimalString(line.credit.toString()));
      byAccount.set(key, entry);
    }
    const rows = [...byAccount.values()]
      .map((e) => ({
        ...e,
        debit: e.debit.toString(),
        credit: e.credit.toString(),
        balance: (e.normalBalance === 'DEBIT'
          ? e.debit.minus(e.credit)
          : e.credit.minus(e.debit)
        ).toString(),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const totalDebit = sumMoney(rows.map((r) => Money.fromDecimalString(r.debit)));
    const totalCredit = sumMoney(rows.map((r) => Money.fromDecimalString(r.credit)));
    return {
      rows,
      totals: { debit: totalDebit.toString(), credit: totalCredit.toString() },
      balanced: totalDebit.eq(totalCredit),
    };
  }

  /** Daybook: POSTED journals for one date with per-type totals. */
  async daybook(principal: Principal, date: string) {
    const day = new Date(`${date}T00:00:00Z`);
    const where: Prisma.JournalEntryWhereInput = {
      status: 'POSTED',
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      journalDate: { gte: day, lte: new Date(`${date}T23:59:59Z`) },
    };
    const journals = await this.prisma.journalEntry.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { lines: { select: { debit: true, credit: true } } },
    });
    const rows = journals.map((j) => ({
      id: j.id,
      journalNo: j.journalNo,
      journalType: j.journalType,
      description: j.description,
      total: sumMoney(j.lines.map((l) => Money.fromDecimalString(l.debit.toString()))).toString(),
    }));
    return {
      date,
      rows,
      total: sumMoney(rows.map((r) => Money.fromDecimalString(r.total))).toString(),
    };
  }

  /** Open AR from posted customer invoices, bucketed by due date. */
  async arAging(principal: Principal) {
    const invoices = await this.prisma.customerInvoice.findMany({
      where: {
        status: { in: ['POSTED', 'PARTIALLY_PAID'] },
        ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      },
      include: { customer: { select: { displayName: true } } },
    });
    const now = Date.now();
    const buckets = {
      current: Money.zero(),
      d1_30: Money.zero(),
      d31_60: Money.zero(),
      d61_90: Money.zero(),
      d90plus: Money.zero(),
    };
    const rows = invoices.map((inv) => {
      const outstanding = Money.fromDecimalString(inv.grandTotal.toString()).minus(
        Money.fromDecimalString(inv.paidAmount.toString()),
      );
      const overdueDays = Math.floor((now - inv.dueDate.getTime()) / 86_400_000);
      if (overdueDays <= 0) buckets.current = buckets.current.plus(outstanding);
      else if (overdueDays <= 30) buckets.d1_30 = buckets.d1_30.plus(outstanding);
      else if (overdueDays <= 60) buckets.d31_60 = buckets.d31_60.plus(outstanding);
      else if (overdueDays <= 90) buckets.d61_90 = buckets.d61_90.plus(outstanding);
      else buckets.d90plus = buckets.d90plus.plus(outstanding);
      return {
        invoiceNo: inv.invoiceNo,
        customer: inv.customer.displayName,
        dueDate: inv.dueDate.toISOString().slice(0, 10),
        outstanding: outstanding.toString(),
      };
    });
    return {
      rows,
      totals: {
        current: buckets.current.toString(),
        d1_30: buckets.d1_30.toString(),
        d31_60: buckets.d31_60.toString(),
        d61_90: buckets.d61_90.toString(),
        d90plus: buckets.d90plus.toString(),
        open: sumMoney(Object.values(buckets)).toString(),
      },
    };
  }

  /** Open AP from posted supplier invoices, bucketed by due date. */
  async apAging(principal: Principal) {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        status: { in: ['POSTED', 'PARTIALLY_PAID'] },
        ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      },
      include: { supplier: { select: { displayName: true } } },
    });
    const now = Date.now();
    const buckets = {
      current: Money.zero(),
      d1_30: Money.zero(),
      d31_60: Money.zero(),
      d61_90: Money.zero(),
      d90plus: Money.zero(),
    };
    const rows = invoices.map((inv) => {
      const outstanding = Money.fromDecimalString(inv.grandTotal.toString()).minus(
        Money.fromDecimalString(inv.paidAmount.toString()),
      );
      const overdueDays = Math.floor((now - inv.dueDate.getTime()) / 86_400_000);
      if (overdueDays <= 0) buckets.current = buckets.current.plus(outstanding);
      else if (overdueDays <= 30) buckets.d1_30 = buckets.d1_30.plus(outstanding);
      else if (overdueDays <= 60) buckets.d31_60 = buckets.d31_60.plus(outstanding);
      else if (overdueDays <= 90) buckets.d61_90 = buckets.d61_90.plus(outstanding);
      else buckets.d90plus = buckets.d90plus.plus(outstanding);
      return {
        invoiceNo: inv.internalInvoiceNo,
        supplier: inv.supplier.displayName,
        dueDate: inv.dueDate.toISOString().slice(0, 10),
        outstanding: outstanding.toString(),
      };
    });
    return {
      rows,
      totals: {
        current: buckets.current.toString(),
        d1_30: buckets.d1_30.toString(),
        d31_60: buckets.d31_60.toString(),
        d61_90: buckets.d61_90.toString(),
        d90plus: buckets.d90plus.toString(),
        open: sumMoney(Object.values(buckets)).toString(),
      },
    };
  }

  /** Income statement + balance sheet derived from the trial balance. */
  async financialStatements(principal: Principal, query: { from?: string; to?: string }) {
    const tb = await this.trialBalance(principal, query);
    const revenue = tb.rows.filter((r) => r.accountType === 'REVENUE');
    const expenses = tb.rows.filter((r) => r.accountType === 'EXPENSE');
    const assets = tb.rows.filter((r) => r.accountType === 'ASSET');
    const liabilities = tb.rows.filter((r) => r.accountType === 'LIABILITY');
    const equity = tb.rows.filter((r) => r.accountType === 'EQUITY');
    const netIncome = sumMoney(revenue.map((r) => Money.fromDecimalString(r.balance))).minus(
      sumMoney(expenses.map((r) => Money.fromDecimalString(r.balance))),
    );
    return {
      trialBalanced: tb.balanced,
      incomeStatement: {
        revenue,
        expenses,
        netIncome: netIncome.toString(),
      },
      balanceSheet: {
        assets,
        liabilities,
        equity,
        retainedEarnings: netIncome.toString(),
        totalEquity: sumMoney(equity.map((r) => Money.fromDecimalString(r.balance)))
          .plus(netIncome)
          .toString(),
      },
    };
  }
}
