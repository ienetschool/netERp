'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface PurchaseRequestRow {
  id: string;
  requestNo: string;
  status: string;
  requiredDate: string;
  purpose: string | null;
  lines: Array<{ id: string; description: string; quantity: string; estimatedTotal: string }>;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_LINE = { description: '', quantity: '1', estimatedUnitCost: '0' };
const EMPTY_FORM = { companyId: '', requiredDate: '', purpose: '', lines: [{ ...EMPTY_LINE }] };

/** Purchase requests (PRD Stage 5): create, add lines, submit for approval. */
export default function PurchaseRequestsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('procurement.purchase_request.create');
  const canSubmit = can('procurement.purchase_request.submit');

  const listQuery = useQuery({
    queryKey: ['procurement-prs'],
    queryFn: () =>
      api.get<{ rows: PurchaseRequestRow[]; total: number }>(
        '/procurement/purchase-requests?page=1&pageSize=50',
      ),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/procurement/purchase-requests', {
        companyId: payload.companyId,
        requiredDate: payload.requiredDate,
        ...(payload.purpose ? { purpose: payload.purpose } : {}),
        lines: payload.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          estimatedUnitCost: l.estimatedUnitCost,
        })),
      }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/procurement/purchase-requests/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const columns: Array<DataTableColumn<PurchaseRequestRow>> = [
    { key: 'requestNo', header: 'No', render: (r) => r.requestNo },
    {
      key: 'lines',
      header: 'Lines',
      render: (r) =>
        r.lines
          .map((l) => `${l.quantity}× ${l.description}`)
          .join(', ')
          .slice(0, 80) || '—',
    },
    {
      key: 'total',
      header: 'Estimated total',
      render: (r) => {
        const total = r.lines.reduce((acc, l) => acc + Number(l.estimatedTotal), 0);
        return total.toFixed(2);
      },
    },
    {
      key: 'requiredDate',
      header: 'Required',
      render: (r) => new Date(r.requiredDate).toLocaleDateString(),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    ...(canSubmit
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: PurchaseRequestRow) =>
              r.status === 'DRAFT' ? (
                <button
                  className="text-xs text-[var(--erp-accent)]"
                  disabled={submitMutation.isPending}
                  onClick={() => {
                    submitMutation.mutate(r.id);
                  }}
                >
                  Submit
                </button>
              ) : null,
          } satisfies DataTableColumn<PurchaseRequestRow>,
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Purchase requests"
        description="Requests route through the approval inbox; approved requests feed RFQs and purchase orders."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 space-y-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <select
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.companyId}
              onChange={(e) => {
                setForm({ ...form, companyId: e.target.value });
              }}
              required
            >
              <option value="">Company…</option>
              {(companiesQuery.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <input
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              type="date"
              value={form.requiredDate}
              onChange={(e) => {
                setForm({ ...form, requiredDate: e.target.value });
              }}
              required
            />
            <input
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm md:col-span-2"
              placeholder="Purpose (optional)"
              value={form.purpose}
              onChange={(e) => {
                setForm({ ...form, purpose: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            {form.lines.map((line, i) => (
              <div key={i} className="grid items-center gap-2 md:grid-cols-4">
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs md:col-span-2"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, description: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                />
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, quantity: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                />
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  placeholder="Unit cost e.g. 12.50"
                  value={line.estimatedUnitCost}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, estimatedUnitCost: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-xs"
                onClick={() => {
                  setForm({ ...form, lines: [...form.lines, { ...EMPTY_LINE }] });
                }}
              >
                Add line
              </button>
              <button
                type="button"
                className="text-xs text-[var(--erp-muted)] disabled:opacity-30"
                disabled={form.lines.length === 1}
                onClick={() => {
                  setForm({ ...form, lines: form.lines.slice(0, -1) });
                }}
              >
                Remove last
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.requiredDate}
          >
            Create purchase request
          </button>
        </form>
      ) : null}

      <DataTable
        columns={columns}
        rows={listQuery.data?.rows}
        loading={listQuery.isLoading}
        error={listQuery.error}
        total={listQuery.data?.total}
        getRowKey={(r) => r.id}
        caption="Purchase requests"
      />
    </div>
  );
}
