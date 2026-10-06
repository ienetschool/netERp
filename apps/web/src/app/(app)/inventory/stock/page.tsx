'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';

interface StockRow {
  id: string;
  onHand: string;
  reserved: string;
  avgCost: string;
  product: { sku: string; name: string; reorderLevel: string };
  warehouse: { code: string; name: string };
  location: { code: string } | null;
}

interface MovementRow {
  id: string;
  movementType: string;
  quantity: string;
  unitCost: string;
  referenceType: string | null;
  referenceNo: string | null;
  movementDate: string;
  product: { sku: string; name: string };
  warehouse: { code: string };
}

const MOVEMENT_COLUMNS: Array<DataTableColumn<MovementRow>> = [
  { key: 'date', header: 'Date', render: (r) => new Date(r.movementDate).toLocaleDateString() },
  { key: 'product', header: 'Product', render: (r) => `${r.product.sku} — ${r.product.name}` },
  { key: 'type', header: 'Type', render: (r) => r.movementType.replaceAll('_', ' ') },
  { key: 'qty', header: 'Qty', render: (r) => r.quantity },
  { key: 'cost', header: 'Unit cost', render: (r) => r.unitCost },
  { key: 'wh', header: 'Warehouse', render: (r) => r.warehouse.code },
  { key: 'ref', header: 'Source', render: (r) => r.referenceNo ?? r.referenceType ?? '—' },
];

/** Stock overview and the movement ledger (PRD Stage 6; CLAUDE.md §16). */
export default function StockPage() {
  const [warehouseFilter, setWarehouseFilter] = useState('');

  const stockQuery = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: () => api.get<{ rows: StockRow[]; total: number }>('/inventory/stock?pageSize=100'),
  });

  const movementsQuery = useQuery({
    queryKey: ['inventory-movements', warehouseFilter],
    queryFn: () =>
      api.get<{ rows: MovementRow[]; total: number }>(
        `/inventory/movements?pageSize=50${warehouseFilter ? `&warehouseId=${warehouseFilter}` : ''}`,
      ),
  });

  const warehousesQuery = useQuery({
    queryKey: ['warehouses-options'],
    queryFn: () => apiList<{ id: string; code: string; name: string }>('/warehouses?pageSize=200'),
  });

  const stockColumns: Array<DataTableColumn<StockRow>> = [
    { key: 'sku', header: 'SKU', render: (r) => r.product.sku },
    { key: 'name', header: 'Product', render: (r) => r.product.name },
    { key: 'wh', header: 'Warehouse', render: (r) => r.warehouse.code },
    { key: 'loc', header: 'Location', render: (r) => r.location?.code ?? '—' },
    { key: 'onHand', header: 'On hand', render: (r) => r.onHand },
    { key: 'reserved', header: 'Reserved', render: (r) => r.reserved },
    {
      key: 'value',
      header: 'Stock value',
      render: (r) => (Number(r.onHand) * Number(r.avgCost)).toFixed(2),
    },
    {
      key: 'reorder',
      header: 'Reorder',
      render: (r) => (Number(r.onHand) < Number(r.product.reorderLevel) ? '⚠ LOW' : 'OK'),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Stock"
        description="Balances per warehouse and location; the movement ledger below is the authoritative history."
      />

      <DataTable
        columns={stockColumns}
        rows={stockQuery.data?.rows}
        loading={stockQuery.isLoading}
        error={stockQuery.error}
        getRowKey={(r) => r.id}
        caption="Stock balances"
      />

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
          Movement ledger
        </h2>
        <select
          aria-label="Filter movements by warehouse"
          className="erp-select"
          value={warehouseFilter}
          onChange={(e) => {
            setWarehouseFilter(e.target.value);
          }}
        >
          <option value="">All warehouses</option>
          {(warehousesQuery.data?.rows ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={MOVEMENT_COLUMNS}
        rows={movementsQuery.data?.rows}
        loading={movementsQuery.isLoading}
        error={movementsQuery.error}
        getRowKey={(r) => r.id}
        caption="Stock movements"
      />
    </div>
  );
}
