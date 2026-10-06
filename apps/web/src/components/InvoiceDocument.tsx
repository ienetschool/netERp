import React from 'react';

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxAmount: string;
  lineTotal: string;
}

export interface InvoiceDetail {
  id: string;
  companyId: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  paidAmount: string;
  postingDate?: string | null;
  customer: { customerNo: string; displayName: string };
  lines: InvoiceLine[];
}

const decimal = (value: string | number, places = 2): string =>
  Number(value).toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });

const date = (value: string): string => new Date(value).toLocaleDateString();

/**
 * Customer invoice as it appears on paper. Kept as plain semantic markup — no
 * glass, blur or motion — because the print stylesheet flattens all of that
 * anyway and the screen preview should match the printed sheet.
 */
export function InvoiceDocument({
  invoice,
  companyName,
}: {
  invoice: InvoiceDetail;
  companyName: string;
}) {
  const balance = Number(invoice.grandTotal) - Number(invoice.paidAmount);

  return (
    <article className="erp-doc">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d8dee9] pb-5">
        <div>
          <p className="flex items-center gap-2 text-base font-bold text-[#0f172a]">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--erp-primary)] text-[11px] font-bold text-white">
              nE
            </span>
            netERp
          </p>
          <p className="mt-1.5 text-sm text-[#4b5563]">{companyName || 'Company'}</p>
        </div>
        <div className="text-right">
          <h1 className="text-lg font-bold uppercase tracking-wide text-[#0f172a]">Tax Invoice</h1>
          <p className="mt-1 text-sm font-semibold text-[#0f172a]">{invoice.invoiceNo}</p>
          <p className="text-xs text-[#4b5563]">Status: {invoice.status}</p>
        </div>
      </header>

      <section className="mt-5 grid gap-5 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">
            Billed to
          </p>
          <p className="mt-1 text-sm font-medium text-[#111827]">{invoice.customer.displayName}</p>
          <p className="text-xs text-[#4b5563]">Customer No. {invoice.customer.customerNo}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">
            Invoice date
          </p>
          <p className="mt-1 text-sm text-[#111827]">{date(invoice.invoiceDate)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">
            Due date
          </p>
          <p className="mt-1 text-sm text-[#111827]">{date(invoice.dueDate)}</p>
        </div>
      </section>

      <table className="erp-table mt-6">
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col" className="text-right">
              Qty
            </th>
            <th scope="col" className="text-right">
              Unit price
            </th>
            <th scope="col" className="text-right">
              Discount
            </th>
            <th scope="col" className="text-right">
              Tax
            </th>
            <th scope="col" className="text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td className="text-right tabular-nums">{decimal(line.quantity, 2)}</td>
              <td className="text-right tabular-nums">{decimal(line.unitPrice)}</td>
              <td className="text-right tabular-nums">{decimal(line.discount)}</td>
              <td className="text-right tabular-nums">{decimal(line.taxAmount)}</td>
              <td className="text-right tabular-nums">{decimal(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-5 flex justify-end">
        <dl className="w-full max-w-[280px] text-sm">
          <div className="flex justify-between border-b border-[#e2e8f0] py-1.5">
            <dt className="text-[#4b5563]">Subtotal</dt>
            <dd className="tabular-nums text-[#111827]">{decimal(invoice.subtotal)}</dd>
          </div>
          <div className="flex justify-between border-b border-[#e2e8f0] py-1.5">
            <dt className="text-[#4b5563]">Discount</dt>
            <dd className="tabular-nums text-[#111827]">{decimal(invoice.discountTotal)}</dd>
          </div>
          <div className="flex justify-between border-b border-[#e2e8f0] py-1.5">
            <dt className="text-[#4b5563]">Tax</dt>
            <dd className="tabular-nums text-[#111827]">{decimal(invoice.taxTotal)}</dd>
          </div>
          <div className="flex justify-between border-b border-[#9aa6bb] py-1.5 font-semibold">
            <dt className="text-[#0f172a]">Grand total</dt>
            <dd className="tabular-nums text-[#0f172a]">{decimal(invoice.grandTotal)}</dd>
          </div>
          <div className="flex justify-between py-1.5">
            <dt className="text-[#4b5563]">Paid</dt>
            <dd className="tabular-nums text-[#111827]">{decimal(invoice.paidAmount)}</dd>
          </div>
          <div className="flex justify-between pt-1.5 text-base font-bold">
            <dt className="text-[#0f172a]">Balance due</dt>
            <dd className="tabular-nums text-[#0f172a]">{decimal(balance)}</dd>
          </div>
        </dl>
      </section>

      <footer className="mt-8 border-t border-[#e2e8f0] pt-3 text-[10px] text-[#6b7280]">
        Computer-generated document from netERp. Amounts are shown in the company&apos;s base
        currency. Please quote invoice {invoice.invoiceNo} with any remittance.
      </footer>
    </article>
  );
}
