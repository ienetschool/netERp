'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDownload } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface DimensionMeta {
  key: string;
  label: string;
}

interface MetricMeta {
  key: string;
  label: string;
}

interface Definition {
  id: string;
  code: string;
  name: string;
  description: string | null;
  module: string;
  permission: string;
  companyId: string | null;
  dimensions: DimensionMeta[];
  metrics: MetricMeta[];
  defaultGrouping: string[];
  supportedFilters: string[];
}

interface ReportColumn {
  key: string;
  label: string;
  kind: 'dimension' | 'metric';
}

interface AggregatedRow {
  group: Record<string, string>;
  metrics: Record<string, string>;
}

interface RunResult {
  definition: { id: string; code: string; name: string; module: string };
  columns: ReportColumn[];
  headers: string[];
  rows: AggregatedRow[];
  totals: Record<string, string>;
  page: number;
  pageSize: number;
  total: number;
  sourceRowCount: number;
  truncated: boolean;
}

interface DrillDownResult {
  definition: { code: string; name: string };
  headers: string[];
  rows: string[][];
  matched: number;
  truncated: boolean;
}

interface ExportRow {
  id: string;
  format: string;
  status: string;
  rowCount: number | null;
  sizeBytes: number | null;
  requestedAt: string;
  expiresAt: string | null;
  errorMessage: string | null;
}

interface SavedRow {
  id: string;
  reportDefinitionId: string;
  name: string;
  filters: Record<string, string>;
  grouping: string[];
  createdAt: string;
  reportDefinition: { code: string; name: string; module: string };
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const FILTER_LABELS: Record<string, string> = {
  companyId: 'Company',
  branchId: 'Branch',
  departmentId: 'Department',
  warehouseId: 'Warehouse',
  costCenterId: 'Cost centre',
  customerId: 'Customer',
  supplierId: 'Supplier',
  productId: 'Product',
  status: 'Status',
  from: 'From',
  to: 'To',
};

const EMPTY_FILTERS: Record<string, string> = {};

/** Reporting workspace (PRD Stage 11; USER-FLOWS §21, UI-UX §21). */
export default function ReportsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>(EMPTY_FILTERS);
  const [grouping, setGrouping] = useState<string[]>([]);
  const [sortField, setSortField] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [drill, setDrill] = useState<{ groupKey: Record<string, string> } | null>(null);
  const [savedName, setSavedName] = useState('');
  const [showSaved, setShowSaved] = useState(false);

  const canExport = can('reporting.export.create');
  const canSave = can('reporting.report.create');

  const definitionsQuery = useQuery({
    queryKey: ['report-definitions'],
    queryFn: () =>
      api.get<{ rows: Definition[]; total: number; hiddenCount: number }>('/reports/definitions'),
  });
  const definitions = definitionsQuery.data?.rows ?? [];
  const selected = definitions.find((d) => d.code === selectedCode) ?? definitions[0] ?? null;

  // Selecting a different report resets filters and grouping to its defaults.
  useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setGrouping(selected?.defaultGrouping ?? []);
    setSortField('');
    setPage(1);
    setDrill(null);
  }, [selected?.code, selected?.defaultGrouping]);

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/companies'),
  });

  const runBody = useMemo(
    () => ({
      filters: Object.keys(filters).length > 0 ? filters : undefined,
      grouping,
      ...(sortField ? { sorting: { field: sortField, direction: sortDirection } } : {}),
      page,
      pageSize: 25,
    }),
    [filters, grouping, sortField, sortDirection, page],
  );

  const runQuery = useQuery({
    queryKey: ['report-run', selected?.code, runBody],
    queryFn: () => api.post<RunResult>(`/reports/definitions/${selected?.code}/run`, runBody),
    enabled: Boolean(selected?.code),
  });

  const drillQuery = useQuery({
    queryKey: ['report-drill', selected?.code, drill?.groupKey, runBody],
    queryFn: () =>
      api.post<DrillDownResult>(`/reports/definitions/${selected?.code}/drill-down`, {
        ...runBody,
        groupKey: drill?.groupKey ?? {},
      }),
    enabled: Boolean(selected?.code) && drill !== null,
  });

  const exportsQuery = useQuery({
    queryKey: ['report-exports'],
    queryFn: () => api.get<{ rows: ExportRow[]; total: number }>('/reports/exports?pageSize=20'),
  });

  const savedQuery = useQuery({
    queryKey: ['report-saved', selected?.id],
    queryFn: () =>
      api.get<{ rows: SavedRow[]; total: number }>(
        selected?.id ? `/reports/saved?definitionId=${selected.id}` : '/reports/saved',
      ),
    enabled: Boolean(selected?.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['report-run'] });
    void queryClient.invalidateQueries({ queryKey: ['report-exports'] });
    void queryClient.invalidateQueries({ queryKey: ['report-saved'] });
  };

  const exportMutation = useMutation({
    mutationFn: (format: 'CSV' | 'JSON') =>
      api.post<ExportRow>('/reports/exports', {
        reportDefinitionId: selected?.id,
        format,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Export failed');
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post('/reports/saved', {
        reportDefinitionId: selected?.id,
        name: savedName,
        filters,
        columns: (runQuery.data?.columns ?? []).map((c) => c.key),
        sorting: sortField ? { field: sortField, direction: sortDirection } : {},
        grouping,
      }),
    onSuccess: () => {
      setError(null);
      setSavedName('');
      void queryClient.invalidateQueries({ queryKey: ['report-saved'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Saving the report failed');
    },
  });

  const deleteSavedMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/saved/${id}`),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['report-saved'] });
    },
  });

  const applySaved = (saved: SavedRow) => {
    setFilters(saved.filters);
    setGrouping(saved.grouping);
    setPage(1);
  };

  const download = (id: string, format: string) => {
    void apiDownload(
      `/reports/exports/${id}/download`,
      `report-export.${format.toLowerCase()}`,
    ).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Download failed');
    });
  };

  const supportedFilters = selected?.supportedFilters ?? [];
  const result = runQuery.data;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Filterable reporting over posted accounting data, with drill-down, exports and saved configurations."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div className="rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
          <p className="border-b border-[var(--erp-border)] px-3 py-2 text-sm font-medium">
            Reports
          </p>
          {definitionsQuery.isLoading ? (
            <p className="px-3 py-4 text-sm">Loading…</p>
          ) : definitionsQuery.error ? (
            <p className="px-3 py-4 text-sm text-red-600">
              {definitionsQuery.error instanceof Error
                ? definitionsQuery.error.message
                : 'Failed to load reports'}
            </p>
          ) : definitions.length === 0 ? (
            <p className="px-3 py-4 text-sm">No reports are available to you.</p>
          ) : (
            <ul>
              {definitions.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCode(d.code);
                    }}
                    className={`w-full border-b border-[var(--erp-border)] px-3 py-2 text-left last:border-b-0 ${
                      selected?.code === d.code ? 'bg-[var(--erp-bg)]' : ''
                    }`}
                  >
                    <span className="block text-sm font-medium">{d.name}</span>
                    <span className="block text-xs text-[var(--erp-muted)]">{d.module}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0">
          {selected ? (
            <>
              <div className="mb-4 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4">
                <p className="mb-3 text-sm font-medium">{selected.name}</p>
                <div className="grid gap-3 md:grid-cols-4">
                  {supportedFilters.map((key) =>
                    key === 'companyId' ? (
                      <label key={key} className="text-xs text-[var(--erp-muted)]">
                        {FILTER_LABELS[key]}
                        <select
                          className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                          value={filters[key] ?? ''}
                          onChange={(e) => {
                            setPage(1);
                            setFilters({ ...filters, [key]: e.target.value });
                          }}
                        >
                          <option value="">All</option>
                          {(companiesQuery.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} — {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : key === 'from' || key === 'to' ? (
                      <label key={key} className="text-xs text-[var(--erp-muted)]">
                        {FILTER_LABELS[key]}
                        <input
                          type="date"
                          className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                          value={filters[key] ?? ''}
                          onChange={(e) => {
                            setPage(1);
                            setFilters({ ...filters, [key]: e.target.value });
                          }}
                        />
                      </label>
                    ) : (
                      <label key={key} className="text-xs text-[var(--erp-muted)]">
                        {FILTER_LABELS[key]}
                        <input
                          className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                          value={filters[key] ?? ''}
                          placeholder="All"
                          onChange={(e) => {
                            setPage(1);
                            setFilters({ ...filters, [key]: e.target.value });
                          }}
                        />
                      </label>
                    ),
                  )}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <label className="text-xs text-[var(--erp-muted)] md:col-span-2">
                    Group by
                    <div className="mt-1 flex flex-wrap gap-1">
                      {selected.dimensions.map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => {
                            setPage(1);
                            setGrouping(
                              grouping.includes(d.key)
                                ? grouping.filter((g) => g !== d.key)
                                : [...grouping, d.key].slice(0, 4),
                            );
                          }}
                          className={`rounded-full border px-2 py-1 text-xs ${
                            grouping.includes(d.key)
                              ? 'border-[var(--erp-accent)] bg-[var(--erp-accent)] text-white'
                              : 'border-[var(--erp-border)]'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </label>

                  <label className="text-xs text-[var(--erp-muted)]">
                    Sort by
                    <select
                      className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                      value={sortField}
                      onChange={(e) => {
                        setPage(1);
                        setSortField(e.target.value);
                      }}
                    >
                      <option value="">Report default</option>
                      {[...selected.metrics, ...selected.dimensions].map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs text-[var(--erp-muted)]">
                    Direction
                    <select
                      className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                      value={sortDirection}
                      onChange={(e) => {
                        setSortDirection(e.target.value as 'asc' | 'desc');
                      }}
                    >
                      <option value="desc">Descending</option>
                      <option value="asc">Ascending</option>
                    </select>
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canExport ? (
                    <>
                      <button
                        type="button"
                        className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                        disabled={exportMutation.isPending}
                        onClick={() => {
                          exportMutation.mutate('CSV');
                        }}
                      >
                        Export CSV
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                        disabled={exportMutation.isPending}
                        onClick={() => {
                          exportMutation.mutate('JSON');
                        }}
                      >
                        Export JSON
                      </button>
                    </>
                  ) : null}
                  {canSave ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (savedName.trim()) saveMutation.mutate();
                      }}
                    >
                      <input
                        className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-1.5 text-sm"
                        placeholder="Save as…"
                        value={savedName}
                        onChange={(e) => {
                          setSavedName(e.target.value);
                        }}
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                        disabled={saveMutation.isPending || savedName.trim().length === 0}
                      >
                        Save
                      </button>
                    </form>
                  ) : null}
                  <button
                    type="button"
                    className="ml-auto rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-sm font-medium"
                    onClick={() => {
                      setShowSaved((v) => !v);
                    }}
                  >
                    {showSaved ? 'Hide saved' : `Saved (${savedQuery.data?.total ?? 0})`}
                  </button>
                </div>
              </div>

              {showSaved ? (
                <div className="mb-4 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
                  <p className="border-b border-[var(--erp-border)] px-3 py-2 text-sm font-medium">
                    Saved configurations
                  </p>
                  {(savedQuery.data?.rows ?? []).length === 0 ? (
                    <p className="px-3 py-3 text-sm text-[var(--erp-muted)]">
                      Nothing saved for this report yet.
                    </p>
                  ) : (
                    <ul>
                      {(savedQuery.data?.rows ?? []).map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-2 border-b border-[var(--erp-border)] px-3 py-2 last:border-b-0"
                        >
                          <button
                            type="button"
                            className="text-sm hover:underline"
                            onClick={() => {
                              applySaved(s);
                            }}
                          >
                            {s.name}
                          </button>
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={() => {
                              deleteSavedMutation.mutate(s.id);
                            }}
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
                {runQuery.isLoading ? (
                  <p className="p-4 text-sm">Running report…</p>
                ) : runQuery.error ? (
                  <p className="p-4 text-sm text-red-600">
                    {runQuery.error instanceof Error ? runQuery.error.message : 'Failed to run'}
                  </p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-[var(--erp-border)] text-left">
                      <tr>
                        {(result?.columns ?? []).map((c) => (
                          <th key={c.key} className="px-3 py-2 font-medium">
                            {c.label}
                          </th>
                        ))}
                        <th className="px-3 py-2 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result?.rows ?? []).map((row, index) => (
                        <tr
                          key={`${JSON.stringify(row.group)}-${index}`}
                          className="border-b border-[var(--erp-border)] last:border-b-0"
                        >
                          {(result?.columns ?? []).map((c) => (
                            <td
                              key={c.key}
                              className={
                                c.kind === 'metric'
                                  ? 'px-3 py-2 text-right tabular-nums'
                                  : 'px-3 py-2'
                              }
                            >
                              {c.kind === 'dimension'
                                ? row.group[c.key] || '—'
                                : (row.metrics[c.key] ?? '0.00')}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-xs text-[var(--erp-primary)] hover:underline"
                              onClick={() => {
                                setDrill({ groupKey: row.group });
                              }}
                            >
                              Drill down
                            </button>
                          </td>
                        </tr>
                      ))}
                      {(result?.rows ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={(result?.columns ?? []).length + 1}
                            className="px-3 py-4 text-center text-[var(--erp-muted)]"
                          >
                            No rows matched these filters.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                    {result && result.rows.length > 0 ? (
                      <tfoot className="border-t border-[var(--erp-border)] bg-[var(--erp-bg)] font-medium">
                        <tr>
                          {result.columns.map((c, i) => (
                            <td
                              key={c.key}
                              className={
                                c.kind === 'metric'
                                  ? 'px-3 py-2 text-right tabular-nums'
                                  : 'px-3 py-2'
                              }
                            >
                              {c.kind === 'dimension'
                                ? i === 0
                                  ? 'Total'
                                  : ''
                                : (result.totals[c.key] ?? '0.00')}
                            </td>
                          ))}
                          <td />
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                )}
              </div>

              {result ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--erp-muted)]">
                  <span>
                    {result.total} row{result.total === 1 ? '' : 's'} from {result.sourceRowCount}{' '}
                    source record{result.sourceRowCount === 1 ? '' : 's'}
                    {result.truncated ? ' (truncated at the 50,000-row safety cap)' : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded border border-[var(--erp-border)] px-2 py-1 disabled:opacity-50"
                      disabled={page <= 1}
                      onClick={() => {
                        setPage(page - 1);
                      }}
                    >
                      Previous
                    </button>
                    <span>
                      Page {result.page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}
                    </span>
                    <button
                      type="button"
                      className="rounded border border-[var(--erp-border)] px-2 py-1 disabled:opacity-50"
                      disabled={page * result.pageSize >= result.total}
                      onClick={() => {
                        setPage(page + 1);
                      }}
                    >
                      Next
                    </button>
                  </span>
                </div>
              ) : null}

              {drill ? (
                <div className="mt-4 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
                  <div className="flex items-center justify-between border-b border-[var(--erp-border)] px-3 py-2">
                    <p className="text-sm font-medium">
                      Transactions behind{' '}
                      {Object.entries(drill.groupKey)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')}
                    </p>
                    <button
                      type="button"
                      className="text-xs hover:underline"
                      onClick={() => {
                        setDrill(null);
                      }}
                    >
                      Close
                    </button>
                  </div>
                  {drillQuery.isLoading ? (
                    <p className="px-3 py-4 text-sm">Loading transactions…</p>
                  ) : drillQuery.error ? (
                    <p className="px-3 py-4 text-sm text-red-600">
                      {drillQuery.error instanceof Error
                        ? drillQuery.error.message
                        : 'Failed to load transactions'}
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="border-b border-[var(--erp-border)] text-left">
                            <tr>
                              {(drillQuery.data?.headers ?? []).map((h) => (
                                <th key={h} className="px-3 py-2 font-medium">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(drillQuery.data?.rows ?? []).map((row, i) => (
                              <tr
                                key={i}
                                className="border-b border-[var(--erp-border)] last:border-b-0"
                              >
                                {row.map((cell, j) => (
                                  <td key={j} className="px-3 py-2 tabular-nums">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="px-3 py-2 text-xs text-[var(--erp-muted)]">
                        {drillQuery.data?.matched ?? 0} matching record(s)
                        {drillQuery.data?.truncated ? ' (first 200 shown)' : ''}
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              <div className="mt-6 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
                <p className="border-b border-[var(--erp-border)] px-3 py-2 text-sm font-medium">
                  Recent exports
                </p>
                {(exportsQuery.data?.rows ?? []).length === 0 ? (
                  <p className="px-3 py-3 text-sm text-[var(--erp-muted)]">No exports yet.</p>
                ) : (
                  <ul>
                    {(exportsQuery.data?.rows ?? []).map((x) => (
                      <li
                        key={x.id}
                        className="flex items-center justify-between gap-2 border-b border-[var(--erp-border)] px-3 py-2 last:border-b-0"
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <StatusBadge status={x.status} />
                          <span className="tabular-nums">{x.rowCount ?? 0} rows</span>
                          <span className="text-xs text-[var(--erp-muted)]">
                            {new Date(x.requestedAt).toLocaleString()}
                          </span>
                          {x.errorMessage ? (
                            <span className="text-xs text-red-600">{x.errorMessage}</span>
                          ) : null}
                        </span>
                        {x.status === 'READY' ? (
                          <button
                            type="button"
                            className="text-xs text-[var(--erp-primary)] hover:underline"
                            onClick={() => {
                              download(x.id, x.format);
                            }}
                          >
                            Download
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--erp-muted)]">Select a report to run it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
