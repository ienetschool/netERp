import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { RequirePermissions } from '../iam/permissions.guard.js';
import { HrService } from './hr.service.js';
import { NotFoundError, ValidationError } from '../common/errors.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import {
  employeeCreateSchema,
  employeeUpdateSchema,
  attendanceUpsertSchema,
  leaveRequestCreateSchema,
  holidayCreateSchema,
  paginationSchema,
} from '@erp/validation';
import type { ZodTypeAny, z } from 'zod';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

type Principal = RequestPrincipal & { isSuperAdmin?: boolean };

function requirePrincipal(req: AuthedRequest): Principal {
  if (!req.principal) throw new NotFoundError('Principal missing');
  return req.principal;
}

function parseOrThrow<T extends ZodTypeAny>(schema: T, body: unknown, label: string): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`Invalid ${label}`, {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

function parsePagination(
  page: string | undefined,
  pageSize: string | undefined,
): {
  page: number;
  pageSize: number;
} {
  const parsed = paginationSchema.safeParse({ page: page ?? 1, pageSize: pageSize ?? 25 });
  if (!parsed.success) throw new ValidationError('Invalid pagination');
  return parsed.data;
}

/**
 * HR endpoints (PRD Stage 3): employees, attendance, leave, holidays.
 */
@Controller('hr')
@UseGuards(JwtAuthGuard)
export class HrController {
  constructor(private readonly hr: HrService) {}

  // ---- Employees -----------------------------------------------------------

  @Post('employees')
  @RequirePermissions('hr.employee.create')
  async createEmployee(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(employeeCreateSchema, body, 'employee');
    return { data: await this.hr.createEmployee(principal, input, getRequestId(req)) };
  }

  @Get('employees')
  async listEmployees(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    return { data: await this.hr.listEmployees(principal, parsePagination(page, pageSize)) };
  }

  @Get('employees/:id')
  async getEmployee(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    return { data: await this.hr.getEmployee(requirePrincipal(req), id) };
  }

  @Post('employees/:id')
  @RequirePermissions('hr.employee.edit')
  async updateEmployee(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(employeeUpdateSchema, body, 'employee update');
    return { data: await this.hr.updateEmployee(principal, id, input, getRequestId(req)) };
  }

  @Post('employees/:id/employment-status')
  @RequirePermissions('hr.employee.edit')
  async setEmploymentStatus(
    @Param('id') id: string,
    @Body() body: { employmentStatus?: string } | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    if (!body?.employmentStatus) {
      throw new ValidationError('employmentStatus is required');
    }
    return {
      data: await this.hr.setEmploymentStatus(
        principal,
        id,
        body.employmentStatus,
        getRequestId(req),
      ),
    };
  }

  // ---- Attendance ----------------------------------------------------------

  @Post('attendance')
  @RequirePermissions('hr.attendance.create', 'hr.attendance.edit')
  async upsertAttendance(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(attendanceUpsertSchema, body, 'attendance');
    return { data: await this.hr.upsertAttendance(principal, input) };
  }

  @Get('attendance')
  async listAttendance(
    @Query('employeeId') employeeId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    return {
      data: await this.hr.listAttendance(principal, {
        employeeId,
        from,
        to,
        ...parsePagination(page, pageSize),
      }),
    };
  }

  // ---- Leave ---------------------------------------------------------------

  @Post('leave-requests')
  @RequirePermissions('hr.leave.create')
  async createLeaveRequest(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(leaveRequestCreateSchema, body, 'leave request');
    return { data: await this.hr.createLeaveRequest(principal, input, getRequestId(req)) };
  }

  @Get('leave-requests')
  async listLeaveRequests(
    @Query('status') status: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    return {
      data: await this.hr.listLeaveRequests(principal, {
        status,
        employeeId,
        ...parsePagination(page, pageSize),
      }),
    };
  }

  @Post('leave-requests/:id/submit')
  @RequirePermissions('hr.leave.submit')
  async submitLeaveRequest(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    return { data: await this.hr.submitLeaveRequest(principal, id, getRequestId(req)) };
  }

  @Get('leave-types')
  async listLeaveTypes(
    @Query('companyId') companyId: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    return { data: await this.hr.listLeaveTypes(principal, companyId ?? null) };
  }

  // ---- Holidays ------------------------------------------------------------

  @Post('holidays')
  @RequirePermissions('hr.holiday.create')
  async createHoliday(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(holidayCreateSchema, body, 'holiday');
    return { data: await this.hr.createHoliday(principal, input, getRequestId(req)) };
  }

  @Get('holidays')
  async listHolidays(
    @Query('year') year: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const y = Number(year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(y) || y < 1970 || y > 2999) throw new ValidationError('Invalid year');
    return { data: await this.hr.listHolidays(principal, y) };
  }
}
