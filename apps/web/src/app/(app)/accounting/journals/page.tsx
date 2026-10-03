'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface JournalRow {
  id: string;
  journalNo: string;
  journalType: string;
  journalDate: string;
  description: string | null;
  status: string;
  lines: Array<{ debit: string; credit: string }>;
}

interface AccountOption {
  id: string;
  accountCode: string;
  accountName: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_LINE = { accountId: '', description: '', debit: '0', credit: '0' };
const EMPTY_FORM = {
  companyId: '',
  journalDate: new Date().toISOString().slice(0, 10),
  journalType: 'GENERAL',
  description: '',
  lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
};

/** Journals (PRD Stage 8): manual entries with approval, posting, reversal. */
export default function JournalsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const canCreate = can('accounting.journal.create');
  const canSubmit = can('accounting.journal.submit');
  const canPost = can('accounting.journal.post');
  const canReverse = can('accounting.journal.reverse');

  const listQuery = useQuery({
    queryKey: ['accounting-journals'],
    queryFn: () =>
      api.get<{ rows: JournalRow[]; total: number }>('/accounting/journals?page=1&pageSize=50'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/companies'),
  });

  const accountsQuery = useQuery({
    queryKey: ['accounting-accounts-all'],
    queryFn: () =>
      api.get<{ rows: AccountOption[]; total: number }>('/accounting/accounts?pageSize=200'),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['accounting-journals'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/accounting/journals', {
        companyId: payload.companyId,
        journalDate: payload.journalDate,
        journalType: payload.journalType,
        description: payload.description || undefined,
        lines: payload.lines
          .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l) => ({
            accountId: l.accountId,
            ...(l.description ? { description: l.description } : {}),
            ...(Number(l.debit) > 0 ? { debit: l.debit } : {}),
            ...(Number(l.credit) > 0 ? { credit: l.credit } : {}),
          })),
      }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/accounting/journals/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => api.post(`/accounting/journals/${id}/post`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Post failed');
    },
  });

  const reverseMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/accounting/journals/${id}/reverse`, { reason: 'Reversed from journals page' }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Reverse failed');
    },
  });

  const totalDebit = form.lines.reduce((acc, l) => acc + Number(l.debit || 0), 0);
  const totalCredit = form.lines.reduce((acc, l) => acc + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const columns: Array<DataTableColumn<JournalRow>> = [
    { key: 'journalNo', header: 'Journal No', render: (r) => r.journalNo },
    { key: 'journalType', header: 'Type', render: (r) => r.journalType },
    {
      key: 'journalDate',
      header: 'Date',
      render: (r) => new Date(r.journalDate).toLocaleDateString(),
    },
    { key: 'description', header: 'Description', render: (r) => r.description ?? '—' },
    {
      key: 'total',
      header: 'Total',
      render: (r) => r.lines.reduce((acc, l) => acc + Number(l.debit), 0).toFixed(2),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <span className="flex gap-2">
          {canSubmit && r.status === 'DRAFT' ? (
            <button
              className="text-xs text-[var(--erp-accent)]"
              onClick={() => {
                submitMutation.mutate(r.id);
              }}
            >
              Submit
            </button>
          ) : null}
          {canPost && ['DRAFT', 'APPROVED'].includes(r.status) ? (
            <button
              className="text-xs text-[var(--erp-accent)]"
              onClick={() => {
                postMutation.mutate(r.id);
              }}
            >
              Post
            </button>
          ) : null}
          {canReverse && r.status === 'POSTED' ? (
            <button
              className="text-xs text-[var(--erp-danger, #ef4444)]"
              onClick={() => {
                reverseMutation.mutate(r.id);
              }}
            >
              Reverse
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Journals"
        description="Manual journals with posting gate: open period, debits = credits, postable accounts."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 space-y-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <div className="grid gap-3 md:grid-cols-4">
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
              type="date"
              value={form.journalDate}
              onChange={(e) => {
                setForm({ ...form, journalDate: e.target.value });
              }}
              required
            />
            <select
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.journalType}
              onChange={(e) => {
                setForm({ ...form, journalType: e.target.value });
              }}
            >
              <option value="GENERAL">General</option>
              <option value="SALES">Sales</option>
              <option value="PURCHASE">Purchase</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
              <option value="PAYROLL">Payroll</option>
              <option value="INVENTORY">Inventory</option>
              <option value="TAX">Tax</option>
              <option value="ADJUSTMENT">Adjustment</option>
            </select>
            <input
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => {
                setForm({ ...form, description: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            {form.lines.map((line, i) => (
              <div key={i} className="grid items-center gap-2 md:grid-cols-5">
                <select
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs md:col-span-2"
                  value={line.accountId}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, accountId: e.target.value };
                    setForm({ ...form, lines });
                  }}
                >
                  <option value="">Account…</option>
                  {(accountsQuery.data?.rows ?? [])
                    .filter((a) => a.accountCode !== '1000' && a.accountCode !== '2000')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} — {a.accountName}
                      </option>
                    ))}
                </select>
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, description: e.target.value };
                    setForm({ ...form, lines });
                  }}
                />
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  placeholder="Debit e.g. 100.00"
                  value={line.debit}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, debit: e.target.value, credit: '0' };
                    setForm({ ...form, lines });
                  }}
                />
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  placeholder="Credit e.g. 100.00"
                  value={line.credit}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, credit: e.target.value, debit: '0' };
                    setForm({ ...form, lines });
                  }}
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-xs"
                onClick={() => {
                  setForm({ ...form, lines: [...form.lines, { ...EMPTY_LINE }] });
                }}
              >
                Add line
              </button>
              <span className={`text-xs ${balanced ? 'text-emerald-400' : 'text-red-400'}`}>
                Debits {totalDebit.toFixed(2)} / Credits {totalCredit.toFixed(2)}
                {balanced ? ' — balanced' : ' — unbalanced'}
              </span>
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !balanced}
          >
            Create journal
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
        caption="Journals"
      />
    </div>
  );
}
