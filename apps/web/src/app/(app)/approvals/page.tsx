'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@erp/ui';
import { Alert } from '@erp/ui';

interface ApprovalTaskRow {
  id: string;
  step: number;
  status: string;
  dueAt: string | null;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  currentState: string;
  workflow: string;
}

interface ActResult {
  data: { currentState: string | null; instanceStatus: string };
}

/**
 * Approval inbox (PRD Stage 2: Approval inbox). Speaks the real workflow API;
 * approve advances the instance, reject requires a reason, cancel aborts it.
 */
export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const inboxQuery = useQuery({
    queryKey: ['approvals', 'inbox'],
    queryFn: () => api.get<ApprovalTaskRow[]>('/workflow/approval-tasks?status=PENDING'),
  });

  const actMutation = useMutation({
    mutationFn: ({
      id,
      decision,
      comments,
      rejectionReason,
    }: {
      id: string;
      decision: 'APPROVE' | 'REJECT' | 'CANCEL';
      comments?: string;
      rejectionReason?: string;
    }) =>
      api.post<ActResult>(`/workflow/approval-tasks/${id}/act`, {
        decision,
        ...(comments ? { comments } : {}),
        ...(rejectionReason ? { rejectionReason } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setRejectingId(null);
      setRejectionReason('');
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Action failed');
    },
  });

  const rows = inboxQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Your pending approval tasks across authorized modules."
      />
      {error ? (
        <Alert tone="error" title="Action failed">
          {error}
        </Alert>
      ) : null}
      {inboxQuery.isLoading ? (
        <p className="text-sm text-[var(--erp-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--erp-muted)]">No pending approvals.</p>
      ) : (
        <ul className="divide-y divide-[var(--erp-border)] overflow-hidden rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
          {rows.map((t) => (
            <li key={t.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {t.workflow} · {t.entityType.replace(/_/g, ' ')}
                    {t.entityLabel ? ` · ${t.entityLabel}` : ''} · step {t.step}
                  </p>
                  <p className="text-xs text-[var(--erp-muted)]">
                    State {t.currentState} ·{' '}
                    {t.dueAt ? `Due ${new Date(t.dueAt).toLocaleDateString()}` : 'No due date'}
                  </p>
                </div>
                <StatusBadge status={t.status} />
              </div>
              {rejectingId === t.id ? (
                <div className="mt-3 space-y-2">
                  <input
                    className="w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                    placeholder="Rejection reason (required)"
                    value={rejectionReason}
                    onChange={(e) => {
                      setRejectionReason(e.target.value);
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      className="rounded-md bg-[var(--erp-danger,var(--erp-accent))] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      disabled={rejectionReason.trim().length === 0 || actMutation.isPending}
                      onClick={() => {
                        actMutation.mutate({
                          id: t.id,
                          decision: 'REJECT',
                          rejectionReason: rejectionReason.trim(),
                        });
                      }}
                    >
                      Confirm rejection
                    </button>
                    <button
                      className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-xs"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectionReason('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-md bg-[var(--erp-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    disabled={actMutation.isPending}
                    onClick={() => {
                      actMutation.mutate({ id: t.id, decision: 'APPROVE' });
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-xs disabled:opacity-50"
                    disabled={actMutation.isPending}
                    onClick={() => {
                      setRejectingId(t.id);
                    }}
                  >
                    Reject…
                  </button>
                  <button
                    className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-xs disabled:opacity-50"
                    disabled={actMutation.isPending}
                    onClick={() => {
                      actMutation.mutate({ id: t.id, decision: 'CANCEL' });
                    }}
                  >
                    Cancel task
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
