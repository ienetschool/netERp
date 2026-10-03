'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface VisitorRow {
  id: string;
  visitorNo: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  hostEmployeeId: string | null;
  purpose: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

interface EmployeeOption {
  id: string;
  employeeNo: string;
  fullName: string;
}

const EMPTY_FORM = {
  companyId: '',
  name: '',
  companyName: '',
  phone: '',
  purpose: '',
};

/** Front desk visitor register (PRD Stage 9; USER-FLOWS §18.1). */
export default function VisitorsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('office.visitor.create');
  const canEdit = can('office.visitor.edit');

  const listQuery = useQuery({
    queryKey: ['office-visitors'],
    queryFn: () => api.get<{ rows: VisitorRow[]; total: number }>('/office/visitors?pageSize=100'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/admin/companies'),
  });

  const employeesQuery = useQuery({
    queryKey: ['hr-employees-options'],
    queryFn: () =>
      api.get<{ rows: EmployeeOption[] }>('/hr/employees?pageSize=200').then((r) => r.rows),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['office-visitors'] });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/office/visitors', {
        companyId: payload.companyId,
        name: payload.name,
        ...(payload.companyName ? { companyName: payload.companyName } : {}),
        ...(payload.phone ? { phone: payload.phone } : {}),
        ...(payload.purpose ? { purpose: payload.purpose } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Register failed');
    },
  });

  const checkInMutation = useMutation({
    mutationFn: (id: string) => api.post(`/office/visitors/${id}/check-in`, {}),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (id: string) => api.post(`/office/visitors/${id}/check-out`, {}),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Check-out failed');
    },
  });

  const employeeName = (id: string | null): string => {
    if (!id) return '—';
    const match = (employeesQuery.data ?? []).find((e) => e.id === id);
    return match ? `${match.fullName} (${match.employeeNo})` : id.slice(0, 8);
  };

  const columns: Array<DataTableColumn<VisitorRow>> = [
    { key: 'visitorNo', header: 'No', render: (r) => r.visitorNo },
    { key: 'name', header: 'Visitor', render: (r) => r.name },
    {
      key: 'companyName',
      header: 'Company',
      render: (r) => r.companyName ?? '—',
    },
    { key: 'host', header: 'Host', render: (r) => employeeName(r.hostEmployeeId) },
    { key: 'purpose', header: 'Purpose', render: (r) => r.purpose ?? '—' },
    {
      key: 'checkInAt',
      header: 'Checked in',
      render: (r) => (r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString() : '—'),
    },
    {
      key: 'checkOutAt',
      header: 'Checked out',
      render: (r) => (r.checkOutAt ? new Date(r.checkOutAt).toLocaleTimeString() : '—'),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        canEdit ? (
          <span className="flex gap-2">
            {r.status === 'EXPECTED' ? (
              <button
                type="button"
                className="rounded-md bg-[var(--erp-accent)] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                disabled={checkInMutation.isPending}
                onClick={() => {
                  checkInMutation.mutate(r.id);
                }}
              >
                Check in
              </button>
            ) : null}
            {r.status === 'CHECKED_IN' ? (
              <button
                type="button"
                className="rounded-md border border-[var(--erp-border)] px-2 py-1 text-xs font-medium disabled:opacity-50"
                disabled={checkOutMutation.isPending}
                onClick={() => {
                  checkOutMutation.mutate(r.id);
                }}
              >
                Check out
              </button>
            ) : null}
          </span>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Visitors"
        description="Front desk register: check in on arrival, check out on departure."
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
            {(companiesQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Visitor name"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Company (optional)"
            value={form.companyName}
            onChange={(e) => {
              setForm({ ...form, companyName: e.target.value });
            }}
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => {
              setForm({ ...form, phone: e.target.value });
            }}
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm md:col-span-2"
            placeholder="Purpose (optional)"
            value={form.purpose}
            onChange={(e) => {
              setForm({ ...form, purpose: e.target.value });
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.name}
          >
            Register visitor
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
        caption="Visitor register"
      />
    </div>
  );
}
