'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface CallRow {
  id: string;
  callerName: string;
  callerPhone: string | null;
  recipientEmployeeId: string | null;
  subject: string;
  notes: string | null;
  callTime: string;
  direction: string;
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
  callerName: '',
  callerPhone: '',
  recipientEmployeeId: '',
  subject: '',
  notes: '',
  direction: 'INBOUND',
};

/** Reception call log (PRD Stage 9). */
export default function CallsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('office.call.create');
  const canEdit = can('office.call.edit');

  const listQuery = useQuery({
    queryKey: ['office-calls'],
    queryFn: () => api.get<{ rows: CallRow[]; total: number }>('/office/calls?pageSize=100'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/companies'),
  });

  const employeesQuery = useQuery({
    queryKey: ['hr-employees-options'],
    queryFn: () =>
      api.get<{ rows: EmployeeOption[] }>('/hr/employees?pageSize=200').then((r) => r.rows),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['office-calls'] });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/office/calls', {
        companyId: payload.companyId,
        callerName: payload.callerName,
        ...(payload.callerPhone ? { callerPhone: payload.callerPhone } : {}),
        ...(payload.recipientEmployeeId
          ? { recipientEmployeeId: payload.recipientEmployeeId }
          : {}),
        subject: payload.subject,
        ...(payload.notes ? { notes: payload.notes } : {}),
        direction: payload.direction,
      }),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Log failed');
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/office/calls/${id}/complete`, {}),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Complete failed');
    },
  });

  const employeeName = (id: string | null): string => {
    if (!id) return '—';
    const match = (employeesQuery.data ?? []).find((e) => e.id === id);
    return match ? match.fullName : id.slice(0, 8);
  };

  const columns: Array<DataTableColumn<CallRow>> = [
    {
      key: 'callTime',
      header: 'Time',
      render: (r) => new Date(r.callTime).toLocaleString(),
    },
    {
      key: 'direction',
      header: 'Dir',
      render: (r) => (r.direction === 'INBOUND' ? '↘ In' : '↗ Out'),
    },
    { key: 'callerName', header: 'Caller', render: (r) => r.callerName },
    { key: 'callerPhone', header: 'Phone', render: (r) => r.callerPhone ?? '—' },
    {
      key: 'recipient',
      header: 'For',
      render: (r) => employeeName(r.recipientEmployeeId),
    },
    { key: 'subject', header: 'Subject', render: (r) => r.subject },
    { key: 'notes', header: 'Notes', render: (r) => r.notes ?? '—' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        canEdit && r.status === 'OPEN' ? (
          <button
            type="button"
            className="rounded-md border border-[var(--erp-border)] px-2 py-1 text-xs font-medium disabled:opacity-50"
            disabled={completeMutation.isPending}
            onClick={() => {
              completeMutation.mutate(r.id);
            }}
          >
            Complete
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="Calls" description="Reception call log for inbound and outbound calls." />
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
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.direction}
            onChange={(e) => {
              setForm({ ...form, direction: e.target.value });
            }}
          >
            <option value="INBOUND">Inbound</option>
            <option value="OUTBOUND">Outbound</option>
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Caller name"
            value={form.callerName}
            onChange={(e) => {
              setForm({ ...form, callerName: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Phone (optional)"
            value={form.callerPhone}
            onChange={(e) => {
              setForm({ ...form, callerPhone: e.target.value });
            }}
          />
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.recipientEmployeeId}
            onChange={(e) => {
              setForm({ ...form, recipientEmployeeId: e.target.value });
            }}
          >
            <option value="">For employee…</option>
            {(employeesQuery.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => {
              setForm({ ...form, subject: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm md:col-span-5"
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => {
              setForm({ ...form, notes: e.target.value });
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={
              createMutation.isPending || !form.companyId || !form.callerName || !form.subject
            }
          >
            Log call
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
        caption="Call log"
      />
    </div>
  );
}
