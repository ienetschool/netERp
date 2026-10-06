'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/lib/auth';
import { api } from '@/lib/api';
import { notificationDestination } from '@/lib/command-palette';
import { PageHeader } from '@/components/PageHeader';
import { Alert, Button, EmptyState, SkeletonTable, StatusBadge } from '@erp/ui';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  status: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const listQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationRow[]>('/notifications'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] }),
      ]);
    },
  });

  const rows = listQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Workflow and system updates for your account."
      />
      {listQuery.isLoading ? (
        <SkeletonTable rows={5} cols={3} />
      ) : listQuery.isError ? (
        <Alert
          tone="error"
          title="Could not load notifications"
          action={
            <Button variant="secondary" onClick={() => void listQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {listQuery.error instanceof Error ? listQuery.error.message : 'Unexpected error'}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          kind="no-records"
          title="You’re all caught up"
          description="Workflow requests, assignments, and system alerts will appear here."
          action={
            can('workflow.approval_task.view') ? (
              <Link
                href="/approvals"
                className="text-sm font-medium text-[var(--erp-primary)] hover:underline"
              >
                View approvals
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--erp-border)] overflow-hidden rounded-lg border border-[var(--erp-border)] erp-frost">
          {markRead.isError ? (
            <li className="list-none p-4" role="alert">
              <Alert tone="error" title="Could not mark notification as read">
                {markRead.error instanceof Error
                  ? markRead.error.message
                  : 'Please retry the action.'}
              </Alert>
            </li>
          ) : null}
          {rows.map((notification) => {
            const listHref = notificationDestination(notification.resourceType, can);
            return (
              <li
                key={notification.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="mt-0.5 break-words text-sm text-[var(--erp-muted)]">
                    {notification.message}
                  </p>
                  <p className="mt-1 text-xs text-[var(--erp-muted)]">
                    {notification.type.replaceAll('_', ' ')} ·{' '}
                    <time dateTime={notification.createdAt}>
                      {new Date(notification.createdAt).toLocaleString()}
                    </time>
                  </p>
                  {listHref ? (
                    <Link
                      href={listHref}
                      className="mt-2 inline-block text-sm font-medium text-[var(--erp-primary)] hover:underline"
                    >
                      Open related module
                    </Link>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={notification.status} />
                  {notification.status === 'UNREAD' ? (
                    <Button
                      variant="secondary"
                      loading={markRead.isPending && markRead.variables === notification.id}
                      onClick={() => {
                        markRead.mutate(notification.id);
                      }}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
