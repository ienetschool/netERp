import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { PermissionSet } from '@erp/permissions';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

/**
 * Dashboard summary (UI-UX §6). KPIs are role-aware: counts only appear for
 * principals holding the corresponding view permission. All counts are
 * computed server-side within the principal's company/branch scope.
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async summary(@Req() req: AuthedRequest): Promise<unknown> {
    const principal = req.principal;
    if (!principal) {
      return { data: { kpis: [], alerts: [] }, meta: { requestId: getRequestId(req) } };
    }
    const perms = new PermissionSet(principal.permissions);
    const isSuper = principal.isSuperAdmin === true;
    const companyFilter = principal.companyIds !== null ? { id: { in: principal.companyIds } } : {};

    const kpis: Array<{ key: string; label: string; value: number; href: string }> = [];
    const alerts: Array<{
      severity: 'info' | 'warning' | 'danger';
      title: string;
      detail: string;
    }> = [];

    if (isSuper || perms.has('identity.user.view')) {
      const users = await this.prisma.user.count();
      kpis.push({ key: 'users', label: 'Users', value: users, href: '/admin/users' });
    }

    if (isSuper || perms.has('organization.company.view')) {
      const companies = await this.prisma.company.count({ where: companyFilter });
      kpis.push({
        key: 'companies',
        label: 'Companies',
        value: companies,
        href: '/admin/companies',
      });
    }

    if (isSuper || perms.has('organization.branch.view')) {
      const branches = await this.prisma.branch.count({
        where: { company: companyFilter },
      });
      kpis.push({ key: 'branches', label: 'Branches', value: branches, href: '/admin/branches' });
    }

    if (isSuper || perms.has('documents.document.view')) {
      const documents = await this.prisma.document.count({
        where: principal.companyIds !== null ? { companyId: { in: principal.companyIds } } : {},
      });
      kpis.push({ key: 'documents', label: 'Documents', value: documents, href: '/documents' });
    }

    const pendingApprovals = await this.prisma.approvalTask.count({
      where: {
        status: 'PENDING',
        ...(principal.companyIds !== null
          ? {
              instance: {
                entityType: { in: ['purchase_request', 'purchase_order', 'supplier_invoice'] },
              },
            }
          : {}),
      },
    });
    if (pendingApprovals > 0) {
      alerts.push({
        severity: 'info',
        title: 'Pending approvals',
        detail: `${pendingApprovals} approval task(s) awaiting action.`,
      });
    }

    const failedEvents = await this.prisma.outboxEvent.count({ where: { status: 'FAILED' } });
    if (failedEvents > 0) {
      alerts.push({
        severity: 'warning',
        title: 'Failed events',
        detail: `${failedEvents} outbox event(s) failed and need attention.`,
      });
    }

    return {
      data: {
        kpis,
        alerts,
        context: {
          companyIds: principal.companyIds,
          branchIds: principal.branchIds,
        },
      },
      meta: { requestId: getRequestId(req) },
    };
  }
}
