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

interface PurchaseOrderRow {
  id: string;
  poNo: string;
  status: string;
  orderDate: string;
  grandTotal: string;
  currencyId: string;
  supplier: { displayName: string };
  lines: Array<{ id: string; quantity: string; receivedQuantity: string }>;
}

interface PurchaseOrderLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxAmount: string;
  lineTotal: string;
  receivedQuantity: string;
}

interface PurchaseOrderDetail {
  id: string;
  companyId: string;
  poNo: string;
  orderDate: string;
  expectedDate: string | null;
  status: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  supplier: { supplierNo: string; displayName: string };
  lines: PurchaseOrderLine[];
  receipts: Array<{ receiptNo: string; status: string; receiptDate: string }>;
}

interface SupplierOption {
  id: string;
  displayName: string;
  companyId: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_LINE = { description: '', quantity: '1', unitPrice: '0' };
const EMPTY_FORM = {
  companyId: '',
  supplierId: '',
  orderDate: new Date().toISOString().slice(0, 10),
  lines: [{ ...EMPTY_LINE }],
};

/** Purchase orders (PRD Stage 5): create, submit for approval, track receipts. */
export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const canCreate = can('procurement.purchase_order.create');
  const canSubmit = can('procurement.purchase_order.submit');

  const listQuery = useQuery({
    queryKey: ['procurement-pos'],
    queryFn: () =>
      api.get<{ rows: PurchaseOrderRow[]; total: number }>(
        '/procurement/purchase-orders?page=1&pageSize=50',
      ),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const suppliersQuery = useQuery({
    queryKey: ['procurement-suppliers-all'],
    queryFn: () =>
      api.get<{ rows: SupplierOption[]; total: number }>(
        '/procurement/suppliers?page=1&pageSize=200',
      ),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['procurement-pos'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/procurement/purchase-orders', {
        companyId: payload.companyId,
        supplierId: payload.supplierId,
        orderDate: payload.orderDate,
        lines: payload.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice,
        })),
      }),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/procurement/purchase-orders/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const columns: Array<DataTableColumn<PurchaseOrderRow>> = [
    { key: 'poNo', header: 'PO No', render: (r) => r.poNo },
    { key: 'supplier', header: 'Supplier', render: (r) => r.supplier.displayName },
    {
      key: 'orderDate',
      header: 'Ordered',
      render: (r) => new Date(r.orderDate).toLocaleDateString(),
    },
    { key: 'grandTotal', header: 'Total', render: (r) => r.grandTotal },
    {
      key: 'received',
      header: 'Received',
      render: (r) => {
        const ordered = r.lines.reduce((acc, l) => acc + Number(l.quantity), 0);
        const received = r.lines.reduce((acc, l) => acc + Number(l.receivedQuantity), 0);
        return `${received}/${ordered}`;
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const supplierOptions = (suppliersQuery.data?.rows ?? []).filter(
    (s) => !form.companyId || s.companyId === form.companyId,
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
  const documentModel = (order: PurchaseOrderDetail): DocumentModel => ({
    companyName,
    docType: 'Purchase Order',
    docNo: order.poNo,
    status: order.status,
    partyLabel: 'Supplier',
    partyName: order.supplier.displayName,
    partyMeta: [`Supplier No. ${order.supplier.supplierNo}`],
    facts: [
      { label: 'Order date', value: new Date(order.orderDate).toLocaleDateString() },
      {
        label: 'Expected',
        value: order.expectedDate ? new Date(order.expectedDate).toLocaleDateString() : 'As agreed',
      },
      { label: 'Goods receipts', value: String(order.receipts.length) },
    ],
    columns: ['Description', 'Qty', 'Received', 'Unit price', 'Tax', 'Amount'],
    lines: order.lines.map((line) => ({
      id: line.id,
      cells: [
        line.description,
        amount(line.quantity),
        amount(line.receivedQuantity),
        amount(line.unitPrice),
        amount(line.taxAmount),
        amount(line.lineTotal),
      ],
    })),
    totals: [
      { label: 'Subtotal', value: amount(order.subtotal) },
      { label: 'Discount', value: amount(order.discountTotal) },
      { label: 'Tax', value: amount(order.taxTotal) },
      { label: 'Grand total', value: amount(order.grandTotal), emphasis: true },
    ],
  });

  /** Loads the full purchase order (header + lines) before opening the export dialog. */
  const openDocument = async (id: string) => {
    setError(null);
    setNotice(null);
    setLoadingDoc(true);
    try {
      const order = await api.get<PurchaseOrderDetail>(`/procurement/purchase-orders/${id}`);
      setDetail(order);
      setExportOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the purchase order');
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
        modelBase('purchase-order', detail.poNo),
      )
    ) {
      // PDF is produced by the browser's print dialog, so hand off to the preview.
      setExportOpen(false);
      setPreviewOpen(true);
      return;
    }
    setNotice(`Exported ${detail.poNo} as ${format === 'EXCEL' ? 'Excel' : format}.`);
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
        await nav.share({ title: `Purchase order ${detail.poNo}`, text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Purchase order summary copied to the clipboard.');
      }
      setExportOpen(false);
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Orders route through approval; goods receipts update received quantities."
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
            <Alert tone="info" title="Loading purchase order">
              Fetching the purchase order for preview…
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
                setForm({ ...form, companyId: e.target.value, supplierId: '' });
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
              value={form.supplierId}
              onChange={(e) => {
                setForm({ ...form, supplierId: e.target.value });
              }}
              required
            >
              <option value="">Supplier…</option>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
            <input
              className="erp-input"
              type="date"
              value={form.orderDate}
              onChange={(e) => {
                setForm({ ...form, orderDate: e.target.value });
              }}
              required
            />
          </div>
          <div className="space-y-2">
            {form.lines.map((line, i) => (
              <div key={i} className="grid items-center gap-2 md:grid-cols-4">
                <input
                  className="erp-input md:col-span-2"
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, description: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                />
                <input
                  className="erp-input"
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, quantity: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                />
                <input
                  className="erp-input"
                  placeholder="Unit price e.g. 4.50"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, unitPrice: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-xs"
                onClick={() => {
                  setForm({ ...form, lines: [...form.lines, { ...EMPTY_LINE }] });
                }}
              >
                Add line
              </button>
              <button
                type="button"
                className="text-xs text-[var(--erp-muted)] disabled:opacity-30"
                disabled={form.lines.length === 1}
                onClick={() => {
                  setForm({ ...form, lines: form.lines.slice(0, -1) });
                }}
              >
                Remove last
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId || !form.supplierId}
          >
            Create purchase order
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
        caption="Purchase orders"
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
        ]}
      />

      <DocExport
        open={exportOpen && detail !== null}
        onClose={() => {
          setExportOpen(false);
        }}
        documentKind="Purchase Order"
        documentTitle={detail ? `${detail.poNo} · ${detail.supplier.displayName}` : ''}
        companyName={companyName}
        preview={
          detail
            ? {
                documentNo: detail.poNo,
                partyName: detail.supplier.displayName,
                total: modelTotal(documentModel(detail)),
                meta: [
                  `Supplier No. ${detail.supplier.supplierNo}`,
                  `Ordered ${new Date(detail.orderDate).toLocaleDateString()}`,
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
        title={detail ? `Purchase order ${detail.poNo}` : 'Purchase order'}
        onClose={() => {
          setPreviewOpen(false);
        }}
      >
        {detail ? <DocumentSheet model={documentModel(detail)} /> : null}
      </PrintPreview>
    </div>
  );
}
