import type { DocumentModel } from '@/components/DocumentSheet';
import { buildCsv, buildExcelHtml, downloadText, exportFilename } from './export';

/**
 * Bridges the flat `DocumentModel` used by the print sheet to the download and
 * share actions every module exposes through DocExport. Keeping it here means a
 * new document module only has to describe its data once.
 */

export type DocFormat = 'PDF' | 'EXCEL' | 'CSV';

/** Header plus rows, laid out for CSV/Excel: totals sit under the amount column. */
export function modelSheet(model: DocumentModel): {
  header: string[];
  rows: Array<Array<string | number>>;
} {
  const header = model.columns;
  const rows: Array<Array<string | number>> = model.lines.map((line) => line.cells);
  const pad = Math.max(0, header.length - 2);
  for (const total of model.totals) {
    rows.push([...Array<string | number>(pad).fill(''), total.label, total.value]);
  }
  return { header, rows };
}

/** The document total, taken from the emphasised totals row when present. */
export function modelTotal(model: DocumentModel): string | undefined {
  return model.totals.find((row) => row.emphasis)?.value;
}

/**
 * Writes the CSV or Excel artefact for a document. PDF is delegated to the
 * browser print dialog, so the caller simply opens the print preview and this
 * returns false.
 */
export function downloadModel(model: DocumentModel, format: DocFormat, base: string): boolean {
  const { header, rows } = modelSheet(model);
  if (format === 'CSV') {
    downloadText(exportFilename(base, 'csv'), 'text/csv', `\uFEFF${buildCsv(header, rows)}`);
    return true;
  }
  if (format === 'EXCEL') {
    downloadText(
      exportFilename(base, 'xls'),
      'application/vnd.ms-excel',
      buildExcelHtml(`${model.docType} ${model.docNo}`, header, rows),
    );
    return true;
  }
  return false;
}

/** One-line summary used for the share sheet / clipboard fallback. */
export function modelShareText(model: DocumentModel): string {
  const total = modelTotal(model);
  return [`${model.docType} ${model.docNo}`, model.partyName, total ? `total ${total}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** Slug base for the exported file, e.g. "purchase-order-PO-2026-000004". */
export function modelBase(slug: string, documentNo: string): string {
  return `${slug}-${documentNo}`;
}
