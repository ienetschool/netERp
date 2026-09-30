import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService, Prisma } from '@erp/prisma';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal;
}

/**
 * Global search (CLAUDE.md §38: authorization-aware, never filter-after-fetch).
 * The query applies the principal's company/branch scope inside the database
 * before returning grouped results.
 */
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async search(@Query('q') query: string | undefined, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = req.principal;
    if (!principal) return { data: [], meta: { requestId: getRequestId(req) } };
    const q = (query ?? '').trim();
    if (q.length < 2) {
      return { data: [], meta: { requestId: getRequestId(req) } };
    }

    const where: Prisma.SearchDocumentWhereInput = {
      searchText: { contains: q, mode: 'insensitive' },
      ...(principal.companyIds !== null ? { companyId: { in: principal.companyIds } } : {}),
      // Branch-level visibility: null-branch records are company-wide.
      ...(principal.branchIds !== null
        ? { OR: [{ branchId: null }, { branchId: { in: principal.branchIds } }] }
        : {}),
    };

    const rows = await this.prisma.searchDocument.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });

    const groups: Record<string, unknown[]> = {};
    for (const row of rows) {
      const group = groups[row.entityType] ?? [];
      group.push({
        entityType: row.entityType,
        entityId: row.entityId,
        title: row.title,
        subtitle: row.subtitle,
        metadata: row.metadata,
      });
      groups[row.entityType] = group;
    }

    return { data: groups, meta: { requestId: getRequestId(req), total: rows.length } };
  }
}
