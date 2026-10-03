import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Job } from 'bullmq';
import type { PrismaService } from '@erp/prisma';
import { pino } from 'pino';
import {
  aggregate,
  buildSelect,
  buildWhere,
  columnLabels,
  isReportRuleError,
  nextRunAt as computeNextRunAt,
  toCsv,
  validateQueryDefinition,
  MAX_SOURCE_ROWS,
  SOURCE_CATALOGUE,
} from '@erp/reporting';
import { reportFiltersSchema, reportScheduleSpecSchema } from '@erp/validation';
import type { ReportQueryDefinition } from '@erp/reporting';
import type { ReportFilters, ReportScheduleSpec } from '@erp/validation';
import {
  createQueue,
  defaultJobOptions,
  JOB_REPORT_SCHEDULE_RUN,
  QUEUE_REPORTS,
} from '../queue.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'erp-worker' } });

/** Exports produced by a scheduled run expire on the same TTL as manual ones. */
const EXPORT_TTL_HOURS = 24;

export interface ReportScheduleJobData {
  scheduledReportId: string;
}

/** Structural view of a Prisma model delegate (mirrors the API's engine use). */
interface RowQuery {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, unknown>;
    take: number;
  }): Promise<unknown>;
}

/** Reads a stored schedule string back into its validated shape. */
export function parseSchedule(schedule: string): ReportScheduleSpec {
  const parsed = reportScheduleSpecSchema.safeParse(JSON.parse(schedule) as unknown);
  if (!parsed.success) throw new Error('Stored schedule is malformed');
  return parsed.data;
}

/**
 * Scheduled report delivery (Stage 11; USER-FLOWS §21.2).
 *
 * The worker owns the clock for scheduled reports: it polls due schedules,
 * claims each one atomically so two workers never run the same report twice,
 * then produces the artefact through the same engine the API uses — there is
 * exactly one report implementation in the system.
 *
 * Delivery stays honest: IN_APP produces a real downloadable export, while
 * EMAIL has no configured provider, so the run is recorded FAILED rather than
 * claiming a message was sent (CLAUDE.md §59).
 */
export class ReportScheduleProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async process(job: Job<ReportScheduleJobData>): Promise<void> {
    const { scheduledReportId } = job.data;
    const schedule = await this.prisma.scheduledReport.findUnique({
      where: { id: scheduledReportId },
      include: { definition: true },
    });
    if (!schedule) {
      logger.warn({ scheduledReportId }, 'scheduled report no longer exists; dropping job');
      return;
    }
    if (schedule.status !== 'ACTIVE') {
      logger.info({ scheduledReportId, status: schedule.status }, 'schedule not active; skipping');
      return;
    }

    const exportRow = await this.prisma.reportExport.create({
      data: {
        companyId: schedule.companyId,
        reportDefinitionId: schedule.reportDefinitionId,
        requestedById: schedule.ownerUserId,
        format: schedule.outputFormat,
        status: 'RUNNING',
        filters: schedule.filters ?? {},
      },
    });

    try {
      const spec = validateQueryDefinition(schedule.definition.queryDefinition);
      const filters = reportFiltersSchema.parse(schedule.filters ?? {});
      const grouping = spec.defaultGrouping;
      const rows = await this.fetchRows(spec, filters, schedule.companyId);
      const result = aggregate(spec, rows, { grouping });
      const payload = serialize(spec, schedule.outputFormat, grouping, result);
      const filename = exportFilename(schedule.definition.code, schedule.outputFormat, schedule.id);
      const storageKey = storeArtifact(schedule.companyId, filename, payload);

      await this.prisma.reportExport.update({
        where: { id: exportRow.id },
        data: {
          status: 'READY',
          storageKey,
          sizeBytes: payload.byteLength,
          rowCount: result.rows.length,
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + EXPORT_TTL_HOURS * 3600 * 1000),
        },
      });

      const delivered = await this.deliver(schedule, exportRow.id, result.rows.length, filename);

      await this.prisma.scheduledReport.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastDeliveryStatus: delivered ? 'DELIVERED' : 'FAILED',
          ...(delivered ? { lastDeliveredAt: new Date() } : {}),
        },
      });

      logger.info(
        { scheduledReportId: schedule.id, rows: result.rows.length, delivered },
        'scheduled report run complete',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.reportExport.update({
        where: { id: exportRow.id },
        data: {
          status: 'FAILED',
          errorMessage: message.slice(0, 500),
          errorCode: isReportRuleError(error) ? 'REPORT_RULE_ERROR' : 'EXPORT_FAILED',
          completedAt: new Date(),
        },
      });
      await this.prisma.scheduledReport.update({
        where: { id: schedule.id },
        data: { lastRunAt: new Date(), lastDeliveryStatus: 'FAILED' },
      });
      logger.error({ scheduledReportId: schedule.id, error: message }, 'scheduled report failed');
      throw error; // let BullMQ retry per its backoff policy
    }
  }

  /**
   * IN_APP notifies the owner with a link to the export. EMAIL has no provider
   * wired yet, so it records the shortfall instead of claiming a send.
   */
  private async deliver(
    schedule: {
      ownerUserId: string;
      companyId: string | null;
      definition: { name: string };
      deliveryChannel: string;
    },
    exportId: string,
    rowCount: number,
    filename: string,
  ): Promise<boolean> {
    if (schedule.deliveryChannel === 'EMAIL') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: schedule.ownerUserId,
          action: 'reporting.scheduled_run',
          resourceType: 'report_export',
          resourceId: exportId,
          companyId: schedule.companyId,
          metadata: {
            deliveryChannel: 'EMAIL',
            outcome: 'PROVIDER_UNAVAILABLE',
            note: 'No email provider configured; export produced but not emailed',
          },
        },
      });
      logger.warn({ exportId }, 'EMAIL has no configured provider; export left available in-app');
      return false;
    }

    await this.prisma.notification.create({
      data: {
        userId: schedule.ownerUserId,
        companyId: schedule.companyId,
        type: 'REPORT_SCHEDULED_READY',
        title: `${schedule.definition.name} is ready`,
        message: `${filename} (${rowCount} rows) is available for ${EXPORT_TTL_HOURS}h.`,
        resourceType: 'report_export',
        resourceId: exportId,
        channel: 'IN_APP',
        status: 'UNREAD',
      },
    });
    return true;
  }

  private async fetchRows(
    spec: ReportQueryDefinition,
    filters: ReportFilters,
    companyId: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    const source = SOURCE_CATALOGUE[spec.source];
    const where = buildWhere(spec, filters, companyId ? [companyId] : null);
    const prisma = this.prisma as unknown as Record<string, RowQuery>;
    const delegate = prisma[source.delegate];
    if (!delegate) throw new Error(`Unsupported report source: ${source.source}`);
    return (await delegate.findMany({
      where,
      select: buildSelect(source, spec),
      take: MAX_SOURCE_ROWS,
    })) as Array<Record<string, unknown>>;
  }
}

/**
 * Polls for due schedules and enqueues them. Claiming advances `nextRunAt`
 * before the job runs, so a slow or crashing run cannot be picked up twice.
 */
export class ReportScheduleRelay {
  private readonly reportsQueue = createQueue(QUEUE_REPORTS);

  constructor(private readonly prisma: PrismaService) {}

  async pollAndEnqueue(): Promise<number> {
    const batchSize = Number(process.env.REPORT_SCHEDULE_BATCH_SIZE ?? 20);
    const due = await this.prisma.scheduledReport.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
      take: batchSize,
    });

    let enqueued = 0;
    for (const schedule of due) {
      // A malformed schedule must not wedge the whole poll loop.
      let next: Date;
      try {
        next = computeNextRunAt(parseSchedule(schedule.schedule), schedule.timezone);
      } catch (error: unknown) {
        logger.error(
          {
            scheduledReportId: schedule.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'skipping scheduled report with an unusable schedule',
        );
        await this.prisma.scheduledReport.update({
          where: { id: schedule.id },
          data: { status: 'DISABLED' },
        });
        continue;
      }

      // Conditional update: whoever advances nextRunAt owns this occurrence.
      const claimed = await this.prisma.scheduledReport.updateMany({
        where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt: next },
      });
      if (claimed.count === 0) continue;

      await this.reportsQueue.add(
        JOB_REPORT_SCHEDULE_RUN,
        { scheduledReportId: schedule.id },
        {
          jobId: `report-schedule:${schedule.id}:${schedule.nextRunAt.getTime()}`,
          ...defaultJobOptions(),
        },
      );
      enqueued++;
    }
    return enqueued;
  }

  async close(): Promise<void> {
    await this.reportsQueue.close();
  }
}

function serialize(
  spec: ReportQueryDefinition,
  format: string,
  grouping: string[],
  result: ReturnType<typeof aggregate>,
): Buffer {
  const headers = columnLabels(spec, grouping);
  if (format === 'JSON') {
    return Buffer.from(
      JSON.stringify(
        {
          report: spec.source,
          headers,
          rows: result.rows,
          totals: result.totals,
          generatedAt: new Date(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  return Buffer.from(toCsv([...grouping, ...spec.metrics], result.rows), 'utf8');
}

function exportFilename(code: string, format: string, scheduledReportId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${code}-${day}-${scheduledReportId.slice(0, 8)}.${format.toLowerCase()}`;
}

/**
 * The worker has no Nest DI, so artefacts are written to the same local
 * documents directory the API's local storage driver reads. Deployments on
 * S3 keep scheduled exports on the manual path until a shared driver lands.
 */
function storeArtifact(companyId: string | null, filename: string, payload: Buffer): string {
  const base = process.env.LOCAL_STORAGE_PATH ?? './data/documents';
  const storageKey = `companies/${companyId ?? 'shared'}/${new Date().getUTCFullYear()}/${filename}`;
  const full = resolve(base, storageKey);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, payload);
  return storageKey;
}
