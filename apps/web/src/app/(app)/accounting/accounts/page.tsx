'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface AccountRow {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  isPostable: boolean;
  status: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  accountCode: '',
  accountName: '',
  accountType: 'ASSET',
  normalBalance: 'DEBIT',
};

/** Chart of accounts (PRD Stage 8). */
export default function AccountsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('accounting.account.create');

  const listQuery = useQuery({
    queryKey: ['accounting-accounts'],
    queryFn: () =>
      api.get<{ rows: AccountRow[]; total: number }>('/accounting/accounts?pageSize=200'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/accounting/accounts', {
        companyId: payload.companyId,
        accountCode: payload.accountCode,
        accountName: payload.accountName,
        accountType: payload.accountType,
        normalBalance: payload.normalBalance,
      }),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['accounting-accounts'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<AccountRow>> = [
    { key: 'accountCode', header: 'Code', render: (r) => r.accountCode },
    { key: 'accountName', header: 'Name', render: (r) => r.accountName },
    { key: 'accountType', header: 'Type', render: (r) => r.accountType },
    { key: 'normalBalance', header: 'Normal', render: (r) => r.normalBalance },
    { key: 'postable', header: 'Postable', render: (r) => (r.isPostable ? 'Yes' : 'No') },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        description="Posting accounts for journals; control accounts are non-postable."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] erp-frost p-4 md:grid-cols-6"
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
            placeholder="Code e.g. 5200"
            value={form.accountCode}
            onChange={(e) => {
              setForm({ ...form, accountCode: e.target.value });
            }}
            required
          />
          <input
            className="erp-input md:col-span-2"
            placeholder="Account name"
            value={form.accountName}
            onChange={(e) => {
              setForm({ ...form, accountName: e.target.value });
            }}
            required
          />
          <select
            className="erp-select"
            value={form.accountType}
            onChange={(e) => {
              const accountType = e.target.value;
              const normalBalance =
                accountType === 'ASSET' || accountType === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
              setForm({ ...form, accountType, normalBalance });
            }}
          >
            <option value="ASSET">Asset</option>
            <option value="LIABILITY">Liability</option>
            <option value="EQUITY">Equity</option>
            <option value="REVENUE">Revenue</option>
            <option value="EXPENSE">Expense</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.accountCode}
          >
            Create account
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
        caption="Chart of accounts"
      />
    </div>
  );
}
