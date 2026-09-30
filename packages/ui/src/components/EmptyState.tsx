import React from 'react';

export type EmptyStateKind = 'no-records' | 'filtered' | 'no-permission';

const KIND_COPY: Record<EmptyStateKind, { title: string; description: string }> = {
  'no-records': {
    title: 'Nothing here yet',
    description: 'Records you create will appear here.',
  },
  filtered: {
    title: 'No matching records',
    description: 'No records match the current filters. Adjust or clear the filters to see more.',
  },
  'no-permission': {
    title: 'No access',
    description: 'You do not have permission to view these records.',
  },
};

export interface EmptyStateProps {
  kind?: EmptyStateKind;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ kind = 'no-records', title, description, action }: EmptyStateProps) {
  const copy = KIND_COPY[kind];
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--erp-border)] px-6 py-14 text-center">
      <h3 className="text-sm font-semibold text-[var(--erp-fg)]">{title ?? copy.title}</h3>
      <p className="max-w-sm text-sm text-[var(--erp-muted)]">{description ?? copy.description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
