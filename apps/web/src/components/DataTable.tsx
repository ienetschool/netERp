'use client';

import { Alert, EmptyState, SkeletonTable } from '@erp/ui';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[] | undefined;
  loading: boolean;
  error?: Error | null;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  emptyAction?: React.ReactNode;
  getRowKey: (row: T) => string;
  caption?: string;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  total,
  page = 1,
  pageSize = 25,
  onPageChange,
  emptyAction,
  getRowKey,
  caption,
}: DataTableProps<T>) {
  if (loading) {
    return <SkeletonTable rows={6} cols={Math.min(columns.length, 6)} />;
  }

  if (error) {
    const status = 'status' in error ? (error as { status?: number }).status : undefined;
    if (status === 403) {
      return (
        <EmptyState
          kind="no-permission"
          title="No access"
          description="You do not have permission to view these records."
        />
      );
    }
    return (
      <Alert tone="error" title="Could not load records">
        {error.message}
      </Alert>
    );
  }

  if (!rows || rows.length === 0) {
    return <EmptyState kind="no-records" action={emptyAction} />;
  }

  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--erp-border)]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="bg-[var(--erp-surface-alt)]">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-4 py-2.5 font-medium text-[var(--erp-muted)]"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                className="border-t border-[var(--erp-border)] hover:bg-[var(--erp-surface-alt)]"
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2.5 ${c.className ?? ''}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total !== undefined && onPageChange ? (
        <div className="flex items-center justify-between border-t border-[var(--erp-border)] px-4 py-2 text-xs text-[var(--erp-muted)]">
          <span>
            {total === 0 ? 'No records' : `Page ${page} of ${totalPages}`} · {total} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                onPageChange(page - 1);
              }}
              className="rounded border border-[var(--erp-border)] px-2 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                onPageChange(page + 1);
              }}
              className="rounded border border-[var(--erp-border)] px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
