'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { DocExport } from '@/components/DocExport';
import { DocumentSheet, type DocumentModel } from '@/components/DocumentSheet';
import { PrintPreview } from '@/components/PrintPreview';
import { downloadModel, modelBase, modelShareText, modelTotal } from '@/lib/document';
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

interface JournalLineDetail {
  id: string;
  lineNo: number;
  description: string | null;
  debit: string;
  credit: string;
  account: { accountCode: string; accountName: string };
}

interface JournalDetail {
  id: string;
  companyId: string;
  journalNo: string;
  journalType: string;
  journalDate: string;
  description: string | null;
  status: string;
  postedAt: string | null;
  sourceDocumentNo: string | null;
  lines: JournalLineDetail[];
  financialPeriod: { fiscalYear: number; periodNo: number; status: string } | null;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);

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
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
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

  const companyName = detail
    ? (companiesQuery.data?.rows.find((c) => c.id === detail.companyId)?.name ?? '')
    : '';

  const amount = (value: string | number) =>
    Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  /** Flat document model shared by the print preview and the file exports. */
  const documentModel = (journal: JournalDetail): DocumentModel => {
    const debit = journal.lines.reduce((acc, l) => acc + Number(l.debit), 0);
    const credit = journal.lines.reduce((acc, l) => acc + Number(l.credit), 0);
    return {
      companyName,
      docType: 'Journal Entry',
      docNo: journal.journalNo,
      status: journal.status,
      partyLabel: 'Journal type',
      partyName: journal.journalType,
      partyMeta: journal.description ? [journal.description] : [],
      facts: [
        { label: 'Journal date', value: new Date(journal.journalDate).toLocaleDateString() },
        { label: 'Lines', value: String(journal.lines.length) },
        {
          label: 'Period',
          value: journal.financialPeriod
            ? `FY ${journal.financialPeriod.fiscalYear} · P${journal.financialPeriod.periodNo}`
            : '—',
        },
      ],
      columns: ['Account', 'Description', 'Debit', 'Credit'],
      lines: journal.lines.map((line) => ({
        id: line.id,
        cells: [
          `${line.account.accountCode} — ${line.account.accountName}`,
          line.description ?? '',
          line.debit === '0' ? '' : amount(line.debit),
          line.credit === '0' ? '' : amount(line.credit),
        ],
      })),
      totals: [
        { label: 'Total debits', value: amount(debit), emphasis: true },
        { label: 'Total credits', value: amount(credit) },
      ],
    };
  };

  /** Loads the full journal (header + lines) before opening the export dialog. */
  const openDocument = async (id: string) => {
    setError(null);
    setNotice(null);
    setLoadingDoc(true);
    try {
      const journal = await api.get<JournalDetail>(`/accounting/journals/${id}`);
      setDetail(journal);
      setExportOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the journal');
    } finally {
      setLoadingDoc(false);
    }
  };

  const onDownload = (format: string) => {
    if (!detail) return;
    const model = documentModel(detail);
    if (
      !downloadModel(
        model,
        format as 'PDF' | 'EXCEL' | 'CSV',
        modelBase('journal', detail.journalNo),
      )
    ) {
      // PDF is produced by the browser's print dialog, so hand off to the preview.
      setExportOpen(false);
      setPreviewOpen(true);
      return;
    }
    setNotice(`Exported ${detail.journalNo} as ${format === 'EXCEL' ? 'Excel' : format}.`);
  };

  const onShare = async () => {
    if (!detail) return;
    const text = modelShareText(documentModel(detail));
    // Not every browser exposes the Share API, and the DOM types mark it as
    // required — read it as optional so the clipboard fallback stays reachable.
    const nav = navigator as unknown as {
      share?: (data: ShareData) => Promise<void>;
    };
    try {
      if (nav.share) {
        await nav.share({ title: `Journal ${detail.journalNo}`, text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Journal summary copied to the clipboard.');
      }
      setExportOpen(false);
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

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
  ];

  return (
    <div>
      <PageHeader
        title="Journals"
        description="Manual journals with posting gate: open period, debits = credits, postable accounts."
      />
      {error || notice || loadingDoc ? (
        <div className="mb-4 space-y-2">
          {error ? (
            <Alert tone="error" title="Error">
              {error}
            </Alert>
          ) : null}
          {notice ? (
            <Alert tone="success" title="Done">
              {notice}
            </Alert>
          ) : null}
          {loadingDoc ? (
            <Alert tone="info" title="Loading journal">
              Fetching the journal for preview…
            </Alert>
          ) : null}
        </div>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 space-y-3 rounded-lg border border-[var(--erp-border)] erp-frost p-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <select
              className="erp-select"
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
              className="erp-input"
              type="date"
              value={form.journalDate}
              onChange={(e) => {
                setForm({ ...form, journalDate: e.target.value });
              }}
              required
            />
            <select
              className="erp-select"
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
              className="erp-input"
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
                  className="erp-select md:col-span-2"
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
                  className="erp-input"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, description: e.target.value };
                    setForm({ ...form, lines });
                  }}
                />
                <input
                  className="erp-input"
                  placeholder="Debit e.g. 100.00"
                  value={line.debit}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, debit: e.target.value, credit: '0' };
                    setForm({ ...form, lines });
                  }}
                />
                <input
                  className="erp-input"
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
        rowActions={(r) => [
          {
            label: 'Print / Export',
            icon: 'documentExport',
            onSelect: () => void openDocument(r.id),
          },
          ...(canSubmit && r.status === 'DRAFT'
            ? [
                {
                  label: 'Submit for approval',
                  icon: 'check' as const,
                  onSelect: () => {
                    submitMutation.mutate(r.id);
                  },
                },
              ]
            : []),
          ...(canPost && ['DRAFT', 'APPROVED'].includes(r.status)
            ? [
                {
                  label: 'Post journal',
                  icon: 'check-square' as const,
                  onSelect: () => {
                    postMutation.mutate(r.id);
                  },
                },
              ]
            : []),
          ...(canReverse && r.status === 'POSTED'
            ? [
                {
                  label: 'Reverse journal',
                  icon: 'refresh' as const,
                  tone: 'danger' as const,
                  onSelect: () => {
                    reverseMutation.mutate(r.id);
                  },
                },
              ]
            : []),
        ]}
      />

      <DocExport
        open={exportOpen && detail !== null}
        onClose={() => {
          setExportOpen(false);
        }}
        documentKind="Journal Entry"
        documentTitle={detail ? `${detail.journalNo} · ${detail.journalType}` : ''}
        companyName={companyName}
        preview={
          detail
            ? {
                documentNo: detail.journalNo,
                partyName: detail.journalType,
                total: modelTotal(documentModel(detail)),
                meta: [
                  `Journal date ${new Date(detail.journalDate).toLocaleDateString()}`,
                  `${detail.lines.length} lines`,
                ],
                lineCount: detail.lines.length,
              }
            : undefined
        }
        onPreview={() => {
          setExportOpen(false);
          setPreviewOpen(true);
        }}
        onDownload={onDownload}
        onShare={() => void onShare()}
      />

      <PrintPreview
        open={previewOpen}
        title={detail ? `Journal ${detail.journalNo}` : 'Journal entry'}
        onClose={() => {
          setPreviewOpen(false);
        }}
      >
        {detail ? <DocumentSheet model={documentModel(detail)} /> : null}
      </PrintPreview>
    </div>
  );
}
