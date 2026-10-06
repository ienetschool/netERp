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

interface KpiTrend {
  /** Percentage change against the trailing equivalent window, null when there is no baseline. */
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
  label: string;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Builds the 12-month window ending with the current calendar month. */
function buildMonthBuckets(
  now: Date,
): Array<{ key: string; label: string; start: Date; end: Date }> {
  const buckets = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1));
    buckets.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: MONTH_LABELS[start.getUTCMonth()] as string,
      start,
      end,
    });
  }
  return buckets;
}

function trendPercent(current: number, previous: number): KpiTrend['percent'] {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function withTrend(current: number, previous: number, label = 'vs last month'): KpiTrend {
  const percent = trendPercent(current, previous);
  return {
    percent,
    direction: percent === null ? 'flat' : percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat',
    label,
  };
}

/**
 * Dashboard summary (UI-UX §6). KPIs are role-aware: counts only appear for
 * principals holding the corresponding view permission. All counts are
 * computed server-side within the principal's company/branch scope.
 *
 * `financials` / `modules` / `activity` power the redesigned dashboard home
 * screen (greeting, KPI trends, revenue-vs-expenses chart, module overview and
 * the recent-activity feed). Financial figures are aggregated from POSTED and
 * APPROVED journal lines only, so drafts and reversed journals never inflate
 * the chart.
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

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const inScope =
      principal.companyIds !== null ? { companyId: { in: principal.companyIds } } : {};

    const kpis: Array<{
      key: string;
      label: string;
      value: number;
      href: string;
      trend: KpiTrend;
    }> = [];
    const alerts: Array<{
      severity: 'info' | 'warning' | 'danger';
      title: string;
      detail: string;
    }> = [];

    if (isSuper || perms.has('identity.user.view')) {
      const [users, usersPrev] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { lt: monthStart } } }),
      ]);
      kpis.push({
        key: 'users',
        label: 'Users',
        value: users,
        href: '/admin/users',
        trend: withTrend(users, usersPrev, 'vs last month'),
      });
    }

    if (isSuper || perms.has('organization.company.view')) {
      const [companies, companiesPrev] = await Promise.all([
        this.prisma.company.count({ where: companyFilter }),
        this.prisma.company.count({
          where: { ...companyFilter, createdAt: { lt: monthStart } },
        }),
      ]);
      kpis.push({
        key: 'companies',
        label: 'Companies',
        value: companies,
        href: '/admin/companies',
        trend: withTrend(companies, companiesPrev, 'vs last month'),
      });
    }

    if (isSuper || perms.has('organization.branch.view')) {
      const [branches, branchesPrev] = await Promise.all([
        this.prisma.branch.count({ where: { company: companyFilter } }),
        this.prisma.branch.count({
          where: { company: companyFilter, createdAt: { lt: monthStart } },
        }),
      ]);
      kpis.push({
        key: 'branches',
        label: 'Branches',
        value: branches,
        href: '/admin/branches',
        trend: withTrend(branches, branchesPrev, 'vs last month'),
      });
    }

    if (isSuper || perms.has('documents.document.view')) {
      const docScope =
        principal.companyIds !== null ? { companyId: { in: principal.companyIds } } : {};
      const [documents, documentsPrev] = await Promise.all([
        this.prisma.document.count({ where: docScope }),
        this.prisma.document.count({ where: { ...docScope, createdAt: { lt: monthStart } } }),
      ]);
      kpis.push({
        key: 'documents',
        label: 'Documents',
        value: documents,
        href: '/documents',
        trend: withTrend(documents, documentsPrev, 'vs last month'),
      });
    }

    // ---------------------------------------------------------------------
    // Module overview — one tile per enabled module, permission-gated.
    // ---------------------------------------------------------------------
    const modules: Array<{
      key: string;
      label: string;
      icon: string;
      value: number;
      href: string;
      trend: KpiTrend;
    }> = [];

    if (isSuper || perms.has('sales.sales_order.view')) {
      const [orders, ordersPrev] = await Promise.all([
        this.prisma.salesOrder.count({ where: inScope }),
        this.prisma.salesOrder.count({ where: { ...inScope, createdAt: { lt: lastMonthStart } } }),
      ]);
      modules.push({
        key: 'sales',
        label: 'Sales',
        icon: 'cart',
        value: orders,
        href: '/sales/orders',
        trend: withTrend(orders, ordersPrev),
      });
    }

    if (isSuper || perms.has('procurement.purchase_order.view')) {
      const [orders, ordersPrev] = await Promise.all([
        this.prisma.purchaseOrder.count({ where: inScope }),
        this.prisma.purchaseOrder.count({
          where: { ...inScope, createdAt: { lt: lastMonthStart } },
        }),
      ]);
      modules.push({
        key: 'procurement',
        label: 'Procurement',
        icon: 'truck',
        value: orders,
        href: '/procurement/purchase-orders',
        trend: withTrend(orders, ordersPrev),
      });
    }

    if (isSuper || perms.has('inventory.product.view')) {
      const [products, productsPrev] = await Promise.all([
        this.prisma.product.count({ where: inScope }),
        this.prisma.product.count({ where: { ...inScope, createdAt: { lt: lastMonthStart } } }),
      ]);
      modules.push({
        key: 'inventory',
        label: 'Inventory',
        icon: 'box',
        value: products,
        href: '/inventory/products',
        trend: withTrend(products, productsPrev),
      });
    }

    if (isSuper || perms.has('hr.employee.view')) {
      const [employees, employeesPrev] = await Promise.all([
        this.prisma.employee.count({ where: inScope }),
        this.prisma.employee.count({ where: { ...inScope, createdAt: { lt: lastMonthStart } } }),
      ]);
      modules.push({
        key: 'hr',
        label: 'HR & Payroll',
        icon: 'users',
        value: employees,
        href: '/hr/employees',
        trend: withTrend(employees, employeesPrev),
      });
    }

    // ---------------------------------------------------------------------
    // Financial series — 12 months of posted revenue vs expenses.
    // ---------------------------------------------------------------------
    const canViewFinance =
      isSuper || perms.has('accounting.journal.view') || perms.has('reporting.report.view');
    let financials: {
      months: Array<{ key: string; label: string; revenue: number; expenses: number }>;
      totalRevenue: number;
      totalExpenses: number;
      netProfit: number;
      revenueTrend: KpiTrend;
      expensesTrend: KpiTrend;
      netProfitTrend: KpiTrend;
    } | null = null;

    if (canViewFinance) {
      const buckets = buildMonthBuckets(now);
      const windowStart = buckets[0]?.start ?? lastMonthStart;

      const lines = await this.prisma.journalLine.findMany({
        where: {
          journal: {
            ...inScope,
            journalDate: { gte: windowStart },
            status: { in: ['APPROVED', 'POSTED'] },
          },
          account: { accountType: { in: ['REVENUE', 'EXPENSE'] } },
        },
        select: {
          debit: true,
          credit: true,
          account: { select: { accountType: true } },
          journal: { select: { journalDate: true } },
        },
      });

      const series = buckets.map((b) => ({ ...b, revenue: 0, expenses: 0 }));
      for (const line of lines) {
        const date = line.journal.journalDate;
        const idx = series.findIndex((s) => date >= s.start && date < s.end);
        // Normal balances: revenue is credited, expense is debited.
        const amount = Number(line.account.accountType === 'REVENUE' ? line.credit : line.debit);
        if (idx === -1 || !Number.isFinite(amount)) continue;
        const bucket = series[idx];
        if (!bucket) continue;
        if (line.account.accountType === 'REVENUE') bucket.revenue += amount;
        else bucket.expenses += amount;
      }

      const months = series.map(({ key, label, revenue, expenses }) => ({
        key,
        label,
        revenue: Math.round(revenue * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
      }));
      const current = months[months.length - 1];
      const previous = months[months.length - 2];
      const totalRevenue = months.reduce((sum, m) => sum + m.revenue, 0);
      const totalExpenses = months.reduce((sum, m) => sum + m.expenses, 0);

      financials = {
        months,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
        revenueTrend: withTrend(current?.revenue ?? 0, previous?.revenue ?? 0),
        expensesTrend: withTrend(current?.expenses ?? 0, previous?.expenses ?? 0),
        netProfitTrend: withTrend(
          (current?.revenue ?? 0) - (current?.expenses ?? 0),
          (previous?.revenue ?? 0) - (previous?.expenses ?? 0),
        ),
      };
    }

    // ---------------------------------------------------------------------
    // Recent activity — audit trail, scoped and permission-gated.
    // ---------------------------------------------------------------------
    const activity: Array<{
      id: string;
      action: string;
      resourceType: string;
      resourceId: string | null;
      actor: string | null;
      timestamp: string;
    }> = [];

    if (isSuper || perms.has('audit.audit_log.view') || perms.has('documents.document.view')) {
      const auditScope =
        principal.companyIds !== null ? { companyId: { in: principal.companyIds } } : {};
      const recent = await this.prisma.auditLog.findMany({
        where: auditScope,
        orderBy: { timestamp: 'desc' },
        take: 6,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          actorUserId: true,
          timestamp: true,
        },
      });
      const actorIds = [
        ...new Set(recent.map((r) => r.actorUserId).filter((v): v is string => !!v)),
      ];
      const actors = actorIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, displayName: true, email: true },
          })
        : [];
      const actorById = new Map(actors.map((a) => [a.id, a.displayName]));

      for (const item of recent) {
        activity.push({
          id: item.id,
          action: item.action,
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          actor: item.actorUserId ? (actorById.get(item.actorUserId) ?? null) : null,
          timestamp: item.timestamp.toISOString(),
        });
      }
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
        modules,
        financials,
        activity,
        context: {
          companyIds: principal.companyIds,
          branchIds: principal.branchIds,
        },
      },
      meta: { requestId: getRequestId(req) },
    };
  }
}
