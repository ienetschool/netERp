'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface PayrollRunRow {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  employeeCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalEmployerCost: string;
  payGroup: { name: string; frequency: string };
  currency: { code: string };
  _count: { entries: number };
}

interface PayGroupOption {
  id: string;
  name: string;
  companyId: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  payGroupId: '',
  periodStart: '',
  periodEnd: '',
  paymentDate: '',
};

function firstOfMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function lastOfMonth(): string {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

/** Payroll runs (PRD Stage 4): create, calculate, submit for approval. */
export default function PayrollRunsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    periodStart: firstOfMonth(),
    periodEnd: lastOfMonth(),
    paymentDate: lastOfMonth(),
  });

  const canCreate = can('payroll.payroll_run.create');
  const canCalculate = can('payroll.payroll_run.edit');
  const canSubmit = can('payroll.payroll_run.submit');
  const canCancel = can('payroll.payroll_run.cancel');

  const listQuery = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () =>
      api.get<{ rows: PayrollRunRow[]; total: number }>('/payroll/runs?page=1&pageSize=50'),
  });

  const payGroupsQuery = useQuery({
    queryKey: ['payroll-pay-groups'],
    queryFn: () => api.get<Array<PayGroupOption & { companyId: string }>>('/payroll/pay-groups'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/admin/companies'),
  });

  const invalidate = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/payroll/runs', {
        companyId: payload.companyId,
        payGroupId: payload.payGroupId,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        paymentDate: payload.paymentDate,
      }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'calculate' | 'submit' | 'cancel' }) =>
      api.post(`/payroll/runs/${id}/${action}`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Action failed');
    },
  });

  const columns: Array<DataTableColumn<PayrollRunRow>> = [
    {
      key: 'period',
      header: 'Period',
      render: (r) =>
        `${new Date(r.periodStart).toLocaleDateString()} – ${new Date(r.periodEnd).toLocaleDateString()}`,
    },
    { key: 'payGroup', header: 'Pay group', render: (r) => r.payGroup.name },
    { key: 'currency', header: 'CCY', render: (r) => r.currency.code },
    { key: 'employees', header: 'Employees', render: (r) => String(r.employeeCount) },
    { key: 'totalGross', header: 'Gross', render: (r) => r.totalGross },
    { key: 'totalDeductions', header: 'Deductions', render: (r) => r.totalDeductions },
    { key: 'totalNet', header: 'Net', render: (r) => r.totalNet },
    { key: 'totalEmployerCost', header: 'Employer cost', render: (r) => r.totalEmployerCost },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <span className="flex gap-2 text-xs">
          {canCalculate && (r.status === 'DRAFT' || r.status === 'CALCULATED') ? (
            <button
              className="text-[var(--erp-accent)]"
              disabled={actionMutation.isPending}
              onClick={() => {
                actionMutation.mutate({ id: r.id, action: 'calculate' });
              }}
            >
              Calculate
            </button>
          ) : null}
          {canSubmit && r.status === 'CALCULATED' ? (
            <Link className="text-[var(--erp-accent)]" href={`/payroll/runs/${r.id}`}>
              Review & submit
            </Link>
          ) : null}
          {canCancel &&
          (r.status === 'DRAFT' || r.status === 'CALCULATED' || r.status === 'PENDING_APPROVAL') ? (
            <button
              className="text-[var(--erp-muted)]"
              disabled={actionMutation.isPending}
              onClick={() => {
                actionMutation.mutate({ id: r.id, action: 'cancel' });
              }}
            >
              Cancel
            </button>
          ) : null}
          <Link className="text-[var(--erp-accent)]" href={`/payroll/runs/${r.id}`}>
            Open
          </Link>
        </span>
      ),
    },
  ];

  const selectedCompany = form.companyId;
  const groupOptions = (payGroupsQuery.data ?? []).filter(
    (g) => !selectedCompany || g.companyId === selectedCompany,
  );

  return (
    <div>
      <PageHeader
        title="Payroll runs"
        description="Calculate, review, approve through the finance inbox, and post payroll periods."
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
              setForm({ ...form, companyId: e.target.value, payGroupId: '' });
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
            value={form.payGroupId}
            onChange={(e) => {
              setForm({ ...form, payGroupId: e.target.value });
            }}
            required
          >
            <option value="">Pay group…</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="date"
            value={form.periodStart}
            onChange={(e) => {
              setForm({ ...form, periodStart: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="date"
            value={form.periodEnd}
            onChange={(e) => {
              setForm({ ...form, periodEnd: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="date"
            value={form.paymentDate}
            onChange={(e) => {
              setForm({ ...form, paymentDate: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.payGroupId}
          >
            Create run
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
        caption="Payroll runs"
      />
    </div>
  );
}
