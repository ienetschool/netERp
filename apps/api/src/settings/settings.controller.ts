import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { RequirePermissions } from '../iam/permissions.guard.js';
import { SettingsService } from './settings.service.js';
import { AuditService } from '../common/audit.service.js';
import { ValidationError, NotFoundError } from '../common/errors.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import { settingUpsertSchema } from '@erp/validation';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

function requirePrincipal(req: AuthedRequest): RequestPrincipal {
  if (!req.principal) throw new NotFoundError('Principal missing');
  return req.principal;
}

/**
 * Settings endpoints (PRD Stage 2: Settings).
 * Read: any authenticated principal (effective values, company override applied).
 * Write: settings.configuration.edit/create/delete.
 */
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query('companyId') companyId: string | undefined): Promise<unknown> {
    const items = await this.settings.list(companyId ?? null);
    return { data: items };
  }

  @Get('resolve/:key')
  async resolve(
    @Param('key') key: string,
    @Query('companyId') companyId: string | undefined,
  ): Promise<unknown> {
    const value = await this.settings.resolve(key, companyId ?? null);
    return { data: { key, value } };
  }

  @Post()
  @RequirePermissions('settings.configuration.create', 'settings.configuration.edit')
  async upsert(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = settingUpsertSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid setting', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const input = parsed.data;
    const row = await this.settings.upsert(
      {
        key: input.key,
        value: input.value,
        valueType: input.valueType,
        companyId: input.companyId ?? null,
        description: input.description,
      },
      principal.userId,
    );
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'settings.setting_upserted',
      resourceType: 'system_setting',
      resourceId: row.id,
      companyId: input.companyId ?? null,
      requestId: getRequestId(req),
    });
    return { data: row };
  }

  @Delete(':id')
  @RequirePermissions('settings.configuration.delete')
  async remove(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    await this.prismaGuard(id, principal);
    await this.settings.delete(id);
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'settings.setting_deleted',
      resourceType: 'system_setting',
      resourceId: id,
      requestId: getRequestId(req),
    });
    return { ok: true };
  }

  /** Ensures the setting exists and, for non-super-admins, belongs to the caller's company scope. */
  private async prismaGuard(
    id: string,
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
  ): Promise<void> {
    const setting = await this.settings.findById(id);
    if (!setting) throw new NotFoundError('Setting not found');
    if (!principal.isSuperAdmin && setting.companyId !== null) {
      const inScope =
        principal.companyIds === null || principal.companyIds.includes(setting.companyId);
      if (!inScope) {
        throw new NotFoundError('Setting not found');
      }
    }
  }
}
