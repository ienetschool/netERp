/**
 * Design tokens — UI-UX.md §42. Feature code composes these instead of
 * hard-coded visual values.
 */
export const tokens = {
  color: {
    background: 'var(--erp-bg)',
    surface: 'var(--erp-surface)',
    surfaceAlt: 'var(--erp-surface-alt)',
    foreground: 'var(--erp-fg)',
    muted: 'var(--erp-muted)',
    border: 'var(--erp-border)',
    primary: 'var(--erp-primary)',
    primaryForeground: 'var(--erp-primary-fg)',
    success: 'var(--erp-success)',
    warning: 'var(--erp-warning)',
    danger: 'var(--erp-danger)',
    info: 'var(--erp-info)',
  },
  spacing: [0, 2, 4, 8, 12, 16, 24, 32, 48, 64],
  radius: {
    none: '0',
    sm: '4px',
    md: '6px',
    lg: '10px',
    full: '9999px',
  },
  controlHeight: {
    sm: '32px',
    md: '38px',
    lg: '44px',
  },
  typography: {
    display: 'text-2xl font-semibold tracking-tight',
    pageTitle: 'text-xl font-semibold tracking-tight',
    sectionTitle: 'text-base font-semibold',
    body: 'text-sm',
    label: 'text-xs font-medium text-[var(--erp-muted)]',
    caption: 'text-xs',
    table: 'text-sm',
  },
  zIndex: {
    base: 0,
    dropdown: 1000,
    drawer: 1100,
    dialog: 1200,
    toast: 1300,
  },
} as const;
