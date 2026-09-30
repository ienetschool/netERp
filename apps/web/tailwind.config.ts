import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--erp-bg)',
        surface: 'var(--erp-surface)',
        'surface-alt': 'var(--erp-surface-alt)',
        fg: 'var(--erp-fg)',
        muted: 'var(--erp-muted)',
        border: 'var(--erp-border)',
        primary: 'var(--erp-primary)',
        'primary-fg': 'var(--erp-primary-fg)',
        success: 'var(--erp-success)',
        warning: 'var(--erp-warning)',
        danger: 'var(--erp-danger)',
        info: 'var(--erp-info)',
      },
    },
  },
  plugins: [],
};

export default config;
