import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  leadingIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--erp-primary)] text-[var(--erp-primary-fg)] shadow-[var(--erp-shadow-xs)] hover:bg-[var(--erp-primary-hover)]',
  secondary:
    'bg-[var(--erp-surface)] text-[var(--erp-fg)] border border-[var(--erp-border-strong)] shadow-[var(--erp-shadow-xs)] hover:bg-[var(--erp-surface-alt)]',
  danger: 'bg-[var(--erp-danger)] text-white hover:opacity-90',
  ghost: 'text-[var(--erp-muted)] hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)]',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] rounded-lg',
  md: 'h-9 px-3.5 text-[0.8125rem] rounded-[10px]',
  lg: 'h-11 px-5 text-sm rounded-xl',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`inline-flex items-center justify-center gap-1.5 font-semibold transition
        disabled:cursor-not-allowed disabled:opacity-50
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        focus-visible:outline-[var(--erp-primary)] ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        leadingIcon
      )}
      {children}
    </button>
  );
});
