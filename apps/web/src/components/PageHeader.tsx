'use client';

import { Icon } from '@erp/ui';

/**
 * Page header used by every module list. The API keeps titles plain so the
 * header owns layout: breadcrumb trail, title, subtitle and the action row.
 */
export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Optional segment shown above the title, e.g. "Procurement › Purchase Orders". */
  trail?: string[];
}

export function PageHeader({ title, description, actions, trail }: PageHeaderProps) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {trail && trail.length > 0 ? (
          <p className="mb-1 flex items-center gap-1 text-xs text-[var(--erp-muted)]">
            {trail.map((segment, index) => (
              <span key={segment} className="flex items-center gap-1">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-[var(--erp-muted-soft)]">
                    <Icon name="chevronRight" size={12} />
                  </span>
                ) : null}
                {segment}
              </span>
            ))}
          </p>
        ) : null}
        <h1 className="text-xl font-bold tracking-tight text-[var(--erp-fg-strong)]">{title}</h1>
        {description ? (
          <p className="mt-1 text-[0.8125rem] text-[var(--erp-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
