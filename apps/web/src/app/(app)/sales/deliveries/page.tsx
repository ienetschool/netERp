'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface DeliveryRow {
  id: string;
  deliveryNo: string;
  deliveryDate: string;
  status: string;
  customer: { displayName: string };
  warehouse: { code: string; name: string } | null;
  lines: Array<{ id: string; quantity: string }>;
}

interface SalesOrderOption {
  id: string;
  orderNo: string;
  status: string;
  customerId: string;
  companyId: string;
  lines: Array<{ id: string; description: string; quantity: string; deliveredQuantity: string }>;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  warehouseId: '',
  salesOrderId: '',
  deliveryDate: new Date().toISOString().slice(0, 10),
};

/** Deliveries (PRD Stage 7): post stock issues against approved sales orders. */
export default function DeliveriesPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('sales.delivery.create');

  const listQuery = useQuery({
    queryKey: ['sales-deliveries'],
    queryFn: () =>
      api.get<{ rows: DeliveryRow[]; total: number }>('/sales/deliveries?page=1&pageSize=50'),
  });

  const ordersQuery = useQuery({
    queryKey: ['sales-orders-deliverable'],
    queryFn: () =>
      api.get<{ rows: SalesOrderOption[]; total: number }>(
        '/sales/orders?page=1&pageSize=100&status=APPROVED',
      ),
  });

  const warehousesQuery = useQuery({
    queryKey: ['warehouses-options'],
    queryFn: () =>
      api.get<{ items?: WarehouseOption[]; rows?: WarehouseOption[] }>(
        '/warehouses?page=1&pageSize=50',
      ),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/companies'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) => {
      const order = (ordersQuery.data?.rows ?? []).find((o) => o.id === payload.salesOrderId);
      return api.post('/sales/deliveries', {
        companyId: payload.companyId,
        warehouseId: payload.warehouseId,
        customerId: order?.customerId,
        salesOrderId: payload.salesOrderId,
        deliveryDate: payload.deliveryDate,
        lines: (order?.lines ?? []).map((l) => ({
          salesOrderLineId: l.id,
          quantity: Number(l.quantity) - Number(l.deliveredQuantity),
        })),
      });
    },
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['sales-deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<DeliveryRow>> = [
    { key: 'deliveryNo', header: 'Delivery No', render: (r) => r.deliveryNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.displayName },
    { key: 'warehouse', header: 'Warehouse', render: (r) => r.warehouse?.code ?? '—' },
    {
      key: 'deliveryDate',
      header: 'Date',
      render: (r) => new Date(r.deliveryDate).toLocaleDateString(),
    },
    {
      key: 'lines',
      header: 'Lines',
      render: (r) => r.lines.reduce((acc, l) => acc + Number(l.quantity), 0),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const warehouses = warehousesQuery.data?.items ?? warehousesQuery.data?.rows ?? [];
  const deliverable = (ordersQuery.data?.rows ?? []).filter(
    (o) => !form.companyId || o.companyId === form.companyId,
  );

  return (
    <div>
      <PageHeader
        title="Deliveries"
        description="Posting a delivery issues stock at weighted-average cost and updates order fulfillment."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.companyId}
            onChange={(e) => {
              setForm({ ...form, companyId: e.target.value, salesOrderId: '', warehouseId: '' });
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
            value={form.salesOrderId}
            onChange={(e) => {
              const order = deliverable.find((o) => o.id === e.target.value);
              setForm({
                ...form,
                salesOrderId: e.target.value,
                companyId: order?.companyId ?? form.companyId,
              });
            }}
            required
          >
            <option value="">Approved sales order…</option>
            {deliverable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNo}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.warehouseId}
            onChange={(e) => {
              setForm({ ...form, warehouseId: e.target.value });
            }}
            required
          >
            <option value="">Warehouse…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="date"
            value={form.deliveryDate}
            onChange={(e) => {
              setForm({ ...form, deliveryDate: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.salesOrderId || !form.warehouseId}
          >
            Post delivery
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
        caption="Deliveries"
      />
    </div>
  );
}
