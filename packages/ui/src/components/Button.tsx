import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--erp-primary)] text-[var(--erp-primary-fg)] hover:opacity-90',
  secondary:
    'bg-[var(--erp-surface-alt)] text-[var(--erp-fg)] border border-[var(--erp-border)] hover:bg-[var(--erp-surface)]',
  danger: 'bg-[var(--erp-danger)] text-white hover:opacity-90',
  ghost: 'text-[var(--erp-fg)] hover:bg-[var(--erp-surface-alt)]',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, disabled, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition
        h-[38px] disabled:cursor-not-allowed disabled:opacity-50
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-[var(--erp-primary)] ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
