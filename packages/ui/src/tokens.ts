/**
 * Design tokens — UI-UX.md §42. Feature code composes these instead of
 * hard-coded visual values.
 */
export const tokens = {
  color: {
    background: 'var(--erp-bg)',
    surface: 'var(--erp-surface)',
    surfaceAlt: 'var(--erp-surface-alt)',
    surfaceSunken: 'var(--erp-surface-sunken)',
    foreground: 'var(--erp-fg)',
    foregroundStrong: 'var(--erp-fg-strong)',
    muted: 'var(--erp-muted)',
    border: 'var(--erp-border)',
    borderStrong: 'var(--erp-border-strong)',
    primary: 'var(--erp-primary)',
    primaryHover: 'var(--erp-primary-hover)',
    primarySoft: 'var(--erp-primary-soft)',
    primaryForeground: 'var(--erp-primary-fg)',
    nav: 'var(--erp-nav)',
    navHover: 'var(--erp-nav-hover)',
    navActive: 'var(--erp-nav-active)',
    success: 'var(--erp-success)',
    warning: 'var(--erp-warning)',
    danger: 'var(--erp-danger)',
    info: 'var(--erp-info)',
  },
  spacing: [0, 2, 4, 8, 12, 16, 24, 32, 48, 64],
  radius: {
    none: '0',
    sm: '6px',
    md: '8px',
    lg: '10px',
    xl: '12px',
    full: '9999px',
  },
  elevation: {
    xs: 'var(--erp-shadow-xs)',
    sm: 'var(--erp-shadow-sm)',
    md: 'var(--erp-shadow-md)',
    lg: 'var(--erp-shadow-lg)',
  },
  layout: {
    sidebarWidth: 'var(--erp-sidebar-width)',
    headerHeight: '3.5rem',
  },
  controlHeight: {
    sm: '32px',
    md: '38px',
    lg: '44px',
  },
  typography: {
    display: 'text-2xl font-bold tracking-tight',
    pageTitle: 'text-xl font-bold tracking-tight',
    sectionTitle: 'text-[0.9375rem] font-semibold tracking-tight',
    body: 'text-sm',
    label: 'text-xs font-medium text-[var(--erp-muted)]',
    caption: 'text-xs',
    table: 'text-[0.8125rem]',
  },
  zIndex: {
    base: 0,
    dropdown: 1000,
    drawer: 1100,
    dialog: 1200,
    toast: 1300,
  },
} as const;
