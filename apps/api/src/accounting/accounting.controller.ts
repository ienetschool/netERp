import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountingService } from './accounting.service.js';
import { RequirePermissions, PermissionsGuard } from '../iam/permissions.guard.js';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { NotFoundError } from '../common/errors.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import { accountCreateSchema, accountUpdateSchema, journalCreateSchema } from '@erp/validation';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

function requirePrincipal(req: AuthedRequest): RequestPrincipal & { isSuperAdmin?: boolean } {
  if (!req.principal) throw new NotFoundError('Principal missing');
  return req.principal;
}

function parsePagination(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize ?? '50', 10) || 50));
  return { page: p, pageSize: ps };
}

/**
 * Accounting endpoints (PRD Stage 8): chart of accounts, journals, GL reports.
 */
@Controller('accounting')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  // ---- Chart of accounts ------------------------------------------------------

  @Post('accounts')
  @RequirePermissions('accounting.account.create')
  async createAccount(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = accountCreateSchema.parse(body);
    return this.accounting.createAccount(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('accounts')
  @RequirePermissions('accounting.account.view')
  async listAccounts(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('type') type: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.accounting.listAccounts(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(type ? { type } : {}),
    });
  }

  @Post('accounts/:id')
  @RequirePermissions('accounting.account.edit')
  async updateAccount(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = accountUpdateSchema.parse(body);
    return this.accounting.updateAccount(requirePrincipal(req), id, input, getRequestId(req));
  }

  // ---- Financial periods --------------------------------------------------------

  @Get('periods')
  @RequirePermissions('accounting.period.view')
  async listPeriods(@Req() req: AuthedRequest) {
    return this.accounting.listPeriods(requirePrincipal(req));
  }

  @Post('periods/:id/close')
  @RequirePermissions('accounting.period.edit')
  async closePeriod(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.accounting.closePeriod(requirePrincipal(req), id, getRequestId(req));
  }

  // ---- Journals -------------------------------------------------------------------

  @Post('journals')
  @RequirePermissions('accounting.journal.create')
  async createJournal(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = journalCreateSchema.parse(body);
    return this.accounting.createJournal(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('journals')
  @RequirePermissions('accounting.journal.view')
  async listJournals(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Query('type') type: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.accounting.listJournals(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }

  @Get('journals/:id')
  @RequirePermissions('accounting.journal.view')
  async getJournal(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.accounting.getJournal(requirePrincipal(req), id);
  }

  @Post('journals/:id/submit')
  @RequirePermissions('accounting.journal.submit')
  async submitJournal(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const amount = (body as { amount?: string } | null)?.amount;
    return this.accounting.submitJournal(requirePrincipal(req), id, amount, getRequestId(req));
  }

  @Post('journals/:id/post')
  @RequirePermissions('accounting.journal.post')
  async postJournal(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.accounting.postJournal(requirePrincipal(req), id, getRequestId(req));
  }

  @Post('journals/:id/reverse')
  @RequirePermissions('accounting.journal.reverse')
  async reverseJournal(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const reason = (body as { reason?: string } | null)?.reason ?? 'Manual reversal';
    return this.accounting.reverseJournal(requirePrincipal(req), id, reason, getRequestId(req));
  }

  @Post('journals/import-outbox')
  @RequirePermissions('accounting.journal.post')
  async importFromOutbox(@Req() req: AuthedRequest) {
    return this.accounting.importFromOutbox(requirePrincipal(req), getRequestId(req));
  }

  // ---- GL reports -------------------------------------------------------------------

  @Get('trial-balance')
  @RequirePermissions('accounting.journal.view')
  async trialBalance(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.accounting.trialBalance(requirePrincipal(req), {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }

  @Get('daybook')
  @RequirePermissions('accounting.journal.view')
  async daybook(@Query('date') date: string | undefined, @Req() req: AuthedRequest) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    return this.accounting.daybook(requirePrincipal(req), day);
  }

  @Get('ar-aging')
  @RequirePermissions('accounting.ar.view')
  async arAging(@Req() req: AuthedRequest) {
    return this.accounting.arAging(requirePrincipal(req));
  }

  @Get('ap-aging')
  @RequirePermissions('accounting.ap.view')
  async apAging(@Req() req: AuthedRequest) {
    return this.accounting.apAging(requirePrincipal(req));
  }

  @Get('statements')
  @RequirePermissions('accounting.journal.view')
  async statements(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.accounting.financialStatements(requirePrincipal(req), {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }
}
