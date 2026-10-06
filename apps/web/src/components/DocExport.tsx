'use client';

import React from 'react';
import { Icon, type IconName } from '@erp/ui';

export interface ExportFormat {
  value: string;
  label: string;
  icon: IconName;
}

/**
 * Real summary data for the thumbnail. Every field is drawn from the loaded
 * document, so the dialog never shows placeholder content.
 */
export interface DocExportPreview {
  /** Document number, e.g. "INV-2026-000001". */
  documentNo: string;
  /** Party the document is addressed to (customer, supplier, employee…). */
  partyName: string;
  /** Pre-formatted document total, e.g. "1,250.00". */
  total?: string;
  /** Extra detail lines shown beneath the party name. */
  meta?: string[];
  /** Number of line items, rendered as "N items". */
  lineCount?: number;
}

interface DocExportProps {
  open: boolean;
  onClose: () => void;
  /** Noun for the document family, e.g. "Sales Invoice". */
  documentKind?: string;
  documentTitle: string;
  companyName: string;
  preview?: DocExportPreview;
  onPreview: () => void;
  onDownload: (format: string) => void;
  onShare: () => void;
}

const OUTPUT_FORMATS: ExportFormat[] = [
  { value: 'PDF', label: 'PDF', icon: 'print' },
  { value: 'EXCEL', label: 'Excel', icon: 'grid' },
  { value: 'CSV', label: 'CSV', icon: 'download' },
];

export function DocExport({
  open,
  onClose,
  documentKind = 'Document',
  documentTitle,
  companyName,
  preview,
  onPreview,
  onDownload,
  onShare,
}: DocExportProps) {
  const [format, setFormat] = React.useState('PDF');
  const [template, setTemplate] = React.useState('Standard invoice');
  const [paperSize, setPaperSize] = React.useState('A4');
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>('portrait');
  const [includeAttachments, setIncludeAttachments] = React.useState(false);
  const [watermark, setWatermark] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="erp-dialog-backdrop fixed inset-0 z-[1200] flex items-center justify-center bg-[rgb(9_15_32/55%)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-export-title"
        className="erp-dialog-panel erp-card w-full max-w-2xl overflow-hidden"
        style={{ boxShadow: 'var(--erp-shadow-lg)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--erp-border)] px-5 py-4">
          <div>
            <h2
              id="doc-export-title"
              className="text-base font-semibold text-[var(--erp-fg-strong)]"
            >
              Print / Export / Share
            </h2>
            <p className="mt-0.5 text-xs text-[var(--erp-muted)]">
              Choose format, template and orientation for {documentTitle}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export dialog"
            className="rounded-lg p-1.5 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)]"
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col md:flex-row">
          {/* Document preview thumbnail */}
          <div className="flex w-full flex-1 flex-col overflow-hidden border-r border-[var(--erp-border)]">
            <div className="flex items-center justify-between border-b border-[var(--erp-border)] px-4 py-2.5">
              <span className="text-xs font-medium text-[var(--erp-muted)]">Document preview</span>
              {preview ? (
                <span className="text-[10px] uppercase tracking-wide text-[var(--erp-muted)]">
                  {preview.documentNo}
                </span>
              ) : null}
            </div>
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="w-full max-w-[220px] rounded-lg border border-[var(--erp-border)] bg-white p-3 shadow-[var(--erp-shadow-sm)]">
                <div className="rounded border border-[var(--erp-border)] bg-[var(--erp-surface-alt)] p-2 text-center text-[10px] text-[var(--erp-muted)]">
                  <Icon name="documentExport" size={14} />
                </div>
                <table className="mt-2 w-full border-collapse text-[10px]">
                  <tbody>
                    <tr>
                      <td className="border-b border-[var(--erp-border)] pr-2 text-left align-top">
                        {preview?.partyName ?? documentTitle}
                      </td>
                      <td className="border-b border-[var(--erp-border)] text-right align-top">
                        {preview?.total ?? ''}
                      </td>
                    </tr>
                    {preview?.meta?.map((line) => (
                      <tr key={line}>
                        <td className="border-b border-[var(--erp-border)] pr-2 text-left">
                          {line}
                        </td>
                        <td className="border-b border-[var(--erp-border)] text-right" />
                      </tr>
                    ))}
                    <tr>
                      <td className="pr-2 text-left" />
                      <td className="text-right">
                        {preview?.lineCount !== undefined
                          ? `${String(preview.lineCount)} item${preview.lineCount === 1 ? '' : 's'}`
                          : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="mt-2 border-t border-[var(--erp-border)] pt-2 text-[10px] text-right text-[var(--erp-muted)]">
                  {template} · {paperSize} {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                </div>
              </div>
            </div>
          </div>

          {/* Export options */}
          <div className="flex flex-1 flex-col overflow-y-auto p-5">
            <div className="mb-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--erp-muted)]">
                {documentKind} · {documentTitle}
              </p>
              <p className="text-xs text-[var(--erp-muted)]">{companyName}</p>
            </div>

            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-[var(--erp-muted)]">Output format</p>
                <div className="flex flex-wrap gap-2">
                  {OUTPUT_FORMATS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={format === option.value}
                      onClick={() => {
                        setFormat(option.value);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        format === option.value
                          ? 'border-[var(--erp-primary)] bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]'
                          : 'border-[var(--erp-border)] erp-frost text-[var(--erp-fg)] hover:border-[var(--erp-border-strong)]'
                      }`}
                    >
                      <Icon name={option.icon} size={13} />
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--erp-muted)]">
                  {format === 'PDF'
                    ? 'PDF is produced with your browser print dialog (choose “Save as PDF”).'
                    : format === 'EXCEL'
                      ? 'Downloads an Excel-compatible spreadsheet.'
                      : 'Downloads comma-separated values.'}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="erp-field-label">Template</label>
                  <select
                    className="erp-select"
                    value={template}
                    onChange={(event) => {
                      setTemplate(event.target.value);
                    }}
                  >
                    <option>Standard invoice</option>
                    <option>Tax invoice</option>
                    <option>Pro forma</option>
                  </select>
                </div>
                <div>
                  <label className="erp-field-label">Paper size</label>
                  <select
                    className="erp-select"
                    value={paperSize}
                    onChange={(event) => {
                      setPaperSize(event.target.value);
                    }}
                  >
                    <option value="A4">A4</option>
                    <option value="Letter">Letter</option>
                    <option value="Legal">Legal</option>
                  </select>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-[var(--erp-muted)]">Orientation</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-pressed={orientation === 'portrait'}
                    onClick={() => {
                      setOrientation('portrait');
                    }}
                    className={`flex items-center gap-2 border px-3 py-1.5 text-xs font-medium transition ${
                      orientation === 'portrait'
                        ? 'border-[var(--erp-primary)] bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]'
                        : 'border-[var(--erp-border)] erp-frost text-[var(--erp-fg)] hover:border-[var(--erp-border-strong)]'
                    }`}
                  >
                    <span className="flex h-6 w-8 items-center justify-center text-[10px]">P</span>
                    Portrait
                  </button>
                  <button
                    type="button"
                    aria-pressed={orientation === 'landscape'}
                    onClick={() => {
                      setOrientation('landscape');
                    }}
                    className={`flex items-center gap-2 border px-3 py-1.5 text-xs font-medium transition ${
                      orientation === 'landscape'
                        ? 'border-[var(--erp-primary)] bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]'
                        : 'border-[var(--erp-border)] erp-frost text-[var(--erp-fg)] hover:border-[var(--erp-border-strong)]'
                    }`}
                  >
                    <span className="flex h-8 w-6 items-center justify-center text-[10px]">L</span>
                    Landscape
                  </button>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-[var(--erp-muted)]">Options</legend>
                <label className="flex items-center gap-2 text-xs text-[var(--erp-fg)]">
                  <input
                    type="checkbox"
                    className="erp-checkbox"
                    checked={includeAttachments}
                    onChange={(event) => {
                      setIncludeAttachments(event.target.checked);
                    }}
                  />
                  Include attachments
                </label>
                <label className="flex items-center gap-2 text-xs text-[var(--erp-fg)]">
                  <input
                    type="checkbox"
                    className="erp-checkbox"
                    checked={watermark}
                    onChange={(event) => {
                      setWatermark(event.target.checked);
                    }}
                  />
                  Watermark
                </label>
              </fieldset>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--erp-border)] bg-[var(--erp-surface-alt)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--erp-border)] px-3.5 py-2 text-xs font-medium text-[var(--erp-fg)] hover:bg-[var(--erp-surface)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPreview}
            className="rounded-lg border border-[var(--erp-border)] px-3.5 py-2 text-xs font-medium text-[var(--erp-fg)] hover:bg-[var(--erp-surface)]"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => {
              onDownload(format);
            }}
            className="rounded-lg border border-[var(--erp-border)] px-3.5 py-2 text-xs font-medium text-[var(--erp-fg)] hover:bg-[var(--erp-surface)]"
          >
            Download
          </button>
          <button
            type="button"
            onClick={onShare}
            className="rounded-lg bg-[var(--erp-primary)] px-3.5 py-2 text-xs font-medium text-[var(--erp-primary-fg)] hover:bg-[var(--erp-primary-hover)]"
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
