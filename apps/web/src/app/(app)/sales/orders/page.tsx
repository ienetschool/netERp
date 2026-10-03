'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface SalesOrderRow {
  id: string;
  orderNo: string;
  orderDate: string;
  grandTotal: string;
  status: string;
  customer: { displayName: string };
  lines: Array<{ id: string; quantity: string; deliveredQuantity: string }>;
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

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  standardCost: string;
  saleable: boolean;
}

const EMPTY_LINE = { productId: '', description: '', quantity: '1', unitPrice: '0' };
const EMPTY_FORM = {
  companyId: '',
  customerId: '',
  orderDate: new Date().toISOString().slice(0, 10),
  lines: [{ ...EMPTY_LINE }],
};

/** Sales orders (PRD Stage 7): create, submit for approval, track deliveries. */
export default function SalesOrdersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('sales.sales_order.create');
  const canSubmit = can('sales.sales_order.submit');

  const listQuery = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () =>
      api.get<{ rows: SalesOrderRow[]; total: number }>('/sales/orders?page=1&pageSize=50'),
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

  const productsQuery = useQuery({
    queryKey: ['sales-products-options'],
    queryFn: () =>
      api.get<{ rows: ProductOption[]; total: number }>('/inventory/products?pageSize=200'),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/sales/orders', {
        companyId: payload.companyId,
        customerId: payload.customerId,
        orderDate: payload.orderDate,
        lines: payload.lines.map((l) => ({
          ...(l.productId ? { productId: l.productId } : {}),
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
    mutationFn: (id: string) => api.post(`/sales/orders/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const columns: Array<DataTableColumn<SalesOrderRow>> = [
    { key: 'orderNo', header: 'SO No', render: (r) => r.orderNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.displayName },
    {
      key: 'orderDate',
      header: 'Ordered',
      render: (r) => new Date(r.orderDate).toLocaleDateString(),
    },
    { key: 'grandTotal', header: 'Total', render: (r) => r.grandTotal },
    {
      key: 'delivered',
      header: 'Delivered',
      render: (r) => {
        const ordered = r.lines.reduce((acc, l) => acc + Number(l.quantity), 0);
        const delivered = r.lines.reduce((acc, l) => acc + Number(l.deliveredQuantity), 0);
        return `${delivered}/${ordered}`;
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    ...(canSubmit
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: SalesOrderRow) =>
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
          } satisfies DataTableColumn<SalesOrderRow>,
        ]
      : []),
  ];

  const customerOptions = (customersQuery.data?.rows ?? []).filter(
    (c) => !form.companyId || c.companyId === form.companyId,
  );

  return (
    <div>
      <PageHeader
        title="Sales orders"
        description="Orders route through approval; deliveries update fulfillment quantities."
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
              value={form.orderDate}
              onChange={(e) => {
                setForm({ ...form, orderDate: e.target.value });
              }}
              required
            />
          </div>
          <div className="space-y-2">
            {form.lines.map((line, i) => (
              <div key={i} className="grid items-center gap-2 md:grid-cols-5">
                <select
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  value={line.productId}
                  onChange={(e) => {
                    const product = (productsQuery.data?.rows ?? []).find(
                      (p) => p.id === e.target.value,
                    );
                    const lines = [...form.lines];
                    lines[i] = {
                      ...line,
                      productId: e.target.value,
                      description: product ? product.name : line.description,
                      unitPrice: product ? product.standardCost : line.unitPrice,
                    };
                    setForm({ ...form, lines });
                  }}
                >
                  <option value="">Product (optional)…</option>
                  {(productsQuery.data?.rows ?? [])
                    .filter((p) => p.saleable)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                </select>
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
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
                <button
                  type="button"
                  className="text-xs text-[var(--erp-muted)] disabled:opacity-30"
                  disabled={form.lines.length === 1}
                  onClick={() => {
                    setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) });
                  }}
                >
                  Remove
                </button>
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
            Create sales order
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
        caption="Sales orders"
      />
    </div>
  );
}
