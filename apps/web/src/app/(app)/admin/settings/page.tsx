'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert } from '@erp/ui';

interface SettingRow {
  id: string;
  key: string;
  valueType: string;
  companyId: string | null;
  description: string | null;
  updatedAt: string;
}

const EMPTY_FORM = { key: '', value: '', valueType: 'string', description: '' };

/**
 * Settings administration (PRD Stage 2: Settings). Platform-level values only;
 * per-company overrides arrive with the organization vertical slices.
 */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canEdit = can('settings.configuration.edit') || can('settings.configuration.create');
  const canDelete = can('settings.configuration.delete');

  const listQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingRow[]>('/settings'),
  });

  const upsertMutation = useMutation({
    mutationFn: (payload: {
      key: string;
      value: unknown;
      valueType: string;
      description?: string;
    }) => api.post('/settings', payload),
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/${id}`),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Delete failed');
    },
  });

  const parseValue = (): unknown => {
    if (form.valueType === 'number') return Number(form.value);
    if (form.valueType === 'boolean') return form.value === 'true';
    if (form.valueType === 'json') {
      try {
        return JSON.parse(form.value || '{}');
      } catch {
        return NaN; // triggers validation error server-side via number coercion? no — see below
      }
    }
    return form.value;
  };

  const submit = () => {
    const value = parseValue();
    if (form.valueType === 'json' && Number.isNaN(value)) {
      setError('Invalid JSON');
      return;
    }
    upsertMutation.mutate({
      key: form.key.trim(),
      value,
      valueType: form.valueType,
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    });
  };

  const columns: Array<DataTableColumn<SettingRow>> = [
    { key: 'key', header: 'Key', render: (r) => r.key },
    { key: 'valueType', header: 'Type', render: (r) => r.valueType },
    {
      key: 'companyId',
      header: 'Level',
      render: (r) => (r.companyId ? 'Company' : 'Platform'),
    },
    { key: 'description', header: 'Description', render: (r) => r.description ?? '—' },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (r) => new Date(r.updatedAt).toLocaleString(),
    },
    ...(canDelete
      ? [
          {
            key: 'actions',
            header: '',
            render: (r: SettingRow) => (
              <button
                className="text-xs text-[var(--erp-danger,var(--erp-accent))]"
                onClick={() => {
                  deleteMutation.mutate(r.id);
                }}
              >
                Delete
              </button>
            ),
          } satisfies DataTableColumn<SettingRow>,
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Platform configuration values consumed by engines and modules."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canEdit ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm md:col-span-2"
            placeholder="key (e.g. approval.auto_approve_limit)"
            value={form.key}
            onChange={(e) => {
              setForm({ ...form, key: e.target.value });
            }}
            required
          />
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.valueType}
            onChange={(e) => {
              setForm({ ...form, valueType: e.target.value });
            }}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="json">json</option>
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder={form.valueType === 'json' ? '{"enabled": true}' : 'value'}
            value={form.value}
            onChange={(e) => {
              setForm({ ...form, value: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={upsertMutation.isPending || form.key.trim().length === 0}
          >
            Save setting
          </button>
        </form>
      ) : null}

      <DataTable
        columns={columns}
        rows={listQuery.data}
        loading={listQuery.isLoading}
        error={listQuery.error}
        getRowKey={(r) => r.id}
        caption="Platform settings"
      />
    </div>
  );
}
