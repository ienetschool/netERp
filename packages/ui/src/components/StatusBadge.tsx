export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral:
    'bg-[var(--erp-surface-sunken)] text-[var(--erp-muted)] ring-1 ring-inset ring-[var(--erp-border)]',
  info: 'bg-[var(--erp-info-bg)] text-[var(--erp-info)] ring-1 ring-inset ring-[var(--erp-info)]/20',
  success:
    'bg-[var(--erp-success-bg)] text-[var(--erp-success)] ring-1 ring-inset ring-[var(--erp-success)]/20',
  warning:
    'bg-[var(--erp-warning-bg)] text-[var(--erp-warning)] ring-1 ring-inset ring-[var(--erp-warning)]/20',
  danger:
    'bg-[var(--erp-danger-bg)] text-[var(--erp-danger)] ring-1 ring-inset ring-[var(--erp-danger)]/20',
};

export interface StatusBadgeProps {
  status: string;
  tone?: StatusTone;
}

/** Maps common ERP statuses to semantic tones (UI-UX §11). */
export function toneForStatus(status: string): StatusTone {
  const s = status.toUpperCase();
  if (
    [
      'APPROVED',
      'POSTED',
      'PAID',
      'ACTIVE',
      'SENT',
      'OPEN',
      'PRESENT',
      'DELIVERED',
      'RECEIVED',
      'ISSUED',
      'COMPLETED',
      'AVAILABLE',
      'CONFIRMED',
    ].includes(s)
  )
    return 'success';
  if (
    [
      'SUBMITTED',
      'PENDING_APPROVAL',
      'UNDER_REVIEW',
      'CALCULATED',
      'PROCESSING',
      'CLOSING',
      'IN_PROGRESS',
      'INVOICED',
      'PENDING',
      'UNREAD',
    ].includes(s)
  )
    return 'info';
  if (
    [
      'CHANGES_REQUESTED',
      'PARTIALLY_PAID',
      'LATE',
      'HALF_DAY',
      'ON_LEAVE',
      'SUSPENDED',
      'DRAFT',
      'REVERSED',
    ].includes(s)
  )
    return 'warning';
  if (
    [
      'REJECTED',
      'CANCELLED',
      'FAILED',
      'OVERDUE',
      'TERMINATED',
      'LOCKED',
      'DISABLED',
      'EXPIRED',
    ].includes(s)
  )
    return 'danger';
  return 'neutral';
}

export function StatusBadge({ status, tone }: StatusBadgeProps) {
  const resolvedTone = tone ?? toneForStatus(status);
  const label = status.replaceAll('_', ' ').toLowerCase();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${TONE_CLASSES[resolvedTone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      <span className="capitalize">{label}</span>
    </span>
  );
}
