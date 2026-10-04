'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface FileRow {
  id: string;
  fileNo: string;
  title: string;
  category: string | null;
  locationCode: string | null;
  status: string;
  issuedToEmployeeId: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  notes: string | null;
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
  title: '',
  category: '',
  locationCode: '',
  notes: '',
};

/** Physical file room (PRD Stage 9; USER-FLOWS §18.3). */
export default function FilesPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('office.file_room.create');
  const canEdit = can('office.file_room.edit');

  const listQuery = useQuery({
    queryKey: ['office-files'],
    queryFn: () => api.get<{ rows: FileRow[]; total: number }>('/office/files?pageSize=100'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const employeesQuery = useQuery({
    queryKey: ['hr-employees-options'],
    queryFn: () =>
      api.get<{ rows: EmployeeOption[] }>('/hr/employees?pageSize=200').then((r) => r.rows),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['office-files'] });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/office/files', {
        companyId: payload.companyId,
        title: payload.title,
        ...(payload.category ? { category: payload.category } : {}),
        ...(payload.locationCode ? { locationCode: payload.locationCode } : {}),
        ...(payload.notes ? { notes: payload.notes } : {}),
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

  const issueMutation = useMutation({
    mutationFn: ({ id, issuedToEmployeeId }: { id: string; issuedToEmployeeId: string }) =>
      api.post(`/office/files/${id}/issue`, { issuedToEmployeeId }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Issue failed');
    },
  });

  const returnMutation = useMutation({
    mutationFn: (id: string) => api.post(`/office/files/${id}/return`, {}),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Return failed');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/office/files/${id}/archive`, {}),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Archive failed');
    },
  });

  const employeeName = (id: string | null): string => {
    if (!id) return '—';
    const match = (employeesQuery.data ?? []).find((e) => e.id === id);
    return match ? match.fullName : id.slice(0, 8);
  };

  const columns: Array<DataTableColumn<FileRow>> = [
    { key: 'fileNo', header: 'No', render: (r) => r.fileNo },
    { key: 'title', header: 'Title', render: (r) => r.title },
    { key: 'category', header: 'Category', render: (r) => r.category ?? '—' },
    { key: 'locationCode', header: 'Location', render: (r) => r.locationCode ?? '—' },
    {
      key: 'issuedToEmployeeId',
      header: 'With',
      render: (r) => employeeName(r.issuedToEmployeeId),
    },
    {
      key: 'issuedAt',
      header: 'Issued',
      render: (r) => (r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : '—'),
    },
    {
      key: 'dueAt',
      header: 'Due',
      render: (r) => (r.dueAt ? new Date(r.dueAt).toLocaleDateString() : '—'),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        canEdit ? (
          <span className="flex items-center gap-1">
            {r.status === 'AVAILABLE' ? (
              <select
                className="rounded border border-[var(--erp-border)] bg-[var(--erp-bg)] px-1 py-1 text-xs"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    issueMutation.mutate({ id: r.id, issuedToEmployeeId: e.target.value });
                  }
                }}
              >
                <option value="">Issue to…</option>
                {(employeesQuery.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            ) : null}
            {r.status === 'ISSUED' ? (
              <button
                type="button"
                className="rounded-md border border-[var(--erp-border)] px-2 py-1 text-xs font-medium disabled:opacity-50"
                disabled={returnMutation.isPending}
                onClick={() => {
                  returnMutation.mutate(r.id);
                }}
              >
                Return
              </button>
            ) : null}
            {r.status === 'AVAILABLE' ? (
              <button
                type="button"
                className="rounded-md border border-[var(--erp-border)] px-2 py-1 text-xs font-medium disabled:opacity-50"
                disabled={archiveMutation.isPending}
                onClick={() => {
                  archiveMutation.mutate(r.id);
                }}
              >
                Archive
              </button>
            ) : null}
          </span>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="File room"
        description="Physical file register with issue/return tracking (an audit trail of movements)."
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
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm md:col-span-2"
            placeholder="File title"
            value={form.title}
            onChange={(e) => {
              setForm({ ...form, title: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Category"
            value={form.category}
            onChange={(e) => {
              setForm({ ...form, category: e.target.value });
            }}
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Location e.g. CAB-A-01"
            value={form.locationCode}
            onChange={(e) => {
              setForm({ ...form, locationCode: e.target.value });
            }}
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => {
              setForm({ ...form, notes: e.target.value });
            }}
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.title}
          >
            Register file
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
        caption="File room"
      />
    </div>
  );
}
