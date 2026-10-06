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

interface SalesOrderRow {
  id: string;
  orderNo: string;
  orderDate: string;
  grandTotal: string;
  status: string;
  customer: { displayName: string };
  lines: Array<{ id: string; quantity: string; deliveredQuantity: string }>;
}

interface SalesOrderLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxAmount: string;
  lineTotal: string;
  deliveredQuantity: string;
}

interface SalesOrderDetail {
  id: string;
  companyId: string;
  orderNo: string;
  orderDate: string;
  requestedDeliveryDate: string | null;
  status: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  customer: { customerNo: string; displayName: string };
  lines: SalesOrderLine[];
  deliveries: Array<{ deliveryNo: string; status: string; deliveryDate: string }>;
}

interface CustomerOption {
  id: string;
  displayName: string;
  companyId: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  standardCost: string;
  saleable: boolean;
}

const EMPTY_LINE = { productId: '', description: '', quantity: '1', unitPrice: '0' };
const EMPTY_FORM = {
  companyId: '',
  customerId: '',
  orderDate: new Date().toISOString().slice(0, 10),
  lines: [{ ...EMPTY_LINE }],
};

/** Sales orders (PRD Stage 7): create, submit for approval, track deliveries. */
export default function SalesOrdersPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const canCreate = can('sales.sales_order.create');
  const canSubmit = can('sales.sales_order.submit');

  const listQuery = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () =>
      api.get<{ rows: SalesOrderRow[]; total: number }>('/sales/orders?page=1&pageSize=50'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const customersQuery = useQuery({
    queryKey: ['sales-customers-all'],
    queryFn: () =>
      api.get<{ rows: CustomerOption[]; total: number }>('/sales/customers?pageSize=200'),
  });

  const productsQuery = useQuery({
    queryKey: ['sales-products-options'],
    queryFn: () =>
      api.get<{ rows: ProductOption[]; total: number }>('/inventory/products?pageSize=200'),
  });

  const invalidate = () => {
    setError(null);
    setForm(EMPTY_FORM);
    void queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      api.post('/sales/orders', {
        companyId: payload.companyId,
        customerId: payload.customerId,
        orderDate: payload.orderDate,
        lines: payload.lines.map((l) => ({
          ...(l.productId ? { productId: l.productId } : {}),
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
    mutationFn: (id: string) => api.post(`/sales/orders/${id}/submit`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Submit failed');
    },
  });

  const columns: Array<DataTableColumn<SalesOrderRow>> = [
    { key: 'orderNo', header: 'SO No', render: (r) => r.orderNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.displayName },
    {
      key: 'orderDate',
      header: 'Ordered',
      render: (r) => new Date(r.orderDate).toLocaleDateString(),
    },
    { key: 'grandTotal', header: 'Total', render: (r) => r.grandTotal },
    {
      key: 'delivered',
      header: 'Delivered',
      render: (r) => {
        const ordered = r.lines.reduce((acc, l) => acc + Number(l.quantity), 0);
        const delivered = r.lines.reduce((acc, l) => acc + Number(l.deliveredQuantity), 0);
        return `${delivered}/${ordered}`;
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const customerOptions = (customersQuery.data?.rows ?? []).filter(
    (c) => !form.companyId || c.companyId === form.companyId,
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
  const documentModel = (order: SalesOrderDetail): DocumentModel => ({
    companyName,
    docType: 'Sales Order',
    docNo: order.orderNo,
    status: order.status,
    partyLabel: 'Customer',
    partyName: order.customer.displayName,
    partyMeta: [`Customer No. ${order.customer.customerNo}`],
    facts: [
      { label: 'Order date', value: new Date(order.orderDate).toLocaleDateString() },
      {
        label: 'Requested delivery',
        value: order.requestedDeliveryDate
          ? new Date(order.requestedDeliveryDate).toLocaleDateString()
          : 'As available',
      },
      { label: 'Deliveries', value: String(order.deliveries.length) },
    ],
    columns: ['Description', 'Qty', 'Delivered', 'Unit price', 'Tax', 'Amount'],
    lines: order.lines.map((line) => ({
      id: line.id,
      cells: [
        line.description,
        amount(line.quantity),
        amount(line.deliveredQuantity),
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

  /** Loads the full order (header + lines) before opening the export dialog. */
  const openDocument = async (id: string) => {
    setError(null);
    setNotice(null);
    setLoadingDoc(true);
    try {
      const order = await api.get<SalesOrderDetail>(`/sales/orders/${id}`);
      setDetail(order);
      setExportOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the sales order');
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
        modelBase('sales-order', detail.orderNo),
      )
    ) {
      // PDF is produced by the browser's print dialog, so hand off to the preview.
      setExportOpen(false);
      setPreviewOpen(true);
      return;
    }
    setNotice(`Exported ${detail.orderNo} as ${format === 'EXCEL' ? 'Excel' : format}.`);
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
        await nav.share({ title: `Sales order ${detail.orderNo}`, text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Sales order summary copied to the clipboard.');
      }
      setExportOpen(false);
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

  return (
    <div>
      <PageHeader
        title="Sales orders"
        description="Orders route through approval; deliveries update fulfillment quantities."
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
            <Alert tone="info" title="Loading sales order">
              Fetching the sales order for preview…
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
          <div className="grid gap-3 md:grid-cols-3">
            <select
              className="erp-select"
              value={form.companyId}
              onChange={(e) => {
                setForm({ ...form, companyId: e.target.value, customerId: '' });
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
              value={form.customerId}
              onChange={(e) => {
                setForm({ ...form, customerId: e.target.value });
              }}
              required
            >
              <option value="">Customer…</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
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
              <div key={i} className="grid items-center gap-2 md:grid-cols-5">
                <select
                  className="erp-select"
                  value={line.productId}
                  onChange={(e) => {
                    const product = (productsQuery.data?.rows ?? []).find(
                      (p) => p.id === e.target.value,
                    );
                    const lines = [...form.lines];
                    lines[i] = {
                      ...line,
                      productId: e.target.value,
                      description: product ? product.name : line.description,
                      unitPrice: product ? product.standardCost : line.unitPrice,
                    };
                    setForm({ ...form, lines });
                  }}
                >
                  <option value="">Product (optional)…</option>
                  {(productsQuery.data?.rows ?? [])
                    .filter((p) => p.saleable)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
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
                  placeholder="Unit price e.g. 12.50"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const lines = [...form.lines];
                    lines[i] = { ...line, unitPrice: e.target.value };
                    setForm({ ...form, lines });
                  }}
                  required
                />
                <button
                  type="button"
                  className="text-xs text-[var(--erp-muted)] disabled:opacity-30"
                  disabled={form.lines.length === 1}
                  onClick={() => {
                    setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) });
                  }}
                >
                  Remove
                </button>
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
            disabled={createMutation.isPending || !form.companyId || !form.customerId}
          >
            Create sales order
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
        caption="Sales orders"
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
        documentKind="Sales Order"
        documentTitle={detail ? `${detail.orderNo} · ${detail.customer.displayName}` : ''}
        companyName={companyName}
        preview={
          detail
            ? {
                documentNo: detail.orderNo,
                partyName: detail.customer.displayName,
                total: modelTotal(documentModel(detail)),
                meta: [
                  `Customer No. ${detail.customer.customerNo}`,
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
        title={detail ? `Sales order ${detail.orderNo}` : 'Sales order'}
        onClose={() => {
          setPreviewOpen(false);
        }}
      >
        {detail ? <DocumentSheet model={documentModel(detail)} /> : null}
      </PrintPreview>
    </div>
  );
}
