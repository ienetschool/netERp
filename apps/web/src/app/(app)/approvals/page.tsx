'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@erp/ui';

interface ApprovalTaskRow {
  id: string;
  step: number;
  status: string;
  dueAt: string | null;
}

/**
 * Approval inbox. The workflow engine lands in the Core Platform slice; this
 * page already speaks the real API contract and renders correct empty and
 * permission states rather than fake data (CLAUDE.md §59).
 */
export default function ApprovalsPage() {
  const inboxQuery = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api.get<{ data: ApprovalTaskRow[] }>('/workflow/approval-tasks?status=PENDING'),
    retry: false,
  });

  const rows = inboxQuery.data?.data ?? [];
  const notAvailable = inboxQuery.isError;

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Your pending approval tasks across authorized modules."
      />
      {inboxQuery.isLoading ? (
        <p className="text-sm text-[var(--erp-muted)]">Loading…</p>
      ) : notAvailable || rows.length === 0 ? (
        <EmptyState
          kind={notAvailable ? 'no-permission' : 'no-records'}
          title={notAvailable ? 'Approval inbox not yet active' : 'No pending approvals'}
          description={
            notAvailable
              ? 'The approval inbox activates with the workflow engine slice.'
              : 'Tasks awaiting your decision will appear here.'
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--erp-border)] overflow-hidden rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center justify-between p-4 text-sm">
              <span>
                Task #{t.id.slice(0, 8)} · step {t.step}
              </span>
              <span className="text-[var(--erp-muted)]">
                {t.dueAt ? `Due ${new Date(t.dueAt).toLocaleDateString()}` : 'No due date'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
