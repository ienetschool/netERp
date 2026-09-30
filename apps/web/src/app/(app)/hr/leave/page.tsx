'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface LeaveRequestRow {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  requestedDays: string;
  reason: string | null;
  employee: { employeeNo: string; displayName: string };
  leaveType: { code: string; name: string };
}

interface EmployeeOption {
  id: string;
  employeeNo: string;
  displayName: string;
}

interface LeaveTypeOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  employeeId: '',
  leaveTypeId: '',
  startDate: '',
  endDate: '',
  requestedDays: '1',
  reason: '',
};

/** Leave requests (PRD Stage 3: Leave). Create, submit; approval flows via the workflow inbox. */
export default function LeavePage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('hr.leave.create');
  const canSubmit = can('hr.leave.submit');

  const listQuery = useQuery({
    queryKey: ['hr-leave'],
    queryFn: () =>
      api.get<{ rows: LeaveRequestRow[]; total: number }>('/hr/leave-requests?page=1&pageSize=50'),
  });

  const employeesQuery = useQuery({
    queryKey: ['hr-employees-options'],
    queryFn: () => api.get<{ rows: EmployeeOption[] }>('/hr/employees?page=1&pageSize=200'),
  });

  const typesQuery = useQuery({
    queryKey: ['hr-leave-types'],
    queryFn: () => api.get<LeaveTypeOption[]>('/hr/leave-types'),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['hr-leave'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/hr/leave-requests', {
        employeeId: payload.employeeId,
        leaveTypeId: payload.leaveTypeId,
        startDate: payload.startDate,
        endDate: payload.endDate,
        requestedDays: Number(payload.requestedDays),
        reason: payload.reason || undefined,
      }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/hr/leave-requests/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const columns: Array<DataTableColumn<LeaveRequestRow>> = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => `${r.employee.displayName} (${r.employee.employeeNo})`,
    },
    { key: 'leaveType', header: 'Type', render: (r) => r.leaveType.name },
    {
      key: 'dates',
      header: 'Dates',
      render: (r) =>
        `${new Date(r.startDate).toLocaleDateString()} – ${new Date(r.endDate).toLocaleDateString()}`,
    },
    { key: 'requestedDays', header: 'Days', render: (r) => r.requestedDays },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
    ...(canSubmit
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: LeaveRequestRow) =>
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
          } satisfies DataTableColumn<LeaveRequestRow>,
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Leave"
        description="Leave requests; submitted requests route to the approval inbox."
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
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm md:col-span-2"
            value={form.employeeId}
            onChange={(e) => {
              setForm({ ...form, employeeId: e.target.value });
            }}
            required
          >
            <option value="">Employee…</option>
            {(employeesQuery.data?.rows ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName} ({e.employeeNo})
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.leaveTypeId}
            onChange={(e) => {
              setForm({ ...form, leaveTypeId: e.target.value });
            }}
            required
          >
            <option value="">Type…</option>
            {(typesQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="date"
            value={form.startDate}
            onChange={(e) => {
              setForm({ ...form, startDate: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="date"
            value={form.endDate}
            onChange={(e) => {
              setForm({ ...form, endDate: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="number"
            min="0.5"
            step="0.5"
            placeholder="Days"
            value={form.requestedDays}
            onChange={(e) => {
              setForm({ ...form, requestedDays: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50 md:col-span-6"
            disabled={createMutation.isPending || !form.employeeId || !form.leaveTypeId}
          >
            Create leave request
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
        caption="Leave requests"
      />
    </div>
  );
}
