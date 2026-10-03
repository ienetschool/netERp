import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OfficeService } from './office.service.js';
import { RequirePermissions, PermissionsGuard } from '../iam/permissions.guard.js';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import {
  visitorCreateSchema,
  visitorCheckInSchema,
  visitorCheckOutSchema,
  callCreateSchema,
  callCompleteSchema,
  correspondenceCreateSchema,
  correspondenceAssignSchema,
  fileCreateSchema,
  fileIssueSchema,
  fileReturnSchema,
  fileArchiveSchema,
} from '@erp/validation';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal;
}

function requirePrincipal(req: AuthedRequest): RequestPrincipal {
  const principal = req.principal;
  if (!principal) {
    throw new Error('Authentication principal missing; auth guard misconfigured');
  }
  return principal;
}

function parsePagination(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize ?? '50', 10) || 50));
  return { page: p, pageSize: ps };
}

/**
 * Office endpoints (PRD Stage 9). Class-level guards with per-route
 * RequirePermissions, matching the controller pattern of inventory/sales.
 */
@Controller('office')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  // ---- Visitors -----------------------------------------------------------

  @Post('visitors')
  @RequirePermissions('office.visitor.create')
  async createVisitor(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = visitorCreateSchema.parse(body);
    return this.office.createVisitor(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('visitors')
  @RequirePermissions('office.visitor.view')
  async listVisitors(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.office.listVisitors(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
    });
  }

  @Post('visitors/:id/check-in')
  @RequirePermissions('office.visitor.edit')
  async checkIn(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = visitorCheckInSchema.parse(body ?? {});
    return this.office.checkInVisitor(requirePrincipal(req), id, input, getRequestId(req));
  }

  @Post('visitors/:id/check-out')
  @RequirePermissions('office.visitor.edit')
  async checkOut(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = visitorCheckOutSchema.parse(body ?? {});
    return this.office.checkOutVisitor(requirePrincipal(req), id, input, getRequestId(req));
  }

  // ---- Call log -----------------------------------------------------------

  @Post('calls')
  @RequirePermissions('office.call.create')
  async createCall(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = callCreateSchema.parse(body);
    return this.office.createCall(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('calls')
  @RequirePermissions('office.call.view')
  async listCalls(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.office.listCalls(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
    });
  }

  @Post('calls/:id/complete')
  @RequirePermissions('office.call.edit')
  async completeCall(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = callCompleteSchema.parse(body ?? {});
    return this.office.completeCall(requirePrincipal(req), id, input, getRequestId(req));
  }

  // ---- Correspondence -----------------------------------------------------

  @Post('correspondence')
  @RequirePermissions('office.correspondence.create')
  async createCorrespondence(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = correspondenceCreateSchema.parse(body);
    return this.office.createCorrespondence(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('correspondence')
  @RequirePermissions('office.correspondence.view')
  async listCorrespondence(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Query('direction') direction: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.office.listCorrespondence(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
      ...(direction ? { direction } : {}),
    });
  }

  @Post('correspondence/:id/assign')
  @RequirePermissions('office.correspondence.edit')
  async assignCorrespondence(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const input = correspondenceAssignSchema.parse(body);
    return this.office.assignCorrespondence(requirePrincipal(req), id, input, getRequestId(req));
  }

  @Post('correspondence/:id/close')
  @RequirePermissions('office.correspondence.edit')
  async closeCorrespondence(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.office.closeCorrespondence(requirePrincipal(req), id, getRequestId(req));
  }

  // ---- File room ----------------------------------------------------------

  @Post('files')
  @RequirePermissions('office.file_room.create')
  async createFile(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = fileCreateSchema.parse(body);
    return this.office.createFile(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('files')
  @RequirePermissions('office.file_room.view')
  async listFiles(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.office.listFiles(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
    });
  }

  @Get('files/:id/movements')
  @RequirePermissions('office.file_room.view')
  async fileMovements(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.office.getFileMovements(requirePrincipal(req), id);
  }

  @Post('files/:id/issue')
  @RequirePermissions('office.file_room.edit')
  async issueFile(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = fileIssueSchema.parse(body);
    return this.office.issueFile(requirePrincipal(req), id, input, getRequestId(req));
  }

  @Post('files/:id/return')
  @RequirePermissions('office.file_room.edit')
  async returnFile(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = fileReturnSchema.parse(body ?? {});
    return this.office.returnFile(requirePrincipal(req), id, input, getRequestId(req));
  }

  @Post('files/:id/archive')
  @RequirePermissions('office.file_room.edit')
  async archiveFile(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = fileArchiveSchema.parse(body ?? {});
    return this.office.archiveFile(requirePrincipal(req), id, input, getRequestId(req));
  }
}
