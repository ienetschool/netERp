'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@erp/ui';

interface ListRow {
  id: string;
  [key: string]: unknown;
}

export interface GenericListConfig {
  title: string;
  description: string;
  endpoint: string;
  queryKey: string;
  columns: Array<DataTableColumn<ListRow>>;
  allowCreate?: boolean;
}

export function GenericListPage({ config }: { config: GenericListConfig }) {
  const [page, setPage] = useState(1);
  const listQuery = useQuery({
    queryKey: [config.queryKey, page],
    queryFn: () => apiList<ListRow>(`${config.endpoint}?page=${page}&pageSize=25`),
  });

  return (
    <div>
      <PageHeader title={config.title} description={config.description} />
      <DataTable
        columns={config.columns}
        rows={listQuery.data?.rows}
        loading={listQuery.isLoading}
        error={listQuery.error}
        total={listQuery.data?.total}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        getRowKey={(row) => row.id}
        caption={config.title}
      />
    </div>
  );
}

export function statusColumn(): DataTableColumn<ListRow> {
  return {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <StatusBadge status={typeof row.status === 'string' ? row.status : 'ACTIVE'} />
    ),
  };
}

export function dateColumn(key: string, header: string): DataTableColumn<ListRow> {
  return {
    key,
    header,
    render: (row) => {
      const value = row[key];
      return typeof value === 'string' ? new Date(value).toLocaleString() : '—';
    },
  };
}
