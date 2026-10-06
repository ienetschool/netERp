'use client';

import { Alert, EmptyState, SkeletonTable } from '@erp/ui';
import { Icon, RowActionsMenu, type MenuItem } from '@erp/ui';
import React from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  /** Right-align numeric / money columns. */
  align?: 'left' | 'right';
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
  /** Enables the leading checkbox column and surfaces the bulk toolbar. */
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Per-row "…" menu, matching the row actions in the reference design. */
  rowActions?: (row: T) => MenuItem[];
}

const ALIGN_CLASS: Record<'left' | 'right', string> = {
  left: 'text-left',
  right: 'text-right tabular-nums',
};

/**
 * Builds the windowed page list with ellipses: 1 … 4 5 [6] 7 8 … 20.
 */
function pageWindow(current: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
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
  selectable = false,
  selectedKeys,
  onSelectionChange,
  rowActions,
}: DataTableProps<T>) {
  const [internalSelection, setInternalSelection] = React.useState<string[]>([]);
  const selection = selectedKeys ?? internalSelection;
  const setSelection = onSelectionChange ?? setInternalSelection;

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

  const rowKeys = rows.map(getRowKey);
  const allSelected = selectable && rowKeys.every((key) => selection.includes(key));
  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const from = (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + rows.length;

  const toggleRow = (key: string) => {
    setSelection(
      selection.includes(key) ? selection.filter((k) => k !== key) : [...selection, key],
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--erp-border)] erp-frost">
      {selectable && selection.length > 0 ? (
        <div className="flex items-center gap-3 border-b border-[var(--erp-border)] bg-[var(--erp-primary-soft)] px-4 py-2.5 text-[0.8125rem]">
          <span className="font-medium text-[var(--erp-primary)]">{selection.length} selected</span>
          <button
            type="button"
            onClick={() => {
              setSelection([]);
            }}
            className="text-[var(--erp-muted)] underline underline-offset-2 hover:text-[var(--erp-fg)]"
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="erp-table">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="w-10 pl-4 pr-0">
                  <input
                    type="checkbox"
                    className="erp-checkbox"
                    aria-label="Select all rows on this page"
                    checked={allSelected}
                    onChange={() => {
                      setSelection(allSelected ? [] : rowKeys);
                    }}
                  />
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.key} scope="col" className={ALIGN_CLASS[c.align ?? 'left']}>
                  {c.header}
                </th>
              ))}
              {rowActions ? (
                <th scope="col" className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = getRowKey(row);
              const checked = selection.includes(key);
              return (
                <tr key={key} className={checked ? 'bg-[var(--erp-primary-soft)]' : undefined}>
                  {selectable ? (
                    <td className="pl-4 pr-0 align-middle">
                      <input
                        type="checkbox"
                        className="erp-checkbox"
                        aria-label={`Select row ${key}`}
                        checked={checked}
                        onChange={() => {
                          toggleRow(key);
                        }}
                      />
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`align-middle ${ALIGN_CLASS[c.align ?? 'left']} ${c.className ?? ''}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className="text-right align-middle">
                      <RowActionsMenu items={rowActions(row)} />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total !== undefined && onPageChange ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--erp-border)] px-4 py-3 text-[0.8125rem] text-[var(--erp-muted)]">
          <span>
            {total === 0
              ? 'No records'
              : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
          </span>
          {totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => {
                  onPageChange(page - 1);
                }}
                className="erp-page-button"
              >
                <Icon name="chevronLeft" size={15} />
              </button>
              {pageWindow(page, totalPages).map((entry, index) =>
                entry === 'gap' ? (
                  <span key={`gap-${index}`} className="px-1.5 text-[var(--erp-muted)]">
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    aria-label={`Page ${entry}`}
                    aria-current={entry === page ? 'page' : undefined}
                    onClick={() => {
                      onPageChange(entry);
                    }}
                    className={`erp-page-button ${entry === page ? 'erp-page-button-active' : ''}`}
                  >
                    {entry}
                  </button>
                ),
              )}
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= totalPages}
                onClick={() => {
                  onPageChange(page + 1);
                }}
                className="erp-page-button"
              >
                <Icon name="chevronRight" size={15} />
              </button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
