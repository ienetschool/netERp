'use client';

import { GenericListPage, statusColumn } from '@/features/admin/generic-list-page';

export default function Page() {
  return (
    <GenericListPage
      config={{
        title: 'Warehouses',
        description: 'Warehouses available in your scope.',
        endpoint: '/warehouses',
        queryKey: 'admin-warehouses',
        columns: [
          { key: 'code', header: 'Code', render: (r) => String(r.code) },
          { key: 'name', header: 'Name', render: (r) => String(r.name) },
          {
            key: 'type',
            header: 'Type',
            render: (r) => (typeof r.type === 'string' ? r.type : '—'),
          },
          statusColumn(),
        ],
      }}
    />
  );
}
