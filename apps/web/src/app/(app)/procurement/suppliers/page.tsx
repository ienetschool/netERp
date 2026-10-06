'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface SupplierRow {
  id: string;
  supplierNo: string;
  legalName: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: string;
  currency: { code: string };
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
  baseCurrencyId: string | null;
}

const EMPTY_FORM = {
  companyId: '',
  legalName: '',
  displayName: '',
  email: '',
  phone: '',
};

/** Suppliers (PRD Stage 5). */
export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('procurement.supplier.create');

  const listQuery = useQuery({
    queryKey: ['procurement-suppliers'],
    queryFn: () =>
      api.get<{ rows: SupplierRow[]; total: number }>('/procurement/suppliers?page=1&pageSize=50'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/procurement/suppliers', {
        companyId: payload.companyId,
        legalName: payload.legalName,
        displayName: payload.displayName || payload.legalName,
        currencyId: (companiesQuery.data?.rows ?? []).find((c) => c.id === payload.companyId)
          ?.baseCurrencyId,
        ...(payload.email ? { email: payload.email } : {}),
        ...(payload.phone ? { phone: payload.phone } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['procurement-suppliers'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<SupplierRow>> = [
    { key: 'supplierNo', header: 'No', render: (r) => r.supplierNo },
    { key: 'displayName', header: 'Supplier', render: (r) => r.displayName },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
    { key: 'phone', header: 'Phone', render: (r) => r.phone ?? '—' },
    { key: 'currency', header: 'CCY', render: (r) => r.currency.code },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Vendor master data for the procure-to-pay chain."
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
            placeholder="Legal name"
            value={form.legalName}
            onChange={(e) => {
              setForm({ ...form, legalName: e.target.value });
            }}
            required
          />
          <input
            className="erp-input"
            placeholder="Display name (optional)"
            value={form.displayName}
            onChange={(e) => {
              setForm({ ...form, displayName: e.target.value });
            }}
          />
          <input
            className="erp-input"
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(e) => {
              setForm({ ...form, email: e.target.value });
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId}
          >
            Create supplier
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
        caption="Suppliers"
      />
    </div>
  );
}
