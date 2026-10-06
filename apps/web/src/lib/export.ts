/**
 * Dependency-free helpers for turning a document into a downloadable artefact.
 *
 * The web bundle carries no spreadsheet or PDF library, and adding one just for
 * a handful of exports is not worth the weight. CSV and an Excel-compatible HTML
 * table can both be produced from plain strings, and "PDF" is delegated to the
 * browser's own print-to-PDF — see PrintPreview.
 */

/** Quotes a CSV cell only when it contains a delimiter, a quote or a newline. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serializes a header plus rows as RFC 4180 CSV (CRLF line endings). */
export function buildCsv(
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Builds an Excel-readable HTML table. Excel, LibreOffice and Google Sheets all
 * open this natively, so a spreadsheet export needs no bundler dependency.
 */
export function buildExcelHtml(
  title: string,
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const cell = (value: string | number | null | undefined) =>
    `<td>${escapeHtml(value === null || value === undefined ? '' : String(value))}</td>`;
  const head = header.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map(cell).join('')}</tr>`).join('');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title></head><body>`,
    `<table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    '</body></html>',
  ].join('');
}

/** Triggers a client-side file download for an in-memory string. */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Slugifies a document identifier into a safe file name. */
export function exportFilename(base: string, extension: string): string {
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
  return `${safe}.${extension}`;
}
