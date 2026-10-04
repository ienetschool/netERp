'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
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
  const [form, setForm] = useState(EMPTY_FORM);

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

  return (
    <div>
      <PageHeader
        title="Receipts"
        description="Allocations reduce open AR: POSTED → PARTIALLY_PAID → PAID."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
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
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm md:col-span-2"
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
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder={`Amount${outstanding ? ` (open ${outstanding})` : ''}`}
            value={form.amount}
            onChange={(e) => {
              setForm({ ...form, amount: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
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
      />
    </div>
  );
}
