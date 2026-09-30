export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_LABELS: Record<StatusTone, string> = {
  neutral: '●',
  info: '◆',
  success: '✓',
  warning: '▲',
  danger: '✕',
};

const toneClasses: Record<StatusTone, string> = {
  neutral: 'bg-[var(--erp-surface-alt)] text-[var(--erp-muted)] border-[var(--erp-border)]',
  info: 'bg-[var(--erp-info-bg,rgba(59,130,246,0.12))] text-[var(--erp-info)] border-[var(--erp-info)]',
  success:
    'bg-[var(--erp-success-bg,rgba(34,197,94,0.12))] text-[var(--erp-success)] border-[var(--erp-success)]',
  warning:
    'bg-[var(--erp-warning-bg,rgba(234,179,8,0.12))] text-[var(--erp-warning)] border-[var(--erp-warning)]',
  danger:
    'bg-[var(--erp-danger-bg,rgba(239,68,68,0.12))] text-[var(--erp-danger)] border-[var(--erp-danger)]',
};

export interface StatusBadgeProps {
  status: string;
  tone?: StatusTone;
}

/** Maps common ERP statuses to semantic tones (UI-UX §11). */
export function toneForStatus(status: string): StatusTone {
  const s = status.toUpperCase();
  if (['APPROVED', 'POSTED', 'PAID', 'ACTIVE', 'SENT', 'OPEN', 'PRESENT'].includes(s))
    return 'success';
  if (
    [
      'SUBMITTED',
      'PENDING_APPROVAL',
      'UNDER_REVIEW',
      'CALCULATED',
      'PROCESSING',
      'CLOSING',
    ].includes(s)
  )
    return 'info';
  if (
    ['CHANGES_REQUESTED', 'PARTIALLY_PAID', 'LATE', 'HALF_DAY', 'ON_LEAVE', 'SUSPENDED'].includes(s)
  )
    return 'warning';
  if (
    ['REJECTED', 'CANCELLED', 'FAILED', 'OVERDUE', 'TERMINATED', 'LOCKED', 'DISABLED'].includes(s)
  )
    return 'danger';
  return 'neutral';
}

export function StatusBadge({ status, tone }: StatusBadgeProps) {
  const resolvedTone = tone ?? toneForStatus(status);
  const label = status.replaceAll('_', ' ').toLowerCase();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses[resolvedTone]}`}
    >
      <span aria-hidden="true">{TONE_LABELS[resolvedTone]}</span>
      <span className="capitalize">{label}</span>
    </span>
  );
}
