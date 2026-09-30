'use client';

import { GenericListPage, statusColumn } from '@/features/admin/generic-list-page';

export default function Page() {
  return (
    <GenericListPage
      config={{
        title: 'Branches',
        description: 'Branches within your authorized companies.',
        endpoint: '/branches',
        queryKey: 'admin-branches',
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
