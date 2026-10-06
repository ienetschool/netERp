'use client';

import React from 'react';
import { Icon } from '@erp/ui';

interface SendWhatsAppDialogProps {
  open: boolean;
  onClose: () => void;
  phoneNumber: string;
  message: string;
  onPhoneChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  includePdf: boolean;
  onIncludePdfChange: (value: boolean) => void;
  onSend: () => void;
  pending?: boolean;
}

export function SendWhatsAppDialog({
  open,
  onClose,
  phoneNumber,
  message,
  onPhoneChange,
  onMessageChange,
  includePdf,
  onIncludePdfChange,
  onSend,
  pending = false,
}: SendWhatsAppDialogProps) {
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

  const maxChars = 300;
  const usedChars = message.length;

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
        aria-labelledby="whatsapp-title"
        className="erp-dialog-panel erp-card w-full max-w-md overflow-hidden"
        style={{ boxShadow: 'var(--erp-shadow-lg)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--erp-border)] px-5 py-4">
          <div>
            <h2 id="whatsapp-title" className="text-base font-semibold text-[var(--erp-fg-strong)]">
              Send via WhatsApp
            </h2>
            <p className="mt-0.5 text-xs text-[var(--erp-muted)]">
              Share a message and attach the invoice if needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close WhatsApp dialog"
            className="rounded-lg p-1.5 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)]"
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="wa-phone" className="erp-field-label">
              Phone Number
            </label>
            <input
              id="wa-phone"
              type="tel"
              className="erp-input"
              value={phoneNumber}
              onChange={(event) => {
                onPhoneChange(event.target.value);
              }}
              placeholder="+1 234 567 8900"
            />
          </div>

          <div>
            <label htmlFor="wa-message" className="erp-field-label">
              Message
            </label>
            <textarea
              id="wa-message"
              className="erp-textarea"
              value={message}
              onChange={(event) => {
                onMessageChange(event.target.value);
              }}
              placeholder="Write your message…"
              rows={4}
            />
            <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--erp-muted)]">
              <span>Personalize your message</span>
              <span className="font-medium text-[var(--erp-fg)]">
                {usedChars} / {maxChars}
              </span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--erp-fg)]">
            <input
              type="checkbox"
              className="erp-checkbox"
              checked={includePdf}
              onChange={(event) => {
                onIncludePdfChange(event.target.checked);
              }}
            />
            Include PDF attachment
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--erp-border)] bg-[var(--erp-surface-alt)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--erp-border)] px-3.5 py-2 text-xs font-medium text-[var(--erp-fg)] hover:bg-[var(--erp-surface)]"
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={pending || phoneNumber.trim().length === 0}
            className="rounded-lg bg-[var(--erp-primary)] px-3.5 py-2 text-xs font-medium text-[var(--erp-primary-fg)] hover:bg-[var(--erp-primary-hover)] disabled:opacity-50"
          >
            {pending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
