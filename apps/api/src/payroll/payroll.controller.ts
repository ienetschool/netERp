import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { RequirePermissions } from '../iam/permissions.guard.js';
import { PayrollService } from './payroll.service.js';
import { NotFoundError, ValidationError } from '../common/errors.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import {
  payGroupCreateSchema,
  salaryStructureCreateSchema,
  salaryAssignmentCreateSchema,
  payrollRunCreateSchema,
  payrollRunListSchema,
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

/**
 * Payroll endpoints (PRD Stage 4): pay groups, salary structures, salary
 * assignments, and payroll runs (calculate / submit / approve / post / cancel).
 * Compensation data is permission-controlled (UI-UX §23).
 */
@Controller('payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  // ---- Pay groups ----------------------------------------------------------

  @Post('pay-groups')
  @RequirePermissions('payroll.pay_group.create')
  async createPayGroup(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(payGroupCreateSchema, body, 'pay group');
    return { data: await this.payroll.createPayGroup(principal, input, getRequestId(req)) };
  }

  @Get('pay-groups')
  @RequirePermissions('payroll.pay_group.view')
  async listPayGroups(@Req() req: AuthedRequest): Promise<unknown> {
    return { data: await this.payroll.listPayGroups(requirePrincipal(req)) };
  }

  // ---- Salary structures ---------------------------------------------------

  @Post('salary-structures')
  @RequirePermissions('payroll.salary_structure.create')
  async createSalaryStructure(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(salaryStructureCreateSchema, body, 'salary structure');
    return { data: await this.payroll.createSalaryStructure(principal, input, getRequestId(req)) };
  }

  @Get('salary-structures')
  @RequirePermissions('payroll.salary_structure.view')
  async listSalaryStructures(@Req() req: AuthedRequest): Promise<unknown> {
    return { data: await this.payroll.listSalaryStructures(requirePrincipal(req)) };
  }

  // ---- Salary assignments --------------------------------------------------

  @Post('salary-assignments')
  @RequirePermissions('payroll.salary_structure.assign')
  async assignSalary(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(salaryAssignmentCreateSchema, body, 'salary assignment');
    return { data: await this.payroll.assignSalary(principal, input, getRequestId(req)) };
  }

  @Get('salary-assignments')
  @RequirePermissions('payroll.salary_structure.view')
  async listSalaryAssignments(
    @Query('employeeId') employeeId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = payrollRunListSchema.safeParse({ page: page ?? 1, pageSize: pageSize ?? 25 });
    if (!parsed.success) throw new ValidationError('Invalid pagination');
    return {
      data: await this.payroll.listSalaryAssignments(principal, {
        employeeId,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }

  // ---- Payroll runs --------------------------------------------------------

  @Post('runs')
  @RequirePermissions('payroll.payroll_run.create')
  async createPayrollRun(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(payrollRunCreateSchema, body, 'payroll run');
    return { data: await this.payroll.createPayrollRun(principal, input, getRequestId(req)) };
  }

  @Get('runs')
  @RequirePermissions('payroll.payroll_run.view')
  async listPayrollRuns(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = payrollRunListSchema.safeParse({
      status,
      page: page ?? 1,
      pageSize: pageSize ?? 25,
    });
    if (!parsed.success) throw new ValidationError('Invalid query');
    return {
      data: await this.payroll.listPayrollRuns(principal, {
        status: parsed.data.status,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }

  @Get('runs/:id')
  @RequirePermissions('payroll.payroll_run.view')
  async getPayrollRun(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    return { data: await this.payroll.getPayrollRun(requirePrincipal(req), id) };
  }

  @Post('runs/:id/calculate')
  @RequirePermissions('payroll.payroll_run.edit')
  async calculatePayrollRun(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    return {
      data: await this.payroll.calculatePayrollRun(principal, id, getRequestId(req)),
    };
  }

  @Post('runs/:id/submit')
  @RequirePermissions('payroll.payroll_run.submit')
  async submitPayrollRun(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    return { data: await this.payroll.submitPayrollRun(principal, id, getRequestId(req)) };
  }

  @Post('runs/:id/approve')
  @RequirePermissions('payroll.payroll_run.approve')
  async approvePayrollRun(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    return { data: await this.payroll.approvePayrollRun(principal, id, getRequestId(req)) };
  }

  @Post('runs/:id/post')
  @RequirePermissions('payroll.payroll_run.post')
  async postPayrollRun(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    return { data: await this.payroll.postPayrollRun(principal, id, getRequestId(req)) };
  }

  @Post('runs/:id/cancel')
  @RequirePermissions('payroll.payroll_run.cancel')
  async cancelPayrollRun(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    return { data: await this.payroll.cancelPayrollRun(principal, id, getRequestId(req)) };
  }
}
