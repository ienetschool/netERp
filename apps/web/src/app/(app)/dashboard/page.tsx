'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Icon,
  SkeletonCard,
  type IconName,
} from '@erp/ui';
import { ModernERPCard } from '@/components/ModernERPCard';

function FinancialYearPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="erp-select"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      aria-label="Financial year"
    >
      <option value="FY2026">Financial Year 2026</option>
      <option value="FY2025">Financial Year 2025</option>
      <option value="FY2027">Financial Year 2027</option>
    </select>
  );
}

function BranchPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select
      className="erp-select"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      aria-label="Branch"
    >
      <option value="main">Main Branch</option>
      <option value="east">East Branch</option>
      <option value="west">West Branch</option>
    </select>
  );
}

function OrganizationChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--erp-border)] erp-frost px-3 py-1 text-xs font-medium text-[var(--erp-muted)] shadow-[var(--erp-shadow-xs)]">
      <Icon name="organization" size={13} />
      {name}
    </span>
  );
}

interface Trend {
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
  label: string;
}

interface DashboardSummary {
  kpis: Array<{
    key: string;
    label: string;
    value: number;
    href: string;
    trend?: Trend;
  }>;
  alerts: Array<{ severity: 'info' | 'warning' | 'danger'; title: string; detail: string }>;
  modules?: Array<{
    key: string;
    label: string;
    icon: string;
    value: number;
    href: string;
    trend: Trend;
  }>;
  financials?: {
    months: Array<{ key: string; label: string; revenue: number; expenses: number }>;
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    revenueTrend: Trend;
    expensesTrend: Trend;
    netProfitTrend: Trend;
  } | null;
  activity?: Array<{
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    actor: string | null;
    timestamp: string;
  }>;
  context: { companyIds: string[] | null; branchIds: string[] | null };
}

/** Maps an API KPI/module key onto an icon from the shared icon set. */
const KPI_ICONS: Record<string, IconName> = {
  users: 'users',
  companies: 'building',
  branches: 'building',
  documents: 'documents',
  sales: 'cart',
  procurement: 'truck',
  inventory: 'inventory',
  hr: 'hr',
};

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const compactCurrency = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

const fullCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat('en-US');

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function TrendPill({ trend, invert = false }: { trend?: Trend; invert?: boolean }) {
  if (!trend) return null;
  const { percent, direction, label } = trend;
  if (percent === null) {
    return <span className="text-xs text-[var(--erp-muted)]">new this month</span>;
  }
  const positive = invert ? direction === 'down' : direction === 'up';
  const flat = direction === 'flat';
  const tone = flat
    ? 'bg-[var(--erp-surface-sunken)] text-[var(--erp-muted)]'
    : positive
      ? 'bg-[var(--erp-success-bg)] text-[var(--erp-success)]'
      : 'bg-[var(--erp-danger-bg)] text-[var(--erp-danger)]';
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${tone}`}
      >
        {!flat ? <Icon name={direction === 'down' ? 'arrowDown' : 'arrowUp'} size={11} /> : null}
        {Math.abs(percent).toFixed(1)}%
      </span>
      <span className="text-[var(--erp-muted)]">{label}</span>
    </span>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border border-[var(--erp-border)] erp-frost px-3 py-2 text-xs"
      style={{ boxShadow: 'var(--erp-shadow-md)' }}
    >
      <p className="mb-1 font-semibold text-[var(--erp-fg)]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-1.5 text-[var(--erp-muted)]">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          {entry.name}:{' '}
          <span className="font-medium text-[var(--erp-fg)]">
            {fullCurrency.format(entry.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { principal, loading: authLoading } = useAuth();
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
    enabled: Boolean(principal),
  });

  const [financialYear, setFinancialYear] = React.useState('FY2026');
  const [branch, setBranch] = React.useState('main');

  const handleExplore = () => {
    window.location.assign('/dashboard');
  };

  if (authLoading || (principal && summary.isLoading)) {
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (!principal) {
    return (
      <EmptyState
        kind="no-permission"
        title="Not signed in"
        description="Sign in to view your dashboard."
      />
    );
  }

  if (summary.isError) {
    return (
      <Alert tone="error" title="Could not load dashboard">
        {summary.error instanceof Error ? summary.error.message : 'Unexpected error'}
      </Alert>
    );
  }

  const data = summary.data;
  const modules = data?.modules ?? [];
  const financials = data?.financials ?? null;
  const activity = data?.activity ?? [];

  const kpiCards = financials
    ? [
        {
          key: 'total-revenue',
          label: 'Total Revenue',
          value: fullCurrency.format(financials.totalRevenue),
          icon: KPI_ICONS.sales ?? 'wallet',
          trend: financials.revenueTrend,
          href: '/accounting/reports',
        },
        {
          key: 'total-expenses',
          label: 'Total Expenses',
          value: fullCurrency.format(financials.totalExpenses),
          icon: 'wallet',
          trend: financials.expensesTrend,
          href: '/accounting/reports',
        },
        {
          key: 'net-profit',
          label: 'Net Profit',
          value: fullCurrency.format(financials.netProfit),
          icon: 'finance',
          trend: financials.netProfitTrend,
          href: '/accounting/reports',
        },
      ]
    : (data?.kpis ?? []).map((kpi) => ({
        key: kpi.key,
        label: kpi.label,
        value: integer.format(kpi.value),
        icon: KPI_ICONS[kpi.key] ?? 'grid',
        trend: kpi.trend,
        href: kpi.href,
      }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.375rem] font-bold tracking-tight text-[var(--erp-fg)]">
            {greeting()}, {principal.displayName?.split(' ')[0] ?? principal.email}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--erp-muted)]">
            Here&apos;s what&apos;s happening with your business today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FinancialYearPicker value={financialYear} onChange={setFinancialYear} />
          <BranchPicker value={branch} onChange={setBranch} />
          <OrganizationChip name="Global Tech Solutions" />
        </div>
      </header>

      {data?.alerts.length ? (
        <section aria-label="Alerts" className="space-y-2">
          {data.alerts.map((a) => (
            <Alert
              key={a.title}
              tone={
                a.severity === 'danger' ? 'error' : a.severity === 'warning' ? 'warning' : 'info'
              }
              title={a.title}
            >
              {a.detail}
            </Alert>
          ))}
        </section>
      ) : null}

      {/* KPI row */}
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((kpi) => (
          <Link key={kpi.key} href={kpi.href} className="group">
            <Card
              className="h-full transition group-hover:border-[var(--erp-primary)]"
              style={{ boxShadow: 'var(--erp-shadow-sm)' }}
            >
              <div className="flex items-start justify-between gap-3 p-5">
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem] font-medium text-[var(--erp-muted)]">
                    {kpi.label}
                  </p>
                  <p className="mt-2 text-[1.5rem] font-bold tracking-tight text-[var(--erp-fg)]">
                    {kpi.value}
                  </p>
                  <div className="mt-2">
                    <TrendPill trend={kpi.trend} invert={kpi.key === 'total-expenses'} />
                  </div>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]">
                  <Icon name={kpi.icon} size={19} />
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </section>

      {/* Modern ERP Experience feature card */}
      <ModernERPCard onExplore={handleExplore} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Revenue & Expenses chart */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Revenue & Expenses"
            subtitle={
              financials ? 'Last 12 months, posted journals' : 'Financial permission required'
            }
            action={
              financials ? (
                <div className="flex items-center gap-3 text-xs text-[var(--erp-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ background: 'var(--erp-primary)' }}
                    />
                    Revenue
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full"
                      style={{ background: '#a855f7' }}
                    />
                    Expenses
                  </span>
                </div>
              ) : null
            }
          />
          <div className="px-2 pb-4 pt-1">
            {financials && financials.months.length > 0 ? (
              <div style={{ height: '17rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={financials.months}
                    margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--erp-primary)" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="var(--erp-primary)" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="expensesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--erp-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--erp-muted)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--erp-muted)' }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tickFormatter={(value: number) => `$${compactCurrency.format(value)}`}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ stroke: 'var(--erp-border-strong)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="var(--erp-primary)"
                      strokeWidth={2}
                      fill="url(#revenueFill)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      name="Expenses"
                      stroke="#a855f7"
                      strokeWidth={2}
                      fill="url(#expensesFill)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[17rem] items-center justify-center">
                <EmptyState
                  kind="no-records"
                  title="No posted financial data"
                  description="Revenue and expenses appear once journals are posted."
                />
              </div>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          {/* Module overview */}
          <Card>
            <CardHeader title="Module Overview" subtitle="Records in your scope" />
            {modules.length ? (
              <ul className="grid grid-cols-2 gap-2 p-4 pt-0">
                {modules.map((mod) => (
                  <li key={mod.key}>
                    <Link
                      href={mod.href}
                      className="block rounded-xl border border-[var(--erp-border)] p-3 transition hover:border-[var(--erp-primary)] hover:bg-[var(--erp-primary-soft)]"
                    >
                      <p className="truncate text-xs font-medium text-[var(--erp-muted)]">
                        {mod.label}
                      </p>
                      <p className="mt-1 text-lg font-bold text-[var(--erp-fg)]">
                        {compactCurrency.format(mod.value)}
                      </p>
                      <div className="mt-1">
                        <TrendPill trend={mod.trend} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 pt-0">
                <EmptyState
                  kind="no-records"
                  title="No modules available"
                  description="Modules appear as permissions are granted."
                />
              </div>
            )}
          </Card>

          {/* Recent activity */}
          <Card className="flex-1">
            <CardHeader
              title="Recent Activity"
              action={
                <Link
                  href="/admin/audit"
                  className="text-xs font-medium text-[var(--erp-primary)] hover:underline"
                >
                  View all
                </Link>
              }
            />
            {activity.length ? (
              <ul className="divide-y divide-[var(--erp-border)]">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--erp-surface-sunken)] text-[var(--erp-muted)]">
                      <Icon name="activity" size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.8125rem] text-[var(--erp-fg)]">
                        <span className="font-medium capitalize">
                          {item.action.replace(/[._]/g, ' ').toLowerCase()}
                        </span>
                        <span className="text-[var(--erp-muted)]">
                          {' '}
                          · {item.resourceType.replace(/[._]/g, ' ').toLowerCase()}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--erp-muted)]">
                        {relativeTime(item.timestamp)}
                      </p>
                    </div>
                    <Badge tone="neutral" className="shrink-0">
                      {item.resourceId ? item.resourceId.slice(0, 8) : '—'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 pt-0">
                <EmptyState
                  kind="no-records"
                  title="No recent activity"
                  description="Actions you perform will show up here."
                />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
