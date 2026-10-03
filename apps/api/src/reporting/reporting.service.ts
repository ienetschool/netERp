import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { PermissionSet } from '@erp/permissions';
import {
  NotFoundError,
  BusinessRuleError,
  AuthorizationError,
  ConflictError,
} from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { StorageService } from '../platform/storage.service.js';
import { NotificationsService } from '../platform/notifications.service.js';
import {
  aggregate,
  buildSelect,
  buildWhere,
  columnLabels,
  flattenRow,
  isReportRuleError,
  nextRunAt as computeNextRunAt,
  supportedFilters,
  toCsv,
  validateQueryDefinition,
  MAX_SOURCE_ROWS,
  SOURCE_CATALOGUE,
} from '@erp/reporting';
import type { ReportQueryDefinition, SourceSpec } from '@erp/reporting';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import type {
  ReportFilters,
  ReportRunInput,
  ReportExportCreateInput,
  SavedReportCreateInput,
  ScheduledReportCreateInput,
  ReportScheduleSpec,
} from '@erp/validation';

type Principal = RequestPrincipal & { isSuperAdmin?: boolean };

/** Structural view of a Prisma model delegate used by the report engine. */
interface RowQuery {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, unknown>;
    take: number;
  }): Promise<unknown>;
}

/** Exports are stored temporarily and then expire (USER-FLOWS §21.2). */
const EXPORT_TTL_HOURS = 24;

/** True for a Prisma unique-constraint violation (P2002). */
function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * The report engine is framework-free, so it raises its own rule error. The
 * HTTP taxonomy owns the status codes, so translate at the boundary rather
 * than letting the engine depend on Nest.
 */
function reporting<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error: unknown) {
    if (isReportRuleError(error)) throw new BusinessRuleError(error.message);
    throw error;
  }
}

/**
 * Reporting (Stage 11; USER-FLOWS §21). Every run is permission-gated by the
 * definition's own `permission` key and scoped to the principal's companies;
 * the definition decides which filters are honoured (see packages/reporting).
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private canRun(principal: Principal, permission: string): boolean {
    if (principal.isSuperAdmin) return true;
    return new PermissionSet(principal.permissions).has(permission);
  }

  // ---- Definitions --------------------------------------------------------

  /** Definitions the caller may run: active, in scope, and permitted. */
  async listDefinitions(principal: Principal) {
    const rows = await this.prisma.reportDefinition.findMany({
      where: {
        status: 'ACTIVE',
        ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      },
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });
    const visible = rows.filter((row) => this.canRun(principal, row.permission));
    return {
      rows: visible.map((row) => this.describe(row)),
      total: visible.length,
      hiddenCount: rows.length - visible.length,
    };
  }

  private describe(row: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    module: string;
    permission: string;
    companyId: string | null;
    queryDefinition: unknown;
  }) {
    const spec = reporting(() => validateQueryDefinition(row.queryDefinition));
    const source = SOURCE_CATALOGUE[spec.source];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      module: row.module,
      permission: row.permission,
      companyId: row.companyId,
      dimensions: spec.dimensions.map((dimension) => ({
        key: dimension,
        label: source.dimensions[dimension]?.label ?? dimension,
      })),
      metrics: spec.metrics.map((metric) => ({
        key: metric,
        label: source.metrics[metric]?.label ?? metric,
      })),
      defaultGrouping: spec.defaultGrouping,
      supportedFilters: reporting(() => supportedFilters(source)),
    };
  }

  private async requireDefinition(principal: Principal, idOrCode: string) {
    const row = await this.prisma.reportDefinition.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }], status: 'ACTIVE' },
    });
    if (!row) throw new NotFoundError('Report definition not found');
    if (principal.companyIds && row.companyId && !principal.companyIds.includes(row.companyId)) {
      throw new NotFoundError('Report definition not found');
    }
    if (!this.canRun(principal, row.permission)) {
      throw new AuthorizationError('You do not have access to this report');
    }
    return row;
  }

  // ---- Running ------------------------------------------------------------

  async runReport(principal: Principal, idOrCode: string, input: ReportRunInput) {
    const definition = await this.requireDefinition(principal, idOrCode);
    const spec = reporting(() => validateQueryDefinition(definition.queryDefinition));
    const grouping = input.grouping.length > 0 ? input.grouping : spec.defaultGrouping;
    const { rows, sourceRows, truncated } = await this.fetchRows(spec, input.filters, principal);
    const result = reporting(() => aggregate(spec, rows, { grouping, sorting: input.sorting }));
    return {
      ...this.assemble(definition, spec, result, input, grouping),
      sourceRowCount: sourceRows,
      truncated,
    };
  }

  private assemble(
    definition: { code: string; name: string; module: string; id: string },
    spec: ReportQueryDefinition,
    result: ReturnType<typeof aggregate>,
    input: ReportRunInput,
    grouping: string[],
  ) {
    const source = SOURCE_CATALOGUE[spec.source];
    const columns = [
      ...grouping.map((dimension) => ({
        key: dimension,
        label: source.dimensions[dimension]?.label ?? dimension,
        kind: 'dimension' as const,
      })),
      ...spec.metrics.map((metric) => ({
        key: metric,
        label: source.metrics[metric]?.label ?? metric,
        kind: 'metric' as const,
      })),
    ];
    const start = (input.page - 1) * input.pageSize;
    return {
      definition: {
        id: definition.id,
        code: definition.code,
        name: definition.name,
        module: definition.module,
      },
      columns,
      headers: columnLabels(spec, grouping),
      rows: result.rows.slice(start, start + input.pageSize),
      totals: result.totals,
      page: input.page,
      pageSize: input.pageSize,
      total: result.rows.length,
    };
  }

  /** Loads source rows for a validated definition under the caller's scope. */
  private async fetchRows(
    spec: ReportQueryDefinition,
    filters: ReportFilters | undefined,
    principal: Principal,
    includeDetailFields = false,
  ): Promise<{ rows: Array<Record<string, unknown>>; sourceRows: number; truncated: boolean }> {
    const source = SOURCE_CATALOGUE[spec.source];
    const where = reporting(() => buildWhere(spec, filters, principal.companyIds));
    const select = buildSelect(source, spec, { includeDetailFields });
    const rows = (await this.rowQuery(source).findMany({
      where,
      select,
      take: MAX_SOURCE_ROWS,
    })) as Array<Record<string, unknown>>;
    return {
      rows,
      sourceRows: rows.length,
      truncated: rows.length >= MAX_SOURCE_ROWS,
    };
  }

  /**
   * The engine produces the `where`/`select` shapes and the catalogue validates
   * every field path, so delegates are accessed through one structural type
   * rather than a union of eight unrelated delegate types.
   */
  private rowQuery(source: SourceSpec): RowQuery {
    const prisma = this.prisma as unknown as Record<string, RowQuery>;
    const delegate = prisma[source.delegate];
    if (!delegate) throw new BusinessRuleError(`Unsupported report source: ${source.source}`);
    return delegate;
  }

  /** Drill-down: the underlying transactions behind one aggregated group. */
  async drillDown(
    principal: Principal,
    idOrCode: string,
    input: ReportRunInput,
    groupKey: Record<string, string>,
  ) {
    const definition = await this.requireDefinition(principal, idOrCode);
    const spec = reporting(() => validateQueryDefinition(definition.queryDefinition));
    const source = SOURCE_CATALOGUE[spec.source];
    const { rows } = await this.fetchRows(spec, input.filters, principal, true);

    const matching = rows.filter((row) =>
      Object.entries(groupKey).every(([dimension, value]) => {
        const path = source.dimensions[dimension]?.path;
        if (!path) return true;
        return (flattenRow(row, [path])[path] ?? '') === value;
      }),
    );

    return {
      definition: { code: definition.code, name: definition.name },
      headers: source.detailFields.map((field) => field.label),
      rows: matching
        .slice(0, 200)
        .map((row) => source.detailFields.map((f) => flattenRow(row, [f.path])[f.path] ?? '')),
      matched: matching.length,
      truncated: matching.length > 200,
    };
  }

  // ---- Exports ------------------------------------------------------------

  async createExport(
    principal: Principal,
    input: ReportExportCreateInput,
    requestId: string | null,
  ) {
    const definition = await this.requireDefinition(principal, input.reportDefinitionId);
    const spec = reporting(() => validateQueryDefinition(definition.queryDefinition));
    const grouping = spec.defaultGrouping;
    const { rows } = await this.fetchRows(spec, input.filters, principal);
    const result = reporting(() => aggregate(spec, rows, { grouping }));

    const companyId = input.filters?.companyId ?? principal.companyIds?.[0] ?? null;
    const exportRow = await this.prisma.reportExport.create({
      data: {
        companyId,
        reportDefinitionId: definition.id,
        requestedById: principal.userId,
        format: input.format,
        status: 'RUNNING',
        filters: input.filters ?? {},
      },
    });

    try {
      const headers = reporting(() => columnLabels(spec, grouping));
      const payload =
        input.format === 'JSON'
          ? Buffer.from(
              JSON.stringify(
                { headers, rows: result.rows, totals: result.totals, generatedAt: new Date() },
                null,
                2,
              ),
              'utf8',
            )
          : Buffer.from(
              reporting(() => toCsv([...grouping, ...spec.metrics], result.rows)),
              'utf8',
            );

      const filename = `${definition.code}-${new Date().toISOString().slice(0, 10)}.${input.format.toLowerCase()}`;
      const contentType = input.format === 'JSON' ? 'application/json' : 'text/csv; charset=utf-8';
      const stored =
        companyId !== null
          ? await this.storage.put({ companyId }, filename, payload, contentType)
          : await this.storage.put({ companyId: 'shared' }, filename, payload, contentType);

      const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 3600 * 1000);
      const completed = await this.prisma.reportExport.update({
        where: { id: exportRow.id },
        data: {
          status: 'READY',
          storageKey: stored.storageKey,
          sizeBytes: stored.sizeBytes,
          rowCount: result.rows.length,
          completedAt: new Date(),
          expiresAt,
        },
      });

      await this.audit.record({
        actorUserId: principal.userId,
        action: 'reporting.export_created',
        resourceType: 'report_export',
        resourceId: completed.id,
        companyId,
        requestId,
        metadata: {
          definition: definition.code,
          format: input.format,
          rowCount: result.rows.length,
        },
      });

      await this.notifications.notify({
        userId: principal.userId,
        companyId,
        type: 'REPORT_EXPORT_READY',
        title: 'Your report export is ready',
        message: `${definition.name} (${result.rows.length} rows) is available for ${EXPORT_TTL_HOURS}h.`,
        resourceType: 'report_export',
        resourceId: completed.id,
        channels: ['IN_APP'],
      });

      return completed;
    } catch (error: unknown) {
      await this.prisma.reportExport.update({
        where: { id: exportRow.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Export failed',
          errorCode: 'EXPORT_FAILED',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async listExports(principal: Principal, page: number, pageSize: number) {
    const where: Prisma.ReportExportWhereInput = { requestedById: principal.userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.reportExport.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reportExport.count({ where }),
    ]);
    return { rows, total };
  }

  /** Secure download: owner only, and only while the artefact has not expired. */
  async downloadExport(principal: Principal, id: string, requestId: string | null) {
    const row = await this.prisma.reportExport.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Export not found');
    if (row.requestedById !== principal.userId) throw new NotFoundError('Export not found');
    if (row.status !== 'READY' || !row.storageKey) {
      throw new BusinessRuleError(`Export is ${row.status.toLowerCase()} and cannot be downloaded`);
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      await this.prisma.reportExport.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw new BusinessRuleError('Export has expired; run the report again');
    }
    const data = await this.storage.get(row.storageKey);
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'reporting.export_downloaded',
      resourceType: 'report_export',
      resourceId: row.id,
      companyId: row.companyId,
      requestId,
      metadata: { format: row.format, sizeBytes: data.byteLength },
    });
    return {
      filename: `report-export-${row.id}.${row.format.toLowerCase()}`,
      contentType: row.format === 'JSON' ? 'application/json' : 'text/csv; charset=utf-8',
      data,
    };
  }

  // ---- Saved reports ------------------------------------------------------

  async listSaved(principal: Principal, definitionId?: string) {
    const where: Prisma.SavedReportWhereInput = {
      userId: principal.userId,
      ...(definitionId ? { reportDefinitionId: definitionId } : {}),
    };
    const rows = await this.prisma.savedReport.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { reportDefinition: { select: { code: true, name: true, module: true } } },
    });
    return { rows, total: rows.length };
  }

  async createSaved(principal: Principal, input: SavedReportCreateInput) {
    const definition = await this.requireDefinition(principal, input.reportDefinitionId);
    try {
      return await this.prisma.savedReport.create({
        data: {
          userId: principal.userId,
          reportDefinitionId: definition.id,
          name: input.name,
          filters: input.filters ?? {},
          columns: input.columns,
          sorting: input.sorting ?? {},
          grouping: input.grouping,
        },
      });
    } catch (error: unknown) {
      // (userId, reportDefinitionId, name) is unique; surface the clash as a
      // conflict rather than letting a raw driver error become a 500.
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictError('You already have a saved report with that name');
      }
      throw error;
    }
  }

  async deleteSaved(principal: Principal, id: string): Promise<void> {
    const row = await this.prisma.savedReport.findUnique({ where: { id } });
    if (!row || row.userId !== principal.userId) throw new NotFoundError('Saved report not found');
    await this.prisma.savedReport.delete({ where: { id } });
  }

  // ---- Scheduled reports --------------------------------------------------

  async listScheduled(principal: Principal) {
    const where: Prisma.ScheduledReportWhereInput = {
      ownerUserId: principal.userId,
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    const rows = await this.prisma.scheduledReport.findMany({
      where,
      orderBy: { nextRunAt: 'asc' },
      include: { definition: { select: { code: true, name: true, module: true } } },
    });
    return { rows, total: rows.length };
  }

  async createScheduled(principal: Principal, input: ScheduledReportCreateInput) {
    const definition = await this.requireDefinition(principal, input.reportDefinitionId);
    const companyId = input.filters?.companyId ?? principal.companyIds?.[0] ?? null;
    const row = await this.prisma.scheduledReport.create({
      data: {
        reportDefinitionId: definition.id,
        ownerUserId: principal.userId,
        companyId,
        schedule: JSON.stringify(input.schedule),
        timezone: input.timezone,
        filters: input.filters ?? {},
        outputFormat: input.outputFormat,
        deliveryChannel: input.deliveryChannel,
        recipientConfiguration: input.recipientConfiguration,
        nextRunAt: reporting(() => computeNextRunAt(input.schedule, input.timezone)),
      },
      include: { definition: { select: { code: true, name: true } } },
    });

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'reporting.schedule_created',
      resourceType: 'scheduled_report',
      resourceId: row.id,
      companyId,
      requestId: null,
      metadata: { definition: definition.code, schedule: input.schedule.frequency },
    });
    return row;
  }

  async setScheduledStatus(
    principal: Principal,
    id: string,
    status: 'ACTIVE' | 'PAUSED' | 'DISABLED',
  ) {
    const row = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!row || row.ownerUserId !== principal.userId) {
      throw new NotFoundError('Scheduled report not found');
    }
    const data: Prisma.ScheduledReportUpdateInput = { status };
    // Resuming recomputes the next run so a long-paused report does not fire
    // for every missed slot at once.
    if (status === 'ACTIVE' && row.status !== 'ACTIVE') {
      const schedule = parseSchedule(row.schedule);
      data.nextRunAt = reporting(() => computeNextRunAt(schedule, row.timezone));
    }
    return this.prisma.scheduledReport.update({ where: { id }, data });
  }

  async deleteScheduled(principal: Principal, id: string): Promise<void> {
    const row = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!row || row.ownerUserId !== principal.userId) {
      throw new NotFoundError('Scheduled report not found');
    }
    await this.prisma.scheduledReport.delete({ where: { id } });
  }
}

/** Parses a stored schedule string back into its validated shape. */
export function parseSchedule(schedule: string): ReportScheduleSpec {
  return reporting(() => parseStoredSchedule(schedule));
}

function parseStoredSchedule(schedule: string): ReportScheduleSpec {
  const parsed = JSON.parse(schedule) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BusinessRuleError('Stored schedule is malformed');
  }
  const candidate = parsed as Partial<ReportScheduleSpec>;
  if (
    (candidate.frequency !== 'DAILY' &&
      candidate.frequency !== 'WEEKLY' &&
      candidate.frequency !== 'MONTHLY') ||
    typeof candidate.time !== 'string'
  ) {
    throw new BusinessRuleError('Stored schedule is malformed');
  }
  return candidate as ReportScheduleSpec;
}
