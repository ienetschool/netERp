import React from 'react';

/** One rendered row: the cell values line up with `columns`. */
export interface SheetLine {
  id: string;
  cells: Array<string | number>;
}

/** A totals line in the summary block. `emphasis` renders the grand total. */
export interface SheetTotalsRow {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface SheetFact {
  label: string;
  value: string;
}

/**
 * Everything a printed document needs, resolved from the loaded record. Keeping
 * the model flat means each module builds a small adapter instead of its own
 * sheet component, while the paper layout stays identical across documents.
 */
export interface DocumentModel {
  /** Company the document is issued from. */
  companyName: string;
  /** Display name of the document family, e.g. "Tax Invoice". */
  docType: string;
  /** Document number, e.g. "INV-2026-000009". */
  docNo: string;
  status: string;
  /** Label above the party block, e.g. "Billed to" or "Supplier". */
  partyLabel: string;
  partyName: string;
  /** Optional extra party lines, e.g. "Customer No. CUS-0001". */
  partyMeta?: string[];
  /** Date / reference facts rendered beside the party block. */
  facts: SheetFact[];
  /** Table header labels. The first column is left-aligned, the rest right. */
  columns: string[];
  lines: SheetLine[];
  totals: SheetTotalsRow[];
  note?: string;
}

/**
 * A document as it appears on paper. Plain semantic markup — no glass, blur or
 * motion — because the print stylesheet flattens those anyway and the on-screen
 * preview should match the printed sheet.
 */
export function DocumentSheet({ model }: { model: DocumentModel }) {
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
          <p className="mt-1.5 text-sm text-[#4b5563]">{model.companyName || 'Company'}</p>
        </div>
        <div className="text-right">
          <h1 className="text-lg font-bold uppercase tracking-wide text-[#0f172a]">
            {model.docType}
          </h1>
          <p className="mt-1 text-sm font-semibold text-[#0f172a]">{model.docNo}</p>
          <p className="text-xs text-[#4b5563]">Status: {model.status}</p>
        </div>
      </header>

      <section className="mt-5 grid gap-5 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">
            {model.partyLabel}
          </p>
          <p className="mt-1 text-sm font-medium text-[#111827]">{model.partyName}</p>
          {(model.partyMeta ?? []).map((line) => (
            <p key={line} className="text-xs text-[#4b5563]">
              {line}
            </p>
          ))}
        </div>
        {model.facts.map((fact) => (
          <div key={fact.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">
              {fact.label}
            </p>
            <p className="mt-1 text-sm text-[#111827]">{fact.value}</p>
          </div>
        ))}
      </section>

      <table className="erp-table mt-6">
        <thead>
          <tr>
            {model.columns.map((column, index) => (
              <th key={column} scope="col" className={index === 0 ? undefined : 'text-right'}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.lines.map((line) => (
            <tr key={line.id}>
              {line.cells.map((cell, index) => (
                <td
                  key={`${line.id}-${String(index)}`}
                  className={index === 0 ? undefined : 'text-right tabular-nums'}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {model.totals.length > 0 ? (
        <section className="mt-5 flex justify-end">
          <dl className="w-full max-w-[280px] text-sm">
            {model.totals.map((row) => (
              <div
                key={row.label}
                className={
                  row.emphasis
                    ? 'flex justify-between border-t border-[#9aa6bb] pt-1.5 text-base font-bold'
                    : 'flex justify-between border-b border-[#e2e8f0] py-1.5'
                }
              >
                <dt className={row.emphasis ? 'text-[#0f172a]' : 'text-[#4b5563]'}>{row.label}</dt>
                <dd className="tabular-nums text-[#111827]">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <footer className="mt-8 border-t border-[#e2e8f0] pt-3 text-[10px] text-[#6b7280]">
        {model.note ??
          `Computer-generated document from netERp. Please quote ${model.docNo} with any correspondence.`}
      </footer>
    </article>
  );
}
