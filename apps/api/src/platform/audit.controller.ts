import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService, Prisma } from '@erp/prisma';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { PermissionsGuard, RequirePermissions } from '../iam/permissions.guard.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import { canAccessCompany } from '../common/scope.util.js';
import { AuthorizationError, ValidationError } from '../common/errors.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import { z } from 'zod';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

/**
 * Audit trail access (CLAUDE.md §46: audit sensitive operations; do not expose
 * audit data to unauthorized users). Read access requires the audit permission;
 * results are limited to the caller's company scope.
 */
@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.audit_log.view')
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('resourceType') resourceType: string | undefined,
    @Query('companyId') companyId: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = req.principal;
    if (!principal) throw new AuthorizationError('Authentication required');

    const p = this.parsePage(page, pageSize);
    if (companyId && !z.string().uuid().safeParse(companyId).success) {
      throw new ValidationError('companyId must be a UUID');
    }
    if (companyId && !canAccessCompany(principal, companyId)) {
      throw new AuthorizationError('You do not have access to this company');
    }

    const where: Prisma.AuditLogWhereInput = {
      ...(resourceType ? { resourceType } : {}),
      ...(companyId ? { companyId } : {}),
      ...(principal.companyIds !== null ? { companyId: { in: principal.companyIds } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          timestamp: true,
          action: true,
          resourceType: true,
          resourceId: true,
          companyId: true,
          requestId: true,
          ipAddress: true,
          actorUserId: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // AuditLog carries only `actorUserId`, and a reader scans the actor column —
    // resolve it to a person here rather than making every page de-duplicate ids.
    const actorIds = [...new Set(items.map((i) => i.actorUserId).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, displayName: true },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    return {
      data: {
        rows: items.map((item) => ({
          ...item,
          actor: item.actorUserId ? (actorById.get(item.actorUserId) ?? null) : null,
        })),
        total,
      },
      meta: { page: p.page, pageSize: p.pageSize, requestId: getRequestId(req) },
    };
  }

  private parsePage(page: string, pageSize: string) {
    const p = Math.max(1, Number.parseInt(page, 10) || 1);
    const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize, 10) || 50));
    return { page: p, pageSize: ps, skip: (p - 1) * ps, take: ps };
  }
}
