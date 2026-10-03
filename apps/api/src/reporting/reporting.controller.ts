import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ReportingService } from './reporting.service.js';
import { RequirePermissions, PermissionsGuard } from '../iam/permissions.guard.js';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import {
  reportDrillDownSchema,
  reportRunSchema,
  reportExportCreateSchema,
  savedReportCreateSchema,
  scheduledReportCreateSchema,
  scheduledReportStatusSchema,
  reportScheduleSpecSchema,
  uuidSchema,
} from '@erp/validation';
import type { Request, Response } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import type { z } from 'zod';

type AuthedRequest = Request & { principal?: RequestPrincipal & { isSuperAdmin?: boolean } };
type ReportScheduleSpec = z.infer<typeof reportScheduleSpecSchema>;

function requirePrincipal(req: AuthedRequest): RequestPrincipal & { isSuperAdmin?: boolean } {
  const principal = req.principal;
  if (!principal) {
    throw new Error('Authentication principal missing; auth guard misconfigured');
  }
  return principal;
}

function parsePagination(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize ?? '25', 10) || 25));
  return { page: p, pageSize: ps };
}

/**
 * Reporting endpoints (Stage 11; USER-FLOWS §21). Class-level guards with
 * per-route RequirePermissions, matching the office/sales controller pattern.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  // ---- Catalogue ----------------------------------------------------------

  @Get('definitions')
  @RequirePermissions('reporting.report.view')
  async listDefinitions(@Req() req: AuthedRequest) {
    return this.reporting.listDefinitions(requirePrincipal(req));
  }

  @Post('definitions/:idOrCode/run')
  @RequirePermissions('reporting.report.view')
  async runReport(
    @Param('idOrCode') idOrCode: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const input = reportRunSchema.parse(body ?? {});
    return this.reporting.runReport(requirePrincipal(req), idOrCode, input);
  }

  /** Drill-down from an aggregated group to its transactions (UI-UX §21). */
  @Post('definitions/:idOrCode/drill-down')
  @RequirePermissions('reporting.report.view')
  async drillDown(
    @Param('idOrCode') idOrCode: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const input = reportDrillDownSchema.parse(body ?? {});
    return this.reporting.drillDown(requirePrincipal(req), idOrCode, input, input.groupKey);
  }

  // ---- Exports (USER-FLOWS §21.2) ----------------------------------------

  @Post('exports')
  @RequirePermissions('reporting.export.create')
  async createExport(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = reportExportCreateSchema.parse(body);
    return this.reporting.createExport(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('exports')
  @RequirePermissions('reporting.export.view')
  async listExports(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    const p = parsePagination(page, pageSize);
    return this.reporting.listExports(requirePrincipal(req), p.page, p.pageSize);
  }

  @Get('exports/:id/download')
  @RequirePermissions('reporting.export.download')
  async downloadExport(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.reporting.downloadExport(
      requirePrincipal(req),
      uuidSchema.parse(id),
      getRequestId(req),
    );
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.filename)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.data);
  }

  // ---- Saved configurations ----------------------------------------------

  @Get('saved')
  @RequirePermissions('reporting.report.view')
  async listSaved(
    @Query('definitionId') definitionId: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.reporting.listSaved(
      requirePrincipal(req),
      definitionId ? uuidSchema.parse(definitionId) : undefined,
    );
  }

  @Post('saved')
  @RequirePermissions('reporting.report.create')
  async createSaved(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = savedReportCreateSchema.parse(body);
    return this.reporting.createSaved(requirePrincipal(req), input);
  }

  @Delete('saved/:id')
  @RequirePermissions('reporting.report.edit')
  async deleteSaved(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.reporting.deleteSaved(requirePrincipal(req), uuidSchema.parse(id));
    return { deleted: true };
  }

  // ---- Scheduled reports (USER-FLOWS §21.3) ------------------------------

  @Get('scheduled')
  @RequirePermissions('reporting.report.view')
  async listScheduled(@Req() req: AuthedRequest) {
    return this.reporting.listScheduled(requirePrincipal(req));
  }

  @Post('scheduled')
  @RequirePermissions('reporting.report.create')
  async createScheduled(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = scheduledReportCreateSchema.parse(body);
    return this.reporting.createScheduled(requirePrincipal(req), input);
  }

  @Patch('scheduled/:id/status')
  @RequirePermissions('reporting.report.edit')
  async setScheduledStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const input = scheduledReportStatusSchema.parse(body);
    return this.reporting.setScheduledStatus(
      requirePrincipal(req),
      uuidSchema.parse(id),
      input.status,
    );
  }

  @Delete('scheduled/:id')
  @RequirePermissions('reporting.report.delete')
  async deleteScheduled(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.reporting.deleteScheduled(requirePrincipal(req), uuidSchema.parse(id));
    return { deleted: true };
  }
}

export type { ReportScheduleSpec };
