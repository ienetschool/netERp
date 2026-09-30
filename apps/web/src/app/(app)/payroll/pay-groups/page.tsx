'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface PayGroupRow {
  id: string;
  companyId: string;
  name: string;
  frequency: string;
  payDayRule: string;
  status: string;
  currency: { code: string };
  _count: { employees: number };
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
  baseCurrencyId: string | null;
}

const FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'BI_WEEKLY', 'WEEKLY'];

const EMPTY_FORM = { companyId: '', name: '', frequency: 'MONTHLY' };

/** Pay groups (PRD Stage 4): payroll frequency and currency per company. */
export default function PayGroupsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('payroll.pay_group.create');

  const listQuery = useQuery({
    queryKey: ['payroll-pay-groups'],
    queryFn: () => api.get<PayGroupRow[]>('/payroll/pay-groups'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/admin/companies'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) => {
      const company = (companiesQuery.data ?? []).find((c) => c.id === payload.companyId);
      return api.post('/payroll/pay-groups', {
        companyId: payload.companyId,
        name: payload.name,
        frequency: payload.frequency,
        currencyId: company?.baseCurrencyId,
        payDayRule: 'LAST_DAY_OF_MONTH',
      });
    },
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-groups'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<PayGroupRow>> = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'frequency', header: 'Frequency', render: (r) => r.frequency },
    { key: 'currency', header: 'Currency', render: (r) => r.currency.code },
    { key: 'payDayRule', header: 'Pay day rule', render: (r) => r.payDayRule },
    { key: 'employees', header: 'Employees', render: (r) => String(r._count.employees) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Pay groups"
        description="Payroll frequencies and currencies; employees are assigned to a pay group for run eligibility."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-4"
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
            {(companiesQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Name (e.g. Monthly Staff)"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
            required
          />
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.frequency}
            onChange={(e) => {
              setForm({ ...form, frequency: e.target.value });
            }}
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId}
          >
            Create pay group
          </button>
        </form>
      ) : null}

      <DataTable
        columns={columns}
        rows={listQuery.data}
        loading={listQuery.isLoading}
        error={listQuery.error}
        getRowKey={(r) => r.id}
        caption="Pay groups"
      />
    </div>
  );
}
