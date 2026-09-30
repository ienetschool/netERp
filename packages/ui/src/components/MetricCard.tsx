export interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  href?: string;
}

export function MetricCard({ label, value, hint, tone = 'default', href }: MetricCardProps) {
  const toneClass =
    tone === 'danger'
      ? 'text-[var(--erp-danger)]'
      : tone === 'warning'
        ? 'text-[var(--erp-warning)]'
        : tone === 'success'
          ? 'text-[var(--erp-success)]'
          : 'text-[var(--erp-fg)]';

  const body = (
    <div className="rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 transition hover:border-[var(--erp-primary)]">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--erp-muted)]">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--erp-muted)]">{hint}</p> : null}
    </div>
  );

  return href ? (
    <a
      href={href}
      className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--erp-primary)] rounded-lg"
    >
      {body}
    </a>
  ) : (
    body
  );
}
