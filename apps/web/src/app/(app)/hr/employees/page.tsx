'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface EmployeeRow {
  id: string;
  employeeNo: string;
  displayName: string;
  jobTitle: string | null;
  employmentStatus: string;
  hireDate: string;
  email: string | null;
}

const EMPTY_FORM = {
  companyId: '',
  employeeNo: '',
  firstName: '',
  lastName: '',
  jobTitle: '',
  hireDate: '',
  email: '',
};

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

/** Employees administration (PRD Stage 3: Employees). */
export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('hr.employee.create');

  const listQuery = useQuery({
    queryKey: ['hr-employees'],
    queryFn: () =>
      api.get<{ rows: EmployeeRow[]; total: number }>('/hr/employees?page=1&pageSize=50'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/hr/employees', {
        ...payload,
        jobTitle: payload.jobTitle || undefined,
        email: payload.email || undefined,
      }),
    onSuccess: () => {
      setError(null);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<EmployeeRow>> = [
    { key: 'employeeNo', header: 'No', render: (r) => r.employeeNo },
    { key: 'displayName', header: 'Name', render: (r) => r.displayName },
    { key: 'jobTitle', header: 'Title', render: (r) => r.jobTitle ?? '—' },
    {
      key: 'employmentStatus',
      header: 'Status',
      render: (r) => <StatusBadge status={r.employmentStatus} />,
    },
    {
      key: 'hireDate',
      header: 'Hired',
      render: (r) => new Date(r.hireDate).toLocaleDateString(),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Workforce records, employment status and org placement."
        actions={
          canCreate ? (
            <button
              className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white"
              onClick={() => {
                setShowCreate((v) => !v);
              }}
            >
              {showCreate ? 'Close' : 'New employee'}
            </button>
          ) : undefined
        }
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {showCreate && canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-3"
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
            placeholder="Employee no (e.g. E-0010)"
            value={form.employeeNo}
            onChange={(e) => {
              setForm({ ...form, employeeNo: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="First name"
            value={form.firstName}
            onChange={(e) => {
              setForm({ ...form, firstName: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Last name"
            value={form.lastName}
            onChange={(e) => {
              setForm({ ...form, lastName: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Job title"
            value={form.jobTitle}
            onChange={(e) => {
              setForm({ ...form, jobTitle: e.target.value });
            }}
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Hire date"
            type="date"
            value={form.hireDate}
            onChange={(e) => {
              setForm({ ...form, hireDate: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(e) => {
              setForm({ ...form, email: e.target.value });
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50 md:col-span-3"
            disabled={createMutation.isPending}
          >
            Create employee
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
        caption="Employees"
      />
    </div>
  );
}
