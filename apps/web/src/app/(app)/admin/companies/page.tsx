'use client';

import { GenericListPage, statusColumn } from '@/features/admin/generic-list-page';

export default function Page() {
  return (
    <GenericListPage
      config={{
        title: 'Companies',
        description: 'Legal entities managed by the platform.',
        endpoint: '/companies',
        queryKey: 'admin-companies',
        columns: [
          { key: 'code', header: 'Code', render: (r) => String(r.code) },
          { key: 'name', header: 'Name', render: (r) => String(r.name) },
          {
            key: 'timezone',
            header: 'Timezone',
            render: (r) => (typeof r.timezone === 'string' ? r.timezone : 'UTC'),
          },
          statusColumn(),
        ],
      }}
    />
  );
}
