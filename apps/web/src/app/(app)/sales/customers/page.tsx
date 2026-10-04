'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface CustomerRow {
  id: string;
  customerNo: string;
  displayName: string;
  legalName: string;
  email: string | null;
  creditLimit: string;
  status: string;
  currency: { code: string };
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  displayName: '',
  legalName: '',
  email: '',
  creditLimit: '0',
};

/** Customers (PRD Stage 7): sales counterparties with credit limits. */
export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('sales.customer.create');

  const listQuery = useQuery({
    queryKey: ['sales-customers'],
    queryFn: () => api.get<{ rows: CustomerRow[]; total: number }>('/sales/customers?pageSize=100'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/sales/customers', {
        companyId: payload.companyId,
        legalName: payload.legalName || payload.displayName,
        displayName: payload.displayName,
        ...(payload.email ? { email: payload.email } : {}),
        creditLimit: payload.creditLimit || '0',
      }),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['sales-customers'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<CustomerRow>> = [
    { key: 'customerNo', header: 'No', render: (r) => r.customerNo },
    { key: 'displayName', header: 'Customer', render: (r) => r.displayName },
    { key: 'currency', header: 'Currency', render: (r) => r.currency.code },
    { key: 'creditLimit', header: 'Credit limit', render: (r) => r.creditLimit },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Sales counterparties; credit limits guard new orders."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
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
            placeholder="Customer name"
            value={form.displayName}
            onChange={(e) => {
              setForm({ ...form, displayName: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Legal name (optional)"
            value={form.legalName}
            onChange={(e) => {
              setForm({ ...form, legalName: e.target.value });
            }}
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="email"
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => {
              setForm({ ...form, email: e.target.value });
            }}
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Credit limit e.g. 5000"
            value={form.creditLimit}
            onChange={(e) => {
              setForm({ ...form, creditLimit: e.target.value });
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.displayName}
          >
            Create customer
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
        caption="Customers"
      />
    </div>
  );
}
