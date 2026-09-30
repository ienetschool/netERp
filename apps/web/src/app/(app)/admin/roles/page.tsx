'use client';

import { GenericListPage, statusColumn } from '@/features/admin/generic-list-page';

export default function Page() {
  return (
    <GenericListPage
      config={{
        title: 'Roles',
        description: 'System and custom roles with their permission sets.',
        endpoint: '/roles',
        queryKey: 'admin-roles',
        columns: [
          { key: 'code', header: 'Code', render: (r) => String(r.code) },
          { key: 'name', header: 'Name', render: (r) => String(r.name) },
          {
            key: 'description',
            header: 'Description',
            render: (r) => (typeof r.description === 'string' ? r.description : '—'),
          },
          {
            key: 'isSystemRole',
            header: 'Type',
            render: (r) => (r.isSystemRole ? 'System' : 'Custom'),
          },
          statusColumn(),
        ],
      }}
    />
  );
}
