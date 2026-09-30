'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Button, EmptyState, StatusBadge } from '@erp/ui';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ data: NotificationRow[] }>('/notifications'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const rows = listQuery.data?.data ?? [];

  return (
    <div>
      <PageHeader title="Notifications" description="In-app notifications within your scope." />
      {listQuery.isLoading ? (
        <p className="text-sm text-[var(--erp-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          kind="no-records"
          title="No notifications"
          description="Workflow and system alerts appear here."
        />
      ) : (
        <ul className="divide-y divide-[var(--erp-border)] overflow-hidden rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
          {rows.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-4 p-4">
              <div>
                <p className="text-sm font-medium">{n.title}</p>
                <p className="mt-0.5 text-sm text-[var(--erp-muted)]">{n.message}</p>
                <p className="mt-1 text-xs text-[var(--erp-muted)]">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={n.status === 'UNREAD' ? 'SUBMITTED' : 'APPROVED'} />
                {n.status === 'UNREAD' ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      markRead.mutate(n.id);
                    }}
                  >
                    Mark read
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
