'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  productType: string;
  standardCost: string;
  reorderLevel: string;
  status: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  sku: '',
  name: '',
  standardCost: '0',
  reorderLevel: '0',
};

/** Products (PRD Stage 6): stock items with units, costs and reorder levels. */
export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('inventory.product.create');

  const listQuery = useQuery({
    queryKey: ['inventory-products'],
    queryFn: () =>
      api.get<{ rows: ProductRow[]; total: number }>('/inventory/products?pageSize=100'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/inventory/products', {
        companyId: payload.companyId,
        sku: payload.sku,
        name: payload.name,
        standardCost: payload.standardCost || '0',
        reorderLevel: payload.reorderLevel || '0',
      }),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['inventory-products'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<ProductRow>> = [
    { key: 'sku', header: 'SKU', render: (r) => r.sku },
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'type', header: 'Type', render: (r) => r.productType },
    { key: 'cost', header: 'Std cost', render: (r) => r.standardCost },
    { key: 'reorder', header: 'Reorder at', render: (r) => r.reorderLevel },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        description="Stock and non-stock items; costs and reorder levels drive inventory alerts."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] erp-frost p-4 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <select
            className="erp-select"
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
            className="erp-input"
            placeholder="SKU"
            value={form.sku}
            onChange={(e) => {
              setForm({ ...form, sku: e.target.value });
            }}
            required
          />
          <input
            className="erp-input"
            placeholder="Product name"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
            required
          />
          <input
            className="erp-input"
            placeholder="Standard cost"
            value={form.standardCost}
            onChange={(e) => {
              setForm({ ...form, standardCost: e.target.value });
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId}
          >
            Create product
          </button>
        </form>
      ) : null}

      <DataTable
        columns={columns}
        rows={listQuery.data?.rows}
        loading={listQuery.isLoading}
        error={listQuery.error}
        getRowKey={(r) => r.id}
        caption="Products"
      />
    </div>
  );
}
