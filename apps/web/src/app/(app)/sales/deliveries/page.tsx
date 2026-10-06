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

interface DeliveryRow {
  id: string;
  deliveryNo: string;
  deliveryDate: string;
  status: string;
  customer: { displayName: string };
  warehouse: { code: string; name: string } | null;
  lines: Array<{ id: string; quantity: string }>;
}

interface DeliveryLineDetail {
  id: string;
  quantity: string;
  batchNo: string | null;
  serialNo: string | null;
  salesOrderLine: { description: string } | null;
  product: { sku: string; name: string } | null;
}

interface DeliveryDetail {
  id: string;
  companyId: string;
  deliveryNo: string;
  deliveryDate: string;
  status: string;
  customer: { customerNo: string; displayName: string };
  warehouse: { code: string; name: string };
  salesOrder: { orderNo: string } | null;
  currency: { code: string } | null;
  lines: DeliveryLineDetail[];
}

interface SalesOrderOption {
  id: string;
  orderNo: string;
  status: string;
  customerId: string;
  companyId: string;
  lines: Array<{ id: string; description: string; quantity: string; deliveredQuantity: string }>;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  warehouseId: '',
  salesOrderId: '',
  deliveryDate: new Date().toISOString().slice(0, 10),
};

/** Deliveries (PRD Stage 7): post stock issues against approved sales orders. */
export default function DeliveriesPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const canCreate = can('sales.delivery.create');

  const listQuery = useQuery({
    queryKey: ['sales-deliveries'],
    queryFn: () =>
      api.get<{ rows: DeliveryRow[]; total: number }>('/sales/deliveries?page=1&pageSize=50'),
  });

  const ordersQuery = useQuery({
    queryKey: ['sales-orders-deliverable'],
    queryFn: () =>
      api.get<{ rows: SalesOrderOption[]; total: number }>(
        '/sales/orders?page=1&pageSize=100&status=APPROVED',
      ),
  });

  const warehousesQuery = useQuery({
    queryKey: ['warehouses-options'],
    queryFn: () => apiList<WarehouseOption>('/warehouses?pageSize=200'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) => {
      const order = (ordersQuery.data?.rows ?? []).find((o) => o.id === payload.salesOrderId);
      return api.post('/sales/deliveries', {
        companyId: payload.companyId,
        warehouseId: payload.warehouseId,
        customerId: order?.customerId,
        salesOrderId: payload.salesOrderId,
        deliveryDate: payload.deliveryDate,
        lines: (order?.lines ?? []).map((l) => ({
          salesOrderLineId: l.id,
          quantity: Number(l.quantity) - Number(l.deliveredQuantity),
        })),
      });
    },
    onSuccess: () => {
      setError(null);
      setForm(EMPTY_FORM);
      void queryClient.invalidateQueries({ queryKey: ['sales-deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const columns: Array<DataTableColumn<DeliveryRow>> = [
    { key: 'deliveryNo', header: 'Delivery No', render: (r) => r.deliveryNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customer.displayName },
    { key: 'warehouse', header: 'Warehouse', render: (r) => r.warehouse?.code ?? '—' },
    {
      key: 'deliveryDate',
      header: 'Date',
      render: (r) => new Date(r.deliveryDate).toLocaleDateString(),
    },
    {
      key: 'lines',
      header: 'Lines',
      render: (r) => r.lines.reduce((acc, l) => acc + Number(l.quantity), 0),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const warehouses = warehousesQuery.data?.rows ?? [];
  const deliverable = (ordersQuery.data?.rows ?? []).filter(
    (o) => !form.companyId || o.companyId === form.companyId,
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
  const documentModel = (delivery: DeliveryDetail): DocumentModel => {
    const totalQuantity = delivery.lines.reduce((acc, l) => acc + Number(l.quantity), 0);
    return {
      companyName,
      docType: 'Delivery Note',
      docNo: delivery.deliveryNo,
      status: delivery.status,
      partyLabel: 'Deliver to',
      partyName: delivery.customer.displayName,
      partyMeta: [`Customer No. ${delivery.customer.customerNo}`],
      facts: [
        { label: 'Delivery date', value: new Date(delivery.deliveryDate).toLocaleDateString() },
        { label: 'Sales order', value: delivery.salesOrder?.orderNo ?? '—' },
        {
          label: 'Warehouse',
          value: `${delivery.warehouse.code} — ${delivery.warehouse.name}`,
        },
      ],
      columns: ['Item', 'SKU', 'Quantity'],
      lines: delivery.lines.map((line) => ({
        id: line.id,
        cells: [
          line.salesOrderLine?.description ?? line.product?.name ?? 'Item',
          line.product?.sku ?? '—',
          amount(line.quantity),
        ],
      })),
      totals: [{ label: 'Total quantity', value: amount(totalQuantity), emphasis: true }],
    };
  };

  /** Loads the full delivery (header + lines) before opening the export dialog. */
  const openDocument = async (id: string) => {
    setError(null);
    setNotice(null);
    setLoadingDoc(true);
    try {
      const delivery = await api.get<DeliveryDetail>(`/sales/deliveries/${id}`);
      setDetail(delivery);
      setExportOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the delivery');
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
        modelBase('delivery', detail.deliveryNo),
      )
    ) {
      // PDF is produced by the browser's print dialog, so hand off to the preview.
      setExportOpen(false);
      setPreviewOpen(true);
      return;
    }
    setNotice(`Exported ${detail.deliveryNo} as ${format === 'EXCEL' ? 'Excel' : format}.`);
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
        await nav.share({ title: `Delivery ${detail.deliveryNo}`, text });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Delivery summary copied to the clipboard.');
      }
      setExportOpen(false);
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

  return (
    <div>
      <PageHeader
        title="Deliveries"
        description="Posting a delivery issues stock at weighted-average cost and updates order fulfillment."
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
            <Alert tone="info" title="Loading delivery">
              Fetching the delivery for preview…
            </Alert>
          ) : null}
        </div>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] erp-frost p-4 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <select
            className="erp-select"
            value={form.companyId}
            onChange={(e) => {
              setForm({ ...form, companyId: e.target.value, salesOrderId: '', warehouseId: '' });
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
            value={form.salesOrderId}
            onChange={(e) => {
              const order = deliverable.find((o) => o.id === e.target.value);
              setForm({
                ...form,
                salesOrderId: e.target.value,
                companyId: order?.companyId ?? form.companyId,
              });
            }}
            required
          >
            <option value="">Approved sales order…</option>
            {deliverable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNo}
              </option>
            ))}
          </select>
          <select
            className="erp-select"
            value={form.warehouseId}
            onChange={(e) => {
              setForm({ ...form, warehouseId: e.target.value });
            }}
            required
          >
            <option value="">Warehouse…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
          <input
            className="erp-input"
            type="date"
            value={form.deliveryDate}
            onChange={(e) => {
              setForm({ ...form, deliveryDate: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.salesOrderId || !form.warehouseId}
          >
            Post delivery
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
        caption="Deliveries"
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
        documentKind="Delivery Note"
        documentTitle={detail ? `${detail.deliveryNo} · ${detail.customer.displayName}` : ''}
        companyName={companyName}
        preview={
          detail
            ? {
                documentNo: detail.deliveryNo,
                partyName: detail.customer.displayName,
                total: modelTotal(documentModel(detail)),
                meta: [
                  `Customer No. ${detail.customer.customerNo}`,
                  `Delivered ${new Date(detail.deliveryDate).toLocaleDateString()}`,
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
        title={detail ? `Delivery ${detail.deliveryNo}` : 'Delivery'}
        onClose={() => {
          setPreviewOpen(false);
        }}
      >
        {detail ? <DocumentSheet model={documentModel(detail)} /> : null}
      </PrintPreview>
    </div>
  );
}
