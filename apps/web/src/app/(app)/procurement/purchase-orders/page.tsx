'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface PurchaseOrderRow {
  id: string;
  poNo: string;
  status: string;
  orderDate: string;
  grandTotal: string;
  currencyId: string;
  supplier: { displayName: string };
  lines: Array<{ id: string; quantity: string; receivedQuantity: string }>;
}

interface SupplierOption {
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
  supplierId: '',
  orderDate: new Date().toISOString().slice(0, 10),
  lines: [{ ...EMPTY_LINE }],
};

/** Purchase orders (PRD Stage 5): create, submit for approval, track receipts. */
export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('procurement.purchase_order.create');
  const canSubmit = can('procurement.purchase_order.submit');

  const listQuery = useQuery({
    queryKey: ['procurement-pos'],
    queryFn: () =>
      api.get<{ rows: PurchaseOrderRow[]; total: number }>(
        '/procurement/purchase-orders?page=1&pageSize=50',
      ),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const suppliersQuery = useQuery({
    queryKey: ['procurement-suppliers-all'],
    queryFn: () =>
      api.get<{ rows: SupplierOption[]; total: number }>(
        '/procurement/suppliers?page=1&pageSize=200',
      ),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['procurement-pos'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/procurement/purchase-orders', {
        companyId: payload.companyId,
        supplierId: payload.supplierId,
        orderDate: payload.orderDate,
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
    mutationFn: (id: string) => api.post(`/procurement/purchase-orders/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const columns: Array<DataTableColumn<PurchaseOrderRow>> = [
    { key: 'poNo', header: 'PO No', render: (r) => r.poNo },
    { key: 'supplier', header: 'Supplier', render: (r) => r.supplier.displayName },
    {
      key: 'orderDate',
      header: 'Ordered',
      render: (r) => new Date(r.orderDate).toLocaleDateString(),
    },
    { key: 'grandTotal', header: 'Total', render: (r) => r.grandTotal },
    {
      key: 'received',
      header: 'Received',
      render: (r) => {
        const ordered = r.lines.reduce((acc, l) => acc + Number(l.quantity), 0);
        const received = r.lines.reduce((acc, l) => acc + Number(l.receivedQuantity), 0);
        return `${received}/${ordered}`;
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    ...(canSubmit
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: PurchaseOrderRow) =>
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
          } satisfies DataTableColumn<PurchaseOrderRow>,
        ]
      : []),
  ];

  const supplierOptions = (suppliersQuery.data?.rows ?? []).filter(
    (s) => !form.companyId || s.companyId === form.companyId,
  );

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Orders route through approval; goods receipts update received quantities."
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
                setForm({ ...form, companyId: e.target.value, supplierId: '' });
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
              value={form.supplierId}
              onChange={(e) => {
                setForm({ ...form, supplierId: e.target.value });
              }}
              required
            >
              <option value="">Supplier…</option>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
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
                  placeholder="Unit price e.g. 4.50"
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
            disabled={createMutation.isPending || !form.companyId || !form.supplierId}
          >
            Create purchase order
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
        caption="Purchase orders"
      />
    </div>
  );
}
