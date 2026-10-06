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

interface ReceiptRow {
  id: string;
  receiptNo: string;
  receiptDate: string;
  amount: string;
  method: string;
  status: string;
  customer: { displayName: string };
}

interface ReceiptAllocation {
  id: string;
  allocatedAmount: string;
  invoice: { invoiceNo: string; grandTotal: string; paidAmount: string; status: string };
}

interface ReceiptDetail {
  id: string;
  companyId: string;
  receiptNo: string;
  receiptDate: string;
  amount: string;
  method: string;
  reference: string | null;
  bankAccountRef: string | null;
  status: string;
  customer: { customerNo: string; displayName: string };
  currency: { code: string };
  allocations: ReceiptAllocation[];
}

interface InvoiceOption {
  id: string;
  invoiceNo: string;
  grandTotal: string;
  paidAmount: string;
  status: string;
  customerId: string;
  companyId: string;
  currencyId: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  customerId: '',
  receiptDate: new Date().toISOString().slice(0, 10),
  invoiceId: '',
  amount: '',
  method: 'BANK_TRANSFER',
};

/** Customer receipts (PRD Stage 7): allocate payments against posted invoices. */
export default function ReceiptsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const canCreate = can('sales.receipt.create');

  const listQuery = useQuery({
    queryKey: ['sales-receipts'],
    queryFn: () =>
      api.get<{ rows: ReceiptRow[]; total: number }>('/sales/receipts?page=1&pageSize=50'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const invoicesQuery = useQuery({
    queryKey: ['sales-invoices-open'],
    queryFn: () =>
      api.get<{ rows: InvoiceOption[]; total: number }>('/sales/invoices?page=1&pageSize=100'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) => {
      const invoice = (invoicesQuery.data?.rows ?? []).find((i) => i.id === payload.invoiceId);
      return api.post('/sales/receipts', {
        companyId: payload.companyId,
        customerId: invoice?.customerId,
        receiptDate: payload.receiptDate,
        method: payload.method,
        allocations: [{ invoiceId: payload.invoiceId, amount: payload.amount }],
      });
    },
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['sales-receipts'] });
      void queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['sales-invoices-open'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<ReceiptRow>> = [
    { key: 'receiptNo', header: 'Receipt No', render: (r) => r.receiptNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.displayName },
    {
      key: 'receiptDate',
      header: 'Date',
      render: (r) => new Date(r.receiptDate).toLocaleDateString(),
    },
    { key: 'method', header: 'Method', render: (r) => r.method.replaceAll('_', ' ') },
    { key: 'amount', header: 'Amount', render: (r) => r.amount },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const openInvoices = (invoicesQuery.data?.rows ?? []).filter(
    (i) =>
      ['POSTED', 'PARTIALLY_PAID'].includes(i.status) &&
      (!form.companyId || i.companyId === form.companyId),
  );
  const selectedInvoice = openInvoices.find((i) => i.id === form.invoiceId);
  const outstanding = selectedInvoice
    ? (Number(selectedInvoice.grandTotal) - Number(selectedInvoice.paidAmount)).toFixed(2)
    : '';

  const companyName = detail
    ? (companiesQuery.data?.rows.find((c) => c.id === detail.companyId)?.name ?? '')
    : '';

  const amount = (value: string | number) =>
    Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  /** Flat document model shared by the print preview and the file exports. */
  const documentModel = (receipt: ReceiptDetail): DocumentModel => ({
    companyName,
    docType: 'Payment Receipt',
    docNo: receipt.receiptNo,
    status: receipt.status,
    partyLabel: 'Received from',
    partyName: receipt.customer.displayName,
    partyMeta: [
      `Customer No. ${receipt.customer.customerNo}`,
      `Method ${receipt.method.replaceAll('_', ' ')}`,
    ],
    facts: [
      { label: 'Receipt date', value: new Date(receipt.receiptDate).toLocaleDateString() },
      { label: 'Currency', value: receipt.currency.code },
      { label: 'Reference', value: receipt.reference ?? '—' },
    ],
    columns: ['Invoice', 'Invoice total', 'Allocated'],
    lines: receipt.allocations.map((allocation) => ({
      id: allocation.id,
      cells: [
        allocation.invoice.invoiceNo,
        amount(allocation.invoice.grandTotal),
        amount(allocation.allocatedAmount),
      ],
    })),
    totals: [{ label: 'Total received', value: amount(receipt.amount), emphasis: true }],
  });

  /** Loads the full receipt (header + allocations) before opening the export dialog. */
  const openDocument = async (id: string) => {
    setError(null);
    setNotice(null);
    setLoadingDoc(true);
    try {
      const receipt = await api.get<ReceiptDetail>(`/sales/receipts/${id}`);
      setDetail(receipt);
      setExportOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the receipt');
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
        modelBase('receipt', detail.receiptNo),
      )
    ) {
      // PDF is produced by the browser's print dialog, so hand off to the preview.
      setExportOpen(false);
      setPreviewOpen(true);
      return;
    }
    setNotice(`Exported ${detail.receiptNo} as ${format === 'EXCEL' ? 'Excel' : format}.`);
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
        await nav.share({ title: `Receipt ${detail.receiptNo}`, text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Receipt summary copied to the clipboard.');
      }
      setExportOpen(false);
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

  return (
    <div>
      <PageHeader
        title="Receipts"
        description="Allocations reduce open AR: POSTED → PARTIALLY_PAID → PAID."
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
            <Alert tone="info" title="Loading receipt">
              Fetching the receipt for preview…
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
              setForm({ ...form, companyId: e.target.value, invoiceId: '' });
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
            className="erp-select md:col-span-2"
            value={form.invoiceId}
            onChange={(e) => {
              const invoice = openInvoices.find((i) => i.id === e.target.value);
              setForm({
                ...form,
                invoiceId: e.target.value,
                customerId: invoice?.customerId ?? '',
                amount: invoice
                  ? (Number(invoice.grandTotal) - Number(invoice.paidAmount)).toFixed(2)
                  : '',
              });
            }}
            required
          >
            <option value="">Open invoice…</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNo} — due {i.grandTotal}
              </option>
            ))}
          </select>
          <input
            className="erp-input"
            placeholder={`Amount${outstanding ? ` (open ${outstanding})` : ''}`}
            value={form.amount}
            onChange={(e) => {
              setForm({ ...form, amount: e.target.value });
            }}
            required
          />
          <input
            className="erp-input"
            type="date"
            value={form.receiptDate}
            onChange={(e) => {
              setForm({ ...form, receiptDate: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.invoiceId || !form.amount}
          >
            Post receipt
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
        caption="Customer receipts"
        rowActions={(r) => [
          {
            label: 'Print / Export',
            icon: 'documentExport',
            onSelect: () => void openDocument(r.id),
          },
        ]}
      />

      <DocExport
        open={exportOpen && detail !== null}
        onClose={() => {
          setExportOpen(false);
        }}
        documentKind="Payment Receipt"
        documentTitle={detail ? `${detail.receiptNo} · ${detail.customer.displayName}` : ''}
        companyName={companyName}
        preview={
          detail
            ? {
                documentNo: detail.receiptNo,
                partyName: detail.customer.displayName,
                total: modelTotal(documentModel(detail)),
                meta: [
                  `Customer No. ${detail.customer.customerNo}`,
                  `Received ${new Date(detail.receiptDate).toLocaleDateString()}`,
                ],
                lineCount: detail.allocations.length,
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
        title={detail ? `Receipt ${detail.receiptNo}` : 'Receipt'}
        onClose={() => {
          setPreviewOpen(false);
        }}
      >
        {detail ? <DocumentSheet model={documentModel(detail)} /> : null}
      </PrintPreview>
    </div>
  );
}
