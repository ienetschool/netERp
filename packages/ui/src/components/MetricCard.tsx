import { Icon, type IconName } from './Icon.js';

export interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  href?: string;
  /** Small glyph tile in the top-left, as on the reference dashboard. */
  icon?: IconName;
  /** Percentage change with direction, rendered as "▲ 12.5% vs last month". */
  trend?: { value: number; label?: string };
}

const TONE_TEXT: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-[var(--erp-fg-strong)]',
  success: 'text-[var(--erp-success)]',
  warning: 'text-[var(--erp-warning)]',
  danger: 'text-[var(--erp-danger)]',
};

export function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
  href,
  icon,
  trend,
}: MetricCardProps) {
  const body = (
    <div className="erp-card group p-4 transition hover:border-[var(--erp-border-strong)] hover:shadow-[var(--erp-shadow-md)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-[var(--erp-muted)]">{label}</p>
        {icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <p className={`mt-2 text-[1.375rem] font-bold tracking-tight ${TONE_TEXT[tone]}`}>{value}</p>
      {trend ? (
        <p
          className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${
            trend.value >= 0 ? 'text-[var(--erp-success)]' : 'text-[var(--erp-danger)]'
          }`}
        >
          <Icon name={trend.value >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />
          {Math.abs(trend.value).toFixed(1)}%
          {trend.label ? (
            <span className="font-normal text-[var(--erp-muted)]">{trend.label}</span>
          ) : null}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-[var(--erp-muted)]">{hint}</p>
      ) : null}
    </div>
  );

  return href ? (
    <a
      href={href}
      className="block rounded-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-primary)]"
    >
      {body}
    </a>
  ) : (
    body
  );
}
