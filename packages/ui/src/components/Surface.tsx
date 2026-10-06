import React from 'react';
import { Icon, type IconName } from './Icon.js';

/**
 * Surface primitives. Every module composes these instead of hand-rolled
 * divs so a token change lands everywhere at once.
 */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ padded = false, className = '', ...rest }: CardProps) {
  return <div className={`erp-card ${padded ? 'erp-card-pad' : ''} ${className}`} {...rest} />;
}

export interface CardHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  icon?: IconName;
}

export function CardHeader({ title, subtitle, action, icon }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--erp-border)] px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]">
            <Icon name={icon} size={15} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="erp-panel-title truncate">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-[var(--erp-muted)]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--erp-surface-sunken)] text-[var(--erp-muted)]',
  info: 'bg-[var(--erp-info-bg)] text-[var(--erp-info)]',
  success: 'bg-[var(--erp-success-bg)] text-[var(--erp-success)]',
  warning: 'bg-[var(--erp-warning-bg)] text-[var(--erp-warning)]',
  danger: 'bg-[var(--erp-danger-bg)] text-[var(--erp-danger)]',
  primary: 'bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]',
};

export interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}

export function Badge({ children, tone = 'neutral', dot = false, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold ${BADGE_TONES[tone]} ${className}`}
    >
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** Count bubble used by the sidebar and notification bell. */
export function CountBubble({ value, className = '' }: { value: number; className?: string }) {
  if (value <= 0) return null;
  return (
    <span
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--erp-danger)] px-1.5 py-0.5 text-[0.625rem] font-bold leading-none text-white ${className}`}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}

export interface TabsProps {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <div role="tablist" className={`flex items-center gap-1 overflow-x-auto ${className}`}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            onClick={() => {
              onChange(tab.id);
            }}
            className={`shrink-0 border-b-2 px-3.5 py-2.5 text-[0.8125rem] font-medium transition ${
              selected
                ? 'border-[var(--erp-primary)] text-[var(--erp-primary)]'
                : 'border-transparent text-[var(--erp-muted)] hover:text-[var(--erp-fg)]'
            }`}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="ml-1.5 rounded-full bg-[var(--erp-surface-sunken)] px-1.5 py-0.5 text-[0.625rem] font-semibold">
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- form fields */

export interface FieldProps {
  label: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  required = false,
  hint,
  error,
  htmlFor,
  className = '',
  children,
}: FieldProps) {
  return (
    <div className={className}>
      <label className="erp-field-label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-[var(--erp-danger)]">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="erp-field-hint text-[var(--erp-danger)]">{error}</p>
      ) : hint ? (
        <p className="erp-field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={`erp-input ${className}`} {...rest} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = '', children, ...rest }, ref) {
  return (
    <select ref={ref} className={`erp-select ${className}`} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`erp-textarea ${className}`} {...rest} />;
});

/** Compact filter select used by the list toolbars. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="erp-select appearance-none py-2 pl-3 pr-9 text-[0.8125rem]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]"
      >
        <Icon name="chevronDown" size={15} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ overlays */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel. */
  width?: string;
}

/**
 * Dialog built on the native element so focus trapping and Escape handling
 * come from the platform rather than a hand-rolled key handler.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = 'max-w-lg',
}: ModalProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="erp-dialog-backdrop fixed inset-0 z-[1200] flex items-center justify-center bg-[rgb(9_15_32/55%)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`erp-dialog-panel erp-card w-full ${width} overflow-hidden`}
        style={{ boxShadow: 'var(--erp-shadow-lg)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--erp-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--erp-fg-strong)]">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[0.8125rem] text-[var(--erp-muted)]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="rounded-lg p-1.5 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)]"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--erp-border)] bg-[var(--erp-surface-alt)] px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  tone?: 'default' | 'danger';
}

/** Row-actions menu ("…") used by the data tables. */
export function RowActionsMenu({
  label = 'Row actions',
  items,
}: {
  label?: string;
  items: MenuItem[];
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="rounded-lg p-1.5 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-sunken)] hover:text-[var(--erp-fg)]"
      >
        <Icon name="more" size={17} />
      </button>
      {open ? (
        <div
          role="menu"
          className="erp-popover absolute right-0 z-[1000] mt-1 w-48 overflow-hidden rounded-xl border border-[var(--erp-border)] bg-[var(--erp-surface)] py-1"
          style={{ boxShadow: 'var(--erp-shadow-lg)' }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[0.8125rem] transition hover:bg-[var(--erp-surface-alt)] ${
                item.tone === 'danger' ? 'text-[var(--erp-danger)]' : 'text-[var(--erp-fg)]'
              }`}
            >
              {item.icon ? <Icon name={item.icon} size={15} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- indicators */

export function ProgressBar({
  value,
  max = 100,
  tone = 'primary',
}: {
  value: number;
  max?: number;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const bar =
    tone === 'success'
      ? 'var(--erp-success)'
      : tone === 'warning'
        ? 'var(--erp-warning)'
        : tone === 'danger'
          ? 'var(--erp-danger)'
          : 'var(--erp-primary)';
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--erp-surface-sunken)]"
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bar }} />
    </div>
  );
}

/** Numbered stepper used by the multi-step create forms. */
export function StepIndicator({
  steps,
  current,
}: {
  steps: Array<{ id: string; label: string }>;
  current: string;
}) {
  const activeIndex = steps.findIndex((step) => step.id === current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((step, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'todo';
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[0.6875rem] font-bold ${
                state === 'todo'
                  ? 'bg-[var(--erp-surface-sunken)] text-[var(--erp-muted)]'
                  : state === 'current'
                    ? 'bg-[var(--erp-primary)] text-white'
                    : 'bg-[var(--erp-success-bg)] text-[var(--erp-success)]'
              }`}
            >
              {state === 'done' ? <Icon name="check" size={13} /> : index + 1}
            </span>
            <span
              className={`text-[0.8125rem] ${
                state === 'current'
                  ? 'font-semibold text-[var(--erp-fg)]'
                  : 'text-[var(--erp-muted)]'
              }`}
            >
              {step.label}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="h-px w-5 bg-[var(--erp-border-strong)]" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ toolbars */

/**
 * Filter toolbar for the list pages: search field, filter selects, right-aligned
 * bulk actions. Sits directly above a `DataTable`.
 */
export function FilterBar({
  children,
  right,
  className = '',
}: {
  children?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2.5 border-b border-[var(--erp-border)] px-4 py-3 ${className}`}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2.5">{children}</div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

/** Pill search input used inside a `FilterBar` and in the list headers. */
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]"
      >
        <Icon name="search" size={15} />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="erp-input py-2 pl-9 pr-3 text-[0.8125rem]"
        style={{ minWidth: '13rem' }}
      />
    </div>
  );
}
