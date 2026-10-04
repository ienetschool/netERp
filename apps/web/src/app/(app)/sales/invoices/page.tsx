'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  grandTotal: string;
  paidAmount: string;
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
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
  lines: [{ ...EMPTY_LINE }],
};

/** Customer invoices (PRD Stage 7): create, post to AR, track payment. */
export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('sales.invoice.create');
  const canPost = can('sales.invoice.post');

  const listQuery = useQuery({
    queryKey: ['sales-invoices'],
    queryFn: () =>
      api.get<{ rows: InvoiceRow[]; total: number }>('/sales/invoices?page=1&pageSize=50'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const customersQuery = useQuery({
    queryKey: ['sales-customers-all'],
    queryFn: () =>
      api.get<{ rows: CustomerOption[]; total: number }>('/sales/customers?pageSize=200'),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/sales/invoices', {
        companyId: payload.companyId,
        customerId: payload.customerId,
        invoiceDate: payload.invoiceDate,
        dueDate: payload.dueDate,
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

  const postMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sales/invoices/${id}/post`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Post failed');
    },
  });

  const columns: Array<DataTableColumn<InvoiceRow>> = [
    { key: 'invoiceNo', header: 'Invoice No', render: (r) => r.invoiceNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.displayName },
    {
      key: 'invoiceDate',
      header: 'Invoiced',
      render: (r) => new Date(r.invoiceDate).toLocaleDateString(),
    },
    {
      key: 'dueDate',
      header: 'Due',
      render: (r) => new Date(r.dueDate).toLocaleDateString(),
    },
    { key: 'grandTotal', header: 'Total', render: (r) => r.grandTotal },
    { key: 'paidAmount', header: 'Paid', render: (r) => r.paidAmount },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    ...(canPost
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: InvoiceRow) =>
              r.status === 'DRAFT' ? (
                <button
                  className="text-xs text-[var(--erp-accent)]"
                  disabled={postMutation.isPending}
                  onClick={() => {
                    postMutation.mutate(r.id);
                  }}
                >
                  Post
                </button>
              ) : null,
          } satisfies DataTableColumn<InvoiceRow>,
        ]
      : []),
  ];

  const customerOptions = (customersQuery.data?.rows ?? []).filter(
    (c) => !form.companyId || c.companyId === form.companyId,
  );

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Posting creates open AR; receipts allocate against posted invoices."
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
                setForm({ ...form, companyId: e.target.value, customerId: '' });
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
              value={form.invoiceDate}
              onChange={(e) => {
                setForm({ ...form, invoiceDate: e.target.value });
              }}
              required
            />
            <input
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              type="date"
              value={form.dueDate}
              onChange={(e) => {
                setForm({ ...form, dueDate: e.target.value });
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
                  placeholder="Unit price e.g. 25.00"
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
            Create invoice
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
        caption="Customer invoices"
      />
    </div>
  );
}
