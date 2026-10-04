'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';

interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  actor: { email: string; displayName: string | null } | null;
  timestamp: string;
  requestId: string | null;
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const auditQuery = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () => apiList<AuditRow>(`/audit?page=${page}&pageSize=50`),
  });

  const columns: Array<DataTableColumn<AuditRow>> = [
    { key: 'timestamp', header: 'Time', render: (r) => new Date(r.timestamp).toLocaleString() },
    { key: 'action', header: 'Action', render: (r) => r.action },
    { key: 'resourceType', header: 'Resource', render: (r) => r.resourceType },
    {
      key: 'actor',
      header: 'Actor',
      render: (r) => r.actor?.displayName || r.actor?.email || 'system',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        description="Sensitive actions across your authorized scope. Append-only."
      />
      <DataTable
        columns={columns}
        rows={auditQuery.data?.rows}
        loading={auditQuery.isLoading}
        error={auditQuery.error}
        total={auditQuery.data?.total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
        getRowKey={(r) => r.id}
        caption="Audit log"
      />
    </div>
  );
}
