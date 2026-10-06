'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@erp/ui';

interface PrintPreviewProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Full-screen print preview.
 *
 * The sheet is rendered through a portal onto <body> so that while the preview
 * is open, print CSS can hide every other body child and lay the document out
 * alone on the page. The `erp-print-active` marker on <body> scopes that rule,
 * so a plain Ctrl+P outside the preview still prints the page normally.
 */
export function PrintPreview({ open, title, onClose, children }: PrintPreviewProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    document.body.classList.add('erp-print-active');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('erp-print-active');
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Print preview: ${title}`}
      className="erp-print-portal erp-page-enter fixed inset-0 z-[1300] flex flex-col bg-[rgb(9_15_32/60%)]"
    >
      <div className="erp-print-chrome flex items-center justify-between gap-3 border-b border-[var(--erp-border)] bg-[var(--erp-surface)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="documentExport" size={16} className="shrink-0 text-[var(--erp-primary)]" />
          <span className="truncate text-sm font-medium text-[var(--erp-fg-strong)]">{title}</span>
          <span className="hidden text-xs text-[var(--erp-muted)] sm:inline">Print preview</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              window.print();
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--erp-primary)] px-3.5 py-2 text-xs font-medium text-[var(--erp-primary-fg)] transition hover:bg-[var(--erp-primary-hover)]"
          >
            <Icon name="print" size={14} />
            Print / Save as PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close print preview"
            className="rounded-lg p-1.5 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)]"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      </div>

      <div className="erp-print-scroll flex-1 overflow-auto p-4 sm:p-8">
        <div className="erp-print-sheet mx-auto max-w-[820px] rounded-xl bg-white p-6 text-[#111827] shadow-2xl sm:p-10">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
