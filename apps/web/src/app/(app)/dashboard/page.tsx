'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert } from '@erp/ui';
import { MetricCard } from '@erp/ui';
import { SkeletonCard } from '@erp/ui';
import { EmptyState } from '@erp/ui';

interface DashboardSummary {
  kpis: Array<{ key: string; label: string; value: number; href: string }>;
  alerts: Array<{ severity: 'info' | 'warning' | 'danger'; title: string; detail: string }>;
  context: { companyIds: string[] | null; branchIds: string[] | null };
}

export default function DashboardPage() {
  const { principal, loading: authLoading } = useAuth();
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api.get<DashboardSummary>('/dashboard/summary'),
    enabled: Boolean(principal),
  });

  if (authLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
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

  if (summary.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--erp-muted)]">
          Operational overview for your authorized scope.
        </p>
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

      <section aria-label="Key metrics">
        {data?.kpis.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.kpis.map((kpi) => (
              <MetricCard
                key={kpi.key}
                label={kpi.label}
                value={String(kpi.value)}
                href={kpi.href}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            kind="no-records"
            title="No metrics available"
            description="Metrics appear as modules are enabled for your role."
          />
        )}
      </section>
    </div>
  );
}
