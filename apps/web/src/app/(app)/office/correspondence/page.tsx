'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface CorrespondenceRow {
  id: string;
  correspondenceNo: string;
  direction: string;
  correspondenceType: string;
  sender: string;
  recipient: string;
  subject: string;
  receivedAt: string | null;
  sentAt: string | null;
  assignedTo: string | null;
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
  direction: 'INCOMING',
  correspondenceType: 'LETTER',
  sender: '',
  recipient: '',
  subject: '',
};

/** Correspondence register (PRD Stage 9; USER-FLOWS §18.2). */
export default function CorrespondencePage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('office.correspondence.create');
  const canEdit = can('office.correspondence.edit');

  const listQuery = useQuery({
    queryKey: ['office-correspondence'],
    queryFn: () =>
      api.get<{ rows: CorrespondenceRow[]; total: number }>('/office/correspondence?pageSize=100'),
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

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['office-correspondence'] });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/office/correspondence', {
        companyId: payload.companyId,
        direction: payload.direction,
        correspondenceType: payload.correspondenceType,
        sender: payload.sender,
        recipient: payload.recipient,
        subject: payload.subject,
        ...(payload.direction === 'INCOMING'
          ? { receivedAt: new Date().toISOString() }
          : { sentAt: new Date().toISOString() }),
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

  const assignMutation = useMutation({
    mutationFn: ({ id, assignedTo }: { id: string; assignedTo: string }) =>
      api.post(`/office/correspondence/${id}/assign`, { assignedTo }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Assign failed');
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/office/correspondence/${id}/close`, {}),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Close failed');
    },
  });

  const employeeName = (id: string | null): string => {
    if (!id) return '—';
    const match = (employeesQuery.data ?? []).find((e) => e.id === id);
    return match ? match.fullName : id.slice(0, 8);
  };

  const columns: Array<DataTableColumn<CorrespondenceRow>> = [
    { key: 'correspondenceNo', header: 'No', render: (r) => r.correspondenceNo },
    {
      key: 'direction',
      header: 'Dir',
      render: (r) =>
        r.direction === 'INCOMING' ? '↘ In' : r.direction === 'OUTGOING' ? '↗ Out' : '⇄ Internal',
    },
    { key: 'correspondenceType', header: 'Type', render: (r) => r.correspondenceType },
    { key: 'sender', header: 'Sender', render: (r) => r.sender },
    { key: 'recipient', header: 'Recipient', render: (r) => r.recipient },
    { key: 'subject', header: 'Subject', render: (r) => r.subject },
    {
      key: 'assignedTo',
      header: 'Assigned',
      render: (r) => employeeName(r.assignedTo),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        canEdit && r.status !== 'CLOSED' ? (
          <span className="flex items-center gap-1">
            <select
              className="rounded border border-[var(--erp-border)] bg-[var(--erp-bg)] px-1 py-1 text-xs"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  assignMutation.mutate({ id: r.id, assignedTo: e.target.value });
                }
              }}
            >
              <option value="">Assign…</option>
              {(employeesQuery.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md border border-[var(--erp-border)] px-2 py-1 text-xs font-medium disabled:opacity-50"
              disabled={closeMutation.isPending}
              onClick={() => {
                closeMutation.mutate(r.id);
              }}
            >
              Close
            </button>
          </span>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Correspondence"
        description="Incoming and outgoing mail register; assign and track to closure."
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
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.direction}
            onChange={(e) => {
              setForm({ ...form, direction: e.target.value });
            }}
          >
            <option value="INCOMING">Incoming</option>
            <option value="OUTGOING">Outgoing</option>
            <option value="INTERNAL">Internal</option>
          </select>
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.correspondenceType}
            onChange={(e) => {
              setForm({ ...form, correspondenceType: e.target.value });
            }}
          >
            <option value="LETTER">Letter</option>
            <option value="EMAIL">Email</option>
            <option value="FAX">Fax</option>
            <option value="PARCEL">Parcel</option>
            <option value="OTHER">Other</option>
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Sender"
            value={form.sender}
            onChange={(e) => {
              setForm({ ...form, sender: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Recipient"
            value={form.recipient}
            onChange={(e) => {
              setForm({ ...form, recipient: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => {
              setForm({ ...form, subject: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.subject}
          >
            Register
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
        caption="Correspondence register"
      />
    </div>
  );
}
