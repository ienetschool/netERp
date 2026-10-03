'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface QuotationRow {
  id: string;
  quotationNo: string;
  quotationDate: string;
  grandTotal: string;
  status: string;
  customer: { displayName: string };
}

interface CustomerOption {
  id: string;
  displayName: string;
  companyId: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_LINE = { description: '', quantity: '1', unitPrice: '0' };
const EMPTY_FORM = {
  companyId: '',
  customerId: '',
  quotationDate: new Date().toISOString().slice(0, 10),
  lines: [{ ...EMPTY_LINE }],
};

/** Sales quotations (PRD Stage 7): create, submit for approval. */
export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('sales.quotation.create');
  const canSubmit = can('sales.quotation.submit');

  const listQuery = useQuery({
    queryKey: ['sales-quotations'],
    queryFn: () =>
      api.get<{ rows: QuotationRow[]; total: number }>('/sales/quotations?page=1&pageSize=50'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/companies'),
  });

  const customersQuery = useQuery({
    queryKey: ['sales-customers-all'],
    queryFn: () =>
      api.get<{ rows: CustomerOption[]; total: number }>('/sales/customers?pageSize=200'),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['sales-quotations'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/sales/quotations', {
        companyId: payload.companyId,
        customerId: payload.customerId,
        quotationDate: payload.quotationDate,
        lines: payload.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice,
        })),
      }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sales/quotations/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const columns: Array<DataTableColumn<QuotationRow>> = [
    { key: 'quotationNo', header: 'Quote No', render: (r) => r.quotationNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.displayName },
    {
      key: 'quotationDate',
      header: 'Date',
      render: (r) => new Date(r.quotationDate).toLocaleDateString(),
    },
    { key: 'grandTotal', header: 'Total', render: (r) => r.grandTotal },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    ...(canSubmit
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: QuotationRow) =>
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
          } satisfies DataTableColumn<QuotationRow>,
        ]
      : []),
  ];

  const customerOptions = (customersQuery.data?.rows ?? []).filter(
    (c) => !form.companyId || c.companyId === form.companyId,
  );

  return (
    <div>
      <PageHeader
        title="Quotations"
        description="Quotes route through approval before converting to sales orders."
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
          <div className="grid gap-3 md:grid-cols-3">
            <select
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.companyId}
              onChange={(e) => {
                setForm({ ...form, companyId: e.target.value, customerId: '' });
              }}
              required
            >
              <option value="">Company…</option>
              {(companiesQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.customerId}
              onChange={(e) => {
                setForm({ ...form, customerId: e.target.value });
              }}
              required
            >
              <option value="">Customer…</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
            <input
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              type="date"
              value={form.quotationDate}
              onChange={(e) => {
                setForm({ ...form, quotationDate: e.target.value });
              }}
              required
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
                  placeholder="Unit price e.g. 12.50"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, unitPrice: e.target.value };
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
            disabled={createMutation.isPending || !form.companyId || !form.customerId}
          >
            Create quotation
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
        caption="Sales quotations"
      />
    </div>
  );
}
