'use client';

import React from 'react';
import { Icon } from '@erp/ui';

export interface FeaturePill {
  label: string;
}

interface ModernERPCardProps {
  onExplore: () => void;
}

const FEATURE_PILLS: FeaturePill[] = [
  { label: 'One Platform' },
  { label: 'All Modules' },
  { label: 'Complete ERP' },
];

const FEATURES = [
  { label: 'Unified Design System', detail: 'Consistent look & feel across all modules' },
  { label: 'Smart Search & Filters', detail: 'Find what you need, faster' },
  { label: 'Powerful Workflows', detail: 'Approvals, notifications & automation' },
  { label: 'Insights & Analytics', detail: 'Data-driven decisions' },
  { label: 'Secure & Auditable', detail: 'Full traceability and compliance' },
  { label: 'Mobile Ready', detail: 'Work from anywhere' },
  { label: 'Export & Share', detail: 'PDF, Excel, WhatsApp, Email, QR & more' },
];

export function ModernERPCard({ onExplore }: ModernERPCardProps) {
  return (
    <section
      aria-label="Modern ERP experience"
      className="rounded-xl border border-[var(--erp-border)] erp-frost p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[1.125rem] font-bold tracking-tight text-[var(--erp-fg-strong)]">
            Modern ERP Experience
          </h2>
          <p className="mt-1 text-sm text-[var(--erp-muted)]">
            One platform for finance, procurement, sales, HR, payroll and beyond.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {FEATURE_PILLS.map((pill, index) => (
            <span
              key={index}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                index < FEATURE_PILLS.length - 1
                  ? 'border-[var(--erp-border)] bg-[var(--erp-surface-alt)] text-[var(--erp-fg)]'
                  : 'border-[var(--erp-primary)] bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]'
              }`}
            >
              {pill.label}
            </span>
          ))}
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {FEATURES.map((feature, index) => (
          <li key={index} className="flex items-start gap-2.5 text-sm text-[var(--erp-fg)]">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]">
              <Icon name="check" size={10} />
            </span>
            <span>
              <span className="font-medium">{feature.label}</span>
              {' — '}
              {feature.detail}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--erp-border)] pt-4">
        <a
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onExplore();
          }}
          className="rounded-lg bg-[var(--erp-primary)] px-4 py-2 text-xs font-semibold text-[var(--erp-primary-fg)] hover:bg-[var(--erp-primary-hover)]"
        >
          Explore the platform
        </a>
        <div className="flex items-center gap-2 text-xs text-[var(--erp-muted)]">
          <Icon name="qrCode" size={14} />
          <span>Scan to walk through the demo</span>
          <Icon name="externalLink" size={12} className="ml-1" />
        </div>
      </div>
    </section>
  );
}
