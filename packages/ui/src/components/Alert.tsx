import React from 'react';

export type AlertTone = 'error' | 'warning' | 'success' | 'info';

const toneClasses: Record<AlertTone, string> = {
  error: 'text-[var(--erp-danger)] bg-[var(--erp-danger-bg)] ring-[var(--erp-danger)]/15',
  warning: 'text-[var(--erp-warning)] bg-[var(--erp-warning-bg)] ring-[var(--erp-warning)]/15',
  success: 'text-[var(--erp-success)] bg-[var(--erp-success-bg)] ring-[var(--erp-success)]/15',
  info: 'text-[var(--erp-info)] bg-[var(--erp-info-bg)] ring-[var(--erp-info)]/15',
};

const TONE_GLYPH: Record<AlertTone, string> = {
  error: '✕',
  warning: '▲',
  success: '✓',
  info: 'ℹ',
};

export interface AlertProps {
  tone: AlertTone;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function Alert({ tone, title, children, action }: AlertProps) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${toneClasses[tone]}`}
    >
      <span aria-hidden="true" className="mt-0.5 text-[0.6875rem] font-bold">
        {TONE_GLYPH[tone]}
      </span>
      <div className="flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
