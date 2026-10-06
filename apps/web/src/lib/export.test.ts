import { describe, expect, it } from 'vitest';
import { buildCsv, buildExcelHtml, csvCell, exportFilename } from './export';

describe('csvCell', () => {
  it('leaves plain values untouched', () => {
    expect(csvCell('INV-2026-0045')).toBe('INV-2026-0045');
    expect(csvCell(1250.5)).toBe('1250.5');
    expect(csvCell(null)).toBe('');
  });

  it('quotes and doubles embedded quotes and delimiters', () => {
    expect(csvCell('Smith, Ltd')).toBe('"Smith, Ltd"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsv', () => {
  it('joins the header and rows with CRLF', () => {
    const csv = buildCsv(['Invoice', 'Customer', 'Total'], [['INV-1', 'Acme, Inc', '100.00']]);
    expect(csv).toBe('Invoice,Customer,Total\r\nINV-1,"Acme, Inc",100.00');
  });
});

describe('buildExcelHtml', () => {
  it('escapes markup so a customer name cannot inject HTML', () => {
    const html = buildExcelHtml('Invoices', ['Customer'], [['A & B <script>']]);
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<table border="1">');
  });
});

describe('exportFilename', () => {
  it('slugifies document numbers and always keeps a usable base', () => {
    expect(exportFilename('invoice INV/2026#45', 'csv')).toBe('invoice-INV-2026-45.csv');
    expect(exportFilename('///', 'csv')).toBe('document.csv');
  });
});
