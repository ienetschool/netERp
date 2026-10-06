import { Controller, Get, Logger, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { PermissionSet, SEARCH_ENTITY_PERMISSIONS } from '@erp/permissions';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

/**
 * How many source tables one search may query at the same time.
 *
 * The database is reached through a pooler that allows a small fixed number of
 * sessions, so the fan-out has to stay well under it. Measured against the
 * preview database: 3 keeps a search clean even with several simultaneous
 * searches, while 5 and 8 both log `EMAXCONNSESSION` and fall back to partial
 * results. Exported so the concurrency test asserts the real bound.
 */
export const SEARCH_BATCH_SIZE = 3;

interface SearchResult {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  updatedAt: Date;
}

/**
 * Global search uses authoritative module tables: SearchDocument has no
 * writers, and therefore was always empty. Each source is queried only when
 * the caller has its view permission and is constrained by organization scope.
 */
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async search(@Query('q') query: string | undefined, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = req.principal;
    if (!principal) return this.emptyResult(req);

    const q = (query ?? '').trim();
    if (q.length < 2 || q.length > 100) return this.emptyResult(req);

    const permissions = new PermissionSet(principal.permissions);
    const can = (entityType: string) => {
      if (principal.isSuperAdmin === true) return true;
      const permission = SEARCH_ENTITY_PERMISSIONS[entityType];
      if (permission !== undefined && permissions.has(permission)) return true;
      return entityType === 'document' && permissions.has('office.document.view');
    };
    const companyScope =
      principal.companyIds === null ? {} : { companyId: { in: principal.companyIds } };
    // Company-scoped assignments with no branch IDs are company-wide, matching
    // existing list services. Non-empty branch assignments may also see
    // company-level records that have no branch.
    const branchClause =
      principal.branchIds === null || principal.branchIds.length === 0
        ? []
        : [{ OR: [{ branchId: null }, { branchId: { in: principal.branchIds } }] }];
    const departmentClause =
      principal.departmentIds === null || principal.departmentIds.length === 0
        ? []
        : [{ departmentId: { in: principal.departmentIds } }];
    const permissionKeys = permissions.keys();
    const reportPermissionFilters: Array<{
      permission: string | { startsWith: string };
    }> = [];
    for (const permission of permissionKeys) {
      if (permission.endsWith('.*')) {
        reportPermissionFilters.push({
          permission: { startsWith: permission.slice(0, -1) },
        });
      } else if (!permission.includes('*')) {
        reportPermissionFilters.push({ permission });
      }
    }
    const hasUnrestrictedReportAccess = principal.isSuperAdmin === true || permissions.has('*');
    const scopedAnd = (clauses: object[]) => ({
      AND: [...branchClause, ...clauses],
    });
    // Every permitted source contributes one query. Firing them all in a single
    // Promise.all opened every connection at once and exhausted the database
    // pooler (Supabase reports `max clients reached in session mode`), which
    // failed the whole search with a 500. Sources are collected as thunks and
    // run in batches of SEARCH_BATCH_SIZE so the connection count stays bounded
    // no matter how many modules the caller can read.
    const all = async (
      sources: Array<[string, () => Promise<SearchResult[]>]>,
    ): Promise<SearchResult[]> => {
      const collected: SearchResult[] = [];
      const failures: string[] = [];
      for (let index = 0; index < sources.length; index += SEARCH_BATCH_SIZE) {
        const batch = sources.slice(index, index + SEARCH_BATCH_SIZE);
        const settled = await Promise.allSettled(batch.map(([, run]) => run()));
        settled.forEach((outcome, position) => {
          if (outcome.status === 'fulfilled') {
            collected.push(...outcome.value);
            return;
          }
          const entry = batch[position];
          if (entry === undefined) return;
          // One unavailable table must not blank the whole palette; the other
          // sources still answer, and the reason is logged with the request id.
          const [name] = entry;
          failures.push(name);
          this.logger.warn(
            `search source "${name}" failed for request ${getRequestId(req)}: ${
              outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
            }`,
          );
        });
      }
      // Every source failing is an outage, not an empty result set: surface it.
      if (failures.length === sources.length && sources.length > 0) {
        throw new Error(`All search sources failed: ${failures.join(', ')}`);
      }
      return collected;
    };
    const result = (
      entityType: string,
      entityId: string,
      title: string,
      subtitle: string | null,
      status: string | null,
      updatedAt: Date,
    ): SearchResult => ({ entityType, entityId, title, subtitle, status, updatedAt });

    const searches: Array<[string, () => Promise<SearchResult[]>]> = [];
    const source = (name: string, run: () => Promise<SearchResult[]>) => {
      searches.push([name, run]);
    };

    if (can('employee')) {
      source('employee', () =>
        this.prisma.employee
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                ...departmentClause,
                {
                  OR: [
                    { displayName: { contains: q, mode: 'insensitive' } },
                    { employeeNo: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } },
                    { jobTitle: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: {
              id: true,
              displayName: true,
              employeeNo: true,
              employmentStatus: true,
              updatedAt: true,
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'employee',
                row.id,
                row.displayName,
                row.employeeNo,
                row.employmentStatus,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('supplier')) {
      source('supplier', () =>
        this.prisma.supplier
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { displayName: { contains: q, mode: 'insensitive' } },
                    { legalName: { contains: q, mode: 'insensitive' } },
                    { supplierNo: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: {
              id: true,
              displayName: true,
              supplierNo: true,
              status: true,
              updatedAt: true,
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'supplier',
                row.id,
                row.displayName,
                row.supplierNo,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('customer')) {
      source('customer', () =>
        this.prisma.customer
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { displayName: { contains: q, mode: 'insensitive' } },
                    { legalName: { contains: q, mode: 'insensitive' } },
                    { customerNo: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: {
              id: true,
              displayName: true,
              customerNo: true,
              status: true,
              updatedAt: true,
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'customer',
                row.id,
                row.displayName,
                row.customerNo,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('product')) {
      source('product', () =>
        this.prisma.product
          .findMany({
            where: {
              ...companyScope,
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { barcode: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: { id: true, name: true, sku: true, status: true, updatedAt: true },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result('product', row.id, row.name, row.sku, row.status, row.updatedAt),
            ),
          ),
      );
    }

    if (can('purchase_request')) {
      source('purchaseRequest', () =>
        this.prisma.purchaseRequest
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { requestNo: { contains: q, mode: 'insensitive' } },
                    { purpose: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: { id: true, requestNo: true, purpose: true, status: true, updatedAt: true },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'purchase_request',
                row.id,
                row.requestNo,
                row.purpose,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('purchase_order')) {
      source('purchaseOrder', () =>
        this.prisma.purchaseOrder
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([{ poNo: { contains: q, mode: 'insensitive' } }]),
            },
            select: {
              id: true,
              poNo: true,
              status: true,
              updatedAt: true,
              supplier: { select: { displayName: true } },
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'purchase_order',
                row.id,
                row.poNo,
                row.supplier.displayName,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('sales_order')) {
      source('salesOrder', () =>
        this.prisma.salesOrder
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([{ orderNo: { contains: q, mode: 'insensitive' } }]),
            },
            select: {
              id: true,
              orderNo: true,
              status: true,
              updatedAt: true,
              customer: { select: { displayName: true } },
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'sales_order',
                row.id,
                row.orderNo,
                row.customer.displayName,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('delivery')) {
      source('delivery', () =>
        this.prisma.delivery
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([{ deliveryNo: { contains: q, mode: 'insensitive' } }]),
            },
            select: {
              id: true,
              deliveryNo: true,
              status: true,
              updatedAt: true,
              customer: { select: { displayName: true } },
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'delivery',
                row.id,
                row.deliveryNo,
                row.customer.displayName,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('customer_invoice')) {
      source('customerInvoice', () =>
        this.prisma.customerInvoice
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([{ invoiceNo: { contains: q, mode: 'insensitive' } }]),
            },
            select: {
              id: true,
              invoiceNo: true,
              status: true,
              updatedAt: true,
              customer: { select: { displayName: true } },
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'customer_invoice',
                row.id,
                row.invoiceNo,
                row.customer.displayName,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('journal_entry')) {
      source('journalEntry', () =>
        this.prisma.journalEntry
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { journalNo: { contains: q, mode: 'insensitive' } },
                    { description: { contains: q, mode: 'insensitive' } },
                    { sourceDocumentNo: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: { id: true, journalNo: true, description: true, status: true, updatedAt: true },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'journal_entry',
                row.id,
                row.journalNo,
                row.description,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('document')) {
      source('document', () =>
        this.prisma.document
          .findMany({
            where: {
              AND: [
                companyScope,
                ...branchClause,
                {
                  OR: [
                    { title: { contains: q, mode: 'insensitive' } },
                    { filename: { contains: q, mode: 'insensitive' } },
                    { description: { contains: q, mode: 'insensitive' } },
                  ],
                },
                {
                  OR: [
                    { accessPolicy: 'COMPANY' },
                    ...(principal.branchIds === null || principal.branchIds.length === 0
                      ? [{ accessPolicy: 'BRANCH' as const }]
                      : [
                          {
                            accessPolicy: 'BRANCH' as const,
                            branchId: { in: principal.branchIds },
                          },
                        ]),
                    { accessPolicy: 'PRIVATE', createdById: principal.userId },
                  ],
                },
              ],
            },
            select: {
              id: true,
              title: true,
              filename: true,
              documentType: true,
              updatedAt: true,
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result('document', row.id, row.title, row.filename, row.documentType, row.updatedAt),
            ),
          ),
      );
    }

    if (can('visitor')) {
      source('visitor', () =>
        this.prisma.visitor
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { visitorNo: { contains: q, mode: 'insensitive' } },
                    { name: { contains: q, mode: 'insensitive' } },
                    { companyName: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: {
              id: true,
              visitorNo: true,
              name: true,
              companyName: true,
              status: true,
              updatedAt: true,
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'visitor',
                row.id,
                row.name,
                [row.visitorNo, row.companyName].filter(Boolean).join(' · '),
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('call')) {
      source('callLog', () =>
        this.prisma.callLog
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { callerName: { contains: q, mode: 'insensitive' } },
                    { subject: { contains: q, mode: 'insensitive' } },
                    { notes: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: { id: true, callerName: true, subject: true, status: true, updatedAt: true },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result('call', row.id, row.subject, row.callerName, row.status, row.updatedAt),
            ),
          ),
      );
    }

    if (can('correspondence')) {
      source('correspondence', () =>
        this.prisma.correspondence
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { correspondenceNo: { contains: q, mode: 'insensitive' } },
                    { subject: { contains: q, mode: 'insensitive' } },
                    { sender: { contains: q, mode: 'insensitive' } },
                    { recipient: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: {
              id: true,
              correspondenceNo: true,
              subject: true,
              status: true,
              updatedAt: true,
            },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result(
                'correspondence',
                row.id,
                row.correspondenceNo,
                row.subject,
                row.status,
                row.updatedAt,
              ),
            ),
          ),
      );
    }

    if (can('file_record')) {
      source('fileRecord', () =>
        this.prisma.fileRecord
          .findMany({
            where: {
              ...companyScope,
              ...scopedAnd([
                {
                  OR: [
                    { fileNo: { contains: q, mode: 'insensitive' } },
                    { title: { contains: q, mode: 'insensitive' } },
                    { category: { contains: q, mode: 'insensitive' } },
                    { locationCode: { contains: q, mode: 'insensitive' } },
                  ],
                },
              ]),
            },
            select: { id: true, fileNo: true, title: true, status: true, updatedAt: true },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) =>
              result('file_record', row.id, row.title, row.fileNo, row.status, row.updatedAt),
            ),
          ),
      );
    }

    if (can('conversation')) {
      source('conversation', () =>
        this.prisma.conversation
          .findMany({
            where: {
              AND: [
                companyScope,
                { participants: { some: { userId: principal.userId } } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: { id: true, name: true, type: true, updatedAt: true },
            take: 5,
          })
          .then((rows) =>
            rows.map((row) => ({
              ...result(
                'conversation',
                row.id,
                row.name ?? `${row.type} conversation`,
                'Conversation',
                null,
                row.updatedAt,
              ),
            })),
          ),
      );
    }

    if (can('report') && (hasUnrestrictedReportAccess || reportPermissionFilters.length > 0)) {
      source('reportDefinition', () =>
        this.prisma.reportDefinition
          .findMany({
            where: {
              status: 'ACTIVE',
              ...companyScope,
              AND: [
                {
                  OR: [
                    { code: { contains: q, mode: 'insensitive' } },
                    { name: { contains: q, mode: 'insensitive' } },
                  ],
                },
                ...(hasUnrestrictedReportAccess
                  ? []
                  : [
                      {
                        OR: reportPermissionFilters.map((filter) => ({
                          permission: filter.permission,
                        })),
                      },
                    ]),
              ],
            },
            select: { id: true, code: true, name: true, permission: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          })
          .then((rows) =>
            rows
              .filter((row) => hasUnrestrictedReportAccess || permissions.has(row.permission))
              .slice(0, 5)
              .map((row) => result('report', row.id, row.name, row.code, null, row.updatedAt)),
          ),
      );
    }

    const matches = (await all(searches)).sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
    const visible = matches.slice(0, 30);
    const groups = visible.reduce<Record<string, SearchResult[]>>((acc, row) => {
      const group = acc[row.entityType] ?? [];
      group.push(row);
      acc[row.entityType] = group;
      return acc;
    }, {});

    return {
      data: groups,
      meta: {
        requestId: getRequestId(req),
        total: matches.length,
        truncated: matches.length > visible.length,
      },
    };
  }

  private emptyResult(req: AuthedRequest) {
    return {
      data: {},
      meta: { requestId: getRequestId(req), total: 0, truncated: false },
    };
  }
}
