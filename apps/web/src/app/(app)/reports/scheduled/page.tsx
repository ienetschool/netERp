'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface DefinitionOption {
  id: string;
  code: string;
  name: string;
  module: string;
}

interface ScheduledRow {
  id: string;
  reportDefinitionId: string;
  companyId: string | null;
  schedule: string;
  timezone: string;
  filters: Record<string, string>;
  outputFormat: string;
  deliveryChannel: string;
  recipientConfiguration: Record<string, string>;
  status: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastDeliveryStatus: string | null;
  lastDeliveredAt: string | null;
  createdAt: string;
  definition: { code: string; name: string; module: string };
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  reportDefinitionId: '',
  frequency: 'WEEKLY' as 'DAILY' | 'WEEKLY' | 'MONTHLY',
  time: '07:00',
  dayOfWeek: '1',
  dayOfMonth: '1',
  timezone: 'UTC',
  companyId: '',
  outputFormat: 'CSV' as 'CSV' | 'JSON',
  deliveryChannel: 'IN_APP' as 'IN_APP' | 'EMAIL',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Scheduled reports (PRD Stage 11; USER-FLOWS §21.3). */
export default function ScheduledReportsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showCreate, setShowCreate] = useState(false);

  const canCreate = can('reporting.report.create');
  const canEdit = can('reporting.report.edit');
  const canDelete = can('reporting.report.delete');

  const definitionsQuery = useQuery({
    queryKey: ['report-definitions'],
    queryFn: () => api.get<{ rows: DefinitionOption[]; total: number }>('/reports/definitions'),
  });
  const definitions = definitionsQuery.data?.rows ?? [];

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const listQuery = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => api.get<{ rows: ScheduledRow[]; total: number }>('/reports/scheduled'),
  });

  // Default the picker to the first permitted report once the list arrives.
  useEffect(() => {
    if (!form.reportDefinitionId && definitions.length > 0) {
      setForm((f) => ({ ...f, reportDefinitionId: definitions[0]?.id ?? '' }));
    }
  }, [definitions, form.reportDefinitionId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['report-schedules'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/reports/scheduled', {
        reportDefinitionId: form.reportDefinitionId,
        schedule: {
          frequency: form.frequency,
          time: form.time,
          ...(form.frequency === 'WEEKLY' ? { dayOfWeek: Number(form.dayOfWeek) } : {}),
          ...(form.frequency === 'MONTHLY' ? { dayOfMonth: Number(form.dayOfMonth) } : {}),
        },
        timezone: form.timezone,
        filters: form.companyId ? { companyId: form.companyId } : {},
        outputFormat: form.outputFormat,
        deliveryChannel: form.deliveryChannel,
      }),
    onSuccess: () => {
      setError(null);
      setShowCreate(false);
      setForm({ ...EMPTY_FORM });
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Creating the schedule failed');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/reports/scheduled/${id}/status`, { status }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Updating the schedule failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/scheduled/${id}`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Deleting the schedule failed');
    },
  });

  const describeSchedule = (row: ScheduledRow): string => {
    try {
      const spec = JSON.parse(row.schedule) as {
        frequency: string;
        time: string;
        dayOfWeek?: number;
        dayOfMonth?: number;
      };
      const when =
        spec.frequency === 'DAILY'
          ? 'every day'
          : spec.frequency === 'WEEKLY'
            ? `every ${WEEKDAYS[spec.dayOfWeek ?? 0]}`
            : `on day ${spec.dayOfMonth ?? 1} of each month`;
      return `${when} at ${spec.time} (${row.timezone})`;
    } catch {
      return 'Unreadable schedule';
    }
  };

  return (
    <div>
      <PageHeader
        title="Scheduled Reports"
        description="Recurring report runs. The worker polls due schedules, produces the artefact and delivers it; EMAIL delivery needs a configured provider."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <a
          href="/reports"
          className="rounded-md border border-[var(--erp-border)] px-3 py-2 text-sm font-medium"
        >
          Back to reports
        </a>
        {canCreate ? (
          <button
            type="button"
            className="rounded-md border border-[var(--erp-border)] px-3 py-2 text-sm font-medium"
            onClick={() => {
              setShowCreate((v) => !v);
            }}
          >
            {showCreate ? 'Cancel' : 'New schedule'}
          </button>
        ) : null}
      </div>

      {showCreate && canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className="text-xs text-[var(--erp-muted)] md:col-span-2">
            Report
            <select
              className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.reportDefinitionId}
              onChange={(e) => {
                setForm({ ...form, reportDefinitionId: e.target.value });
              }}
              required
            >
              <option value="">Select a report…</option>
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.module})
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--erp-muted)]">
            Company
            <select
              className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.companyId}
              onChange={(e) => {
                setForm({ ...form, companyId: e.target.value });
              }}
            >
              <option value="">All in my scope</option>
              {(companiesQuery.data?.rows ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--erp-muted)]">
            Frequency
            <select
              className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.frequency}
              onChange={(e) => {
                setForm({ ...form, frequency: e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY' });
              }}
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>

          {form.frequency === 'WEEKLY' ? (
            <label className="text-xs text-[var(--erp-muted)]">
              Day
              <select
                className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                value={form.dayOfWeek}
                onChange={(e) => {
                  setForm({ ...form, dayOfWeek: e.target.value });
                }}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {form.frequency === 'MONTHLY' ? (
            <label className="text-xs text-[var(--erp-muted)]">
              Day of month
              <input
                type="number"
                min={1}
                max={31}
                className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                value={form.dayOfMonth}
                onChange={(e) => {
                  setForm({ ...form, dayOfMonth: e.target.value });
                }}
              />
            </label>
          ) : null}

          <label className="text-xs text-[var(--erp-muted)]">
            Time
            <input
              type="time"
              className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.time}
              onChange={(e) => {
                setForm({ ...form, time: e.target.value });
              }}
              required
            />
          </label>

          <label className="text-xs text-[var(--erp-muted)]">
            Time zone
            <select
              className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.timezone}
              onChange={(e) => {
                setForm({ ...form, timezone: e.target.value });
              }}
            >
              {[
                'UTC',
                'America/New_York',
                'America/Los_Angeles',
                'Europe/London',
                'Asia/Dubai',
                'Asia/Kolkata',
              ].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--erp-muted)]">
            Format
            <select
              className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.outputFormat}
              onChange={(e) => {
                setForm({ ...form, outputFormat: e.target.value as 'CSV' | 'JSON' });
              }}
            >
              <option value="CSV">CSV</option>
              <option value="JSON">JSON</option>
            </select>
          </label>

          <label className="text-xs text-[var(--erp-muted)]">
            Delivery
            <select
              className="mt-1 w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.deliveryChannel}
              onChange={(e) => {
                setForm({ ...form, deliveryChannel: e.target.value as 'IN_APP' | 'EMAIL' });
              }}
            >
              <option value="IN_APP">In-app</option>
              <option value="EMAIL">Email (provider required)</option>
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={createMutation.isPending || !form.reportDefinitionId}
            >
              Create
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
        {listQuery.isLoading ? (
          <p className="p-4 text-sm">Loading…</p>
        ) : listQuery.error ? (
          <p className="p-4 text-sm text-red-600">
            {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load'}
          </p>
        ) : (listQuery.data?.rows ?? []).length === 0 ? (
          <p className="p-4 text-sm text-[var(--erp-muted)]">
            No scheduled reports yet. Create one to have the worker run it automatically.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b border-[var(--erp-border)] text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">Delivery</th>
                <th className="px-3 py-2 font-medium">Next run</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(listQuery.data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-b border-[var(--erp-border)] last:border-b-0">
                  <td className="px-3 py-2">{row.definition.name}</td>
                  <td className="px-3 py-2 text-xs text-[var(--erp-muted)]">
                    {describeSchedule(row)}
                  </td>
                  <td className="px-3 py-2">{row.deliveryChannel}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {new Date(row.nextRunAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : '—'}
                    {row.lastDeliveryStatus ? (
                      <span className="ml-1">
                        <StatusBadge status={row.lastDeliveryStatus} />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {canEdit && row.status !== 'DISABLED' ? (
                        <button
                          type="button"
                          className="text-xs hover:underline"
                          onClick={() => {
                            statusMutation.mutate({
                              id: row.id,
                              status: row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                            });
                          }}
                        >
                          {row.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => {
                            deleteMutation.mutate(row.id);
                          }}
                        >
                          Delete
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
