'use client';

import { useRouter } from 'next/navigation';
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

interface PayrollRunRow {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  employeeCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalEmployerCost: string;
  payGroup: { name: string; frequency: string };
  currency: { code: string };
  _count: { entries: number };
}

interface PayrollEntry {
  id: string;
  grossAmount: string;
  deductionAmount: string;
  netAmount: string;
  employerCost: string;
  employee: { employeeNo: string; displayName: string };
}

interface PayrollRunDetail {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  status: string;
  employeeCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalEmployerCost: string;
  payGroup: { name: string; frequency: string };
  currency: { code: string };
  entries: PayrollEntry[];
}

interface PayGroupOption {
  id: string;
  name: string;
  companyId: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  payGroupId: '',
  periodStart: '',
  periodEnd: '',
  paymentDate: '',
};

function firstOfMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function lastOfMonth(): string {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

/** Payroll runs (PRD Stage 4): create, calculate, submit for approval. */
export default function PayrollRunsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayrollRunDetail | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    periodStart: firstOfMonth(),
    periodEnd: lastOfMonth(),
    paymentDate: lastOfMonth(),
  });

  const canCreate = can('payroll.payroll_run.create');
  const canCalculate = can('payroll.payroll_run.edit');
  const canSubmit = can('payroll.payroll_run.submit');
  const canCancel = can('payroll.payroll_run.cancel');

  const listQuery = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () =>
      api.get<{ rows: PayrollRunRow[]; total: number }>('/payroll/runs?page=1&pageSize=50'),
  });

  const payGroupsQuery = useQuery({
    queryKey: ['payroll-pay-groups'],
    queryFn: () => api.get<Array<PayGroupOption & { companyId: string }>>('/payroll/pay-groups'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const invalidate = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/payroll/runs', {
        companyId: payload.companyId,
        payGroupId: payload.payGroupId,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        paymentDate: payload.paymentDate,
      }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'calculate' | 'submit' | 'cancel' }) =>
      api.post(`/payroll/runs/${id}/${action}`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Action failed');
    },
  });

  const columns: Array<DataTableColumn<PayrollRunRow>> = [
    {
      key: 'period',
      header: 'Period',
      render: (r) =>
        `${new Date(r.periodStart).toLocaleDateString()} – ${new Date(r.periodEnd).toLocaleDateString()}`,
    },
    { key: 'payGroup', header: 'Pay group', render: (r) => r.payGroup.name },
    { key: 'currency', header: 'CCY', render: (r) => r.currency.code },
    { key: 'employees', header: 'Employees', render: (r) => String(r.employeeCount) },
    { key: 'totalGross', header: 'Gross', render: (r) => r.totalGross },
    { key: 'totalDeductions', header: 'Deductions', render: (r) => r.totalDeductions },
    { key: 'totalNet', header: 'Net', render: (r) => r.totalNet },
    { key: 'totalEmployerCost', header: 'Employer cost', render: (r) => r.totalEmployerCost },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const selectedCompany = form.companyId;
  const groupOptions = (payGroupsQuery.data ?? []).filter(
    (g) => !selectedCompany || g.companyId === selectedCompany,
  );

  const companyName = detail
    ? (companiesQuery.data?.rows.find((c) => c.id === detail.companyId)?.name ?? '')
    : '';

  const amount = (value: string | number) =>
    Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  /** Flat document model shared by the print preview and the file exports. */
  const documentModel = (run: PayrollRunDetail): DocumentModel => ({
    companyName,
    docType: 'Payroll Register',
    docNo: `PAY-${run.periodStart.slice(0, 7)}`,
    status: run.status,
    partyLabel: 'Pay group',
    partyName: run.payGroup.name,
    partyMeta: [`Frequency ${run.payGroup.frequency}`, `Currency ${run.currency.code}`],
    facts: [
      {
        label: 'Period',
        value: `${new Date(run.periodStart).toLocaleDateString()} – ${new Date(
          run.periodEnd,
        ).toLocaleDateString()}`,
      },
      { label: 'Payment date', value: new Date(run.paymentDate).toLocaleDateString() },
      { label: 'Employees', value: String(run.employeeCount) },
    ],
    columns: ['Employee', 'Gross', 'Deductions', 'Net', 'Employer cost'],
    lines: run.entries.map((entry) => ({
      id: entry.id,
      cells: [
        `${entry.employee.employeeNo} · ${entry.employee.displayName}`,
        amount(entry.grossAmount),
        amount(entry.deductionAmount),
        amount(entry.netAmount),
        amount(entry.employerCost),
      ],
    })),
    totals: [
      { label: 'Total gross', value: amount(run.totalGross) },
      { label: 'Total deductions', value: amount(run.totalDeductions) },
      { label: 'Total net', value: amount(run.totalNet), emphasis: true },
      { label: 'Employer cost', value: amount(run.totalEmployerCost) },
    ],
  });

  /** Loads the full run (header + payslip entries) before opening the export dialog. */
  const openDocument = async (id: string) => {
    setError(null);
    setNotice(null);
    setLoadingDoc(true);
    try {
      const run = await api.get<PayrollRunDetail>(`/payroll/runs/${id}`);
      setDetail(run);
      setExportOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the payroll run');
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
        modelBase('payroll-run', `${detail.periodStart.slice(0, 7)}-${detail.payGroup.name}`),
      )
    ) {
      // PDF is produced by the browser's print dialog, so hand off to the preview.
      setExportOpen(false);
      setPreviewOpen(true);
      return;
    }
    setNotice(`Exported payroll register as ${format === 'EXCEL' ? 'Excel' : format}.`);
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
        await nav.share({ title: `Payroll register ${detail.periodStart.slice(0, 7)}`, text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Payroll register summary copied to the clipboard.');
      }
      setExportOpen(false);
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

  return (
    <div>
      <PageHeader
        title="Payroll runs"
        description="Calculate, review, approve through the finance inbox, and post payroll periods."
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
            <Alert tone="info" title="Loading payroll run">
              Fetching the run for preview…
            </Alert>
          ) : null}
        </div>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] erp-frost p-4 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <select
            className="erp-select"
            value={form.companyId}
            onChange={(e) => {
              setForm({ ...form, companyId: e.target.value, payGroupId: '' });
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
            className="erp-select"
            value={form.payGroupId}
            onChange={(e) => {
              setForm({ ...form, payGroupId: e.target.value });
            }}
            required
          >
            <option value="">Pay group…</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <input
            className="erp-input"
            type="date"
            value={form.periodStart}
            onChange={(e) => {
              setForm({ ...form, periodStart: e.target.value });
            }}
            required
          />
          <input
            className="erp-input"
            type="date"
            value={form.periodEnd}
            onChange={(e) => {
              setForm({ ...form, periodEnd: e.target.value });
            }}
            required
          />
          <input
            className="erp-input"
            type="date"
            value={form.paymentDate}
            onChange={(e) => {
              setForm({ ...form, paymentDate: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.payGroupId}
          >
            Create run
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
        caption="Payroll runs"
        rowActions={(r) => [
          {
            label: 'Print / Export',
            icon: 'documentExport',
            onSelect: () => void openDocument(r.id),
          },
          {
            label: 'Open',
            icon: 'eye',
            onSelect: () => {
              router.push(`/payroll/runs/${r.id}`);
            },
          },
          ...(canCalculate && (r.status === 'DRAFT' || r.status === 'CALCULATED')
            ? [
                {
                  label: 'Calculate',
                  icon: 'refresh' as const,
                  onSelect: () => {
                    actionMutation.mutate({ id: r.id, action: 'calculate' });
                  },
                },
              ]
            : []),
          ...(canSubmit && r.status === 'CALCULATED'
            ? [
                {
                  label: 'Review & submit',
                  icon: 'check' as const,
                  onSelect: () => {
                    router.push(`/payroll/runs/${r.id}`);
                  },
                },
              ]
            : []),
          ...(canCancel &&
          (r.status === 'DRAFT' || r.status === 'CALCULATED' || r.status === 'PENDING_APPROVAL')
            ? [
                {
                  label: 'Cancel run',
                  icon: 'close' as const,
                  tone: 'danger' as const,
                  onSelect: () => {
                    actionMutation.mutate({ id: r.id, action: 'cancel' });
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
        documentKind="Payroll Register"
        documentTitle={detail ? `${detail.payGroup.name} · ${detail.periodStart.slice(0, 7)}` : ''}
        companyName={companyName}
        preview={
          detail
            ? {
                documentNo: `PAY-${detail.periodStart.slice(0, 7)}`,
                partyName: detail.payGroup.name,
                total: modelTotal(documentModel(detail)),
                meta: [
                  `${detail.employeeCount} employees`,
                  `Paid ${new Date(detail.paymentDate).toLocaleDateString()}`,
                ],
                lineCount: detail.entries.length,
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
        title={detail ? `Payroll register ${detail.periodStart.slice(0, 7)}` : 'Payroll register'}
        onClose={() => {
          setPreviewOpen(false);
        }}
      >
        {detail ? <DocumentSheet model={documentModel(detail)} /> : null}
      </PrintPreview>
    </div>
  );
}
