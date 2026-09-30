'use client';

import { GenericListPage, statusColumn } from '@/features/admin/generic-list-page';

export default function Page() {
  return (
    <GenericListPage
      config={{
        title: 'Departments',
        description: 'Departments grouped by branch.',
        endpoint: '/departments',
        queryKey: 'admin-departments',
        columns: [
          { key: 'code', header: 'Code', render: (r) => String(r.code) },
          { key: 'name', header: 'Name', render: (r) => String(r.name) },
          statusColumn(),
        ],
      }}
    />
  );
}
