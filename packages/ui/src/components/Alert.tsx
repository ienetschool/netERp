import React from 'react';

export type AlertTone = 'error' | 'warning' | 'success' | 'info';

const toneClasses: Record<AlertTone, string> = {
  error:
    'border-[var(--erp-danger)] text-[var(--erp-danger)] bg-[var(--erp-danger-bg,rgba(239,68,68,0.08))]',
  warning:
    'border-[var(--erp-warning)] text-[var(--erp-warning)] bg-[var(--erp-warning-bg,rgba(234,179,8,0.08))]',
  success:
    'border-[var(--erp-success)] text-[var(--erp-success)] bg-[var(--erp-success-bg,rgba(34,197,94,0.08))]',
  info: 'border-[var(--erp-info)] text-[var(--erp-info)] bg-[var(--erp-info-bg,rgba(59,130,246,0.08))]',
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
    <div role="alert" className={`rounded-md border px-4 py-3 text-sm ${toneClasses[tone]}`}>
      <div className="flex items-start gap-2">
        <span aria-hidden="true">{TONE_GLYPH[tone]}</span>
        <div className="flex-1">
          {title ? <p className="font-medium">{title}</p> : null}
          <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
