'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Icon, type IconName } from '@erp/ui';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';

const loginFormSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginForm = z.infer<typeof loginFormSchema>;

/** Seeded demo accounts (packages/prisma/seed) — dev data only, password Admin123!. */
const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@demo.local', hint: 'Super admin' },
  { label: 'Manager', email: 'manager@demo.local', hint: 'Branch manager' },
  { label: 'Finance', email: 'finance@demo.local', hint: 'Payroll approver' },
] as const;

const DEMO_PASSWORD = 'Admin123!';

/**
 * Demo affordances (one-click sign-in, seeded credentials, the run.md hint) are
 * development conveniences. They must never appear in a production build, which
 * is what the marketing sign-in card is judged on.
 */
const SHOW_DEMO_ACCOUNTS = process.env.NODE_ENV !== 'production';

/** Key-module tiles, mirroring the icon strip on the reference sign-in card. */
const KEY_MODULES: Array<{ icon: IconName; label: string }> = [
  { icon: 'sales', label: 'Sales' },
  { icon: 'procurement', label: 'Purchase' },
  { icon: 'inventory', label: 'Inventory' },
  { icon: 'finance', label: 'Accounts' },
  { icon: 'hr', label: 'HR & Payroll' },
];

/** Avatar initials for the "customers already using" row. */
const AVATARS = ['AK', 'RM', 'SJ', 'TP', 'LN'];

interface DisplayError {
  title: string;
  message: string;
}

/**
 * Turns a failed sign-in into something the user can act on (UI-UX.md §52):
 * an unreachable backend must not surface as a bare HTTP status, and a bad
 * password must not read like an outage.
 */
function describeSignInError(error: unknown): DisplayError {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      return {
        title: 'Cannot reach the server',
        message:
          'The sign-in service is not responding. The API and database must be running — see .freebuff/run.md — then try again.',
      };
    }
    if (error.status === 401 || error.status === 400) {
      return { title: 'Sign in failed', message: 'Email or password is incorrect.' };
    }
    if (error.status === 429) {
      return { title: 'Too many attempts', message: 'Wait a moment before trying again.' };
    }
    return { title: 'Sign in failed', message: error.message };
  }
  if (error instanceof TypeError) {
    return {
      title: 'Cannot reach the server',
      message:
        'The request never reached the API. Check that the API and database are running (see .freebuff/run.md) and try again.',
    };
  }
  return {
    title: 'Sign in failed',
    message: error instanceof Error ? error.message : 'Unexpected error.',
  };
}

/** Small helper so staggered delays stay readable inline. */
function delay(ms: number): React.CSSProperties {
  return { '--erp-delay': `${ms}ms` } as React.CSSProperties;
}

/** Five filled stars — the reference card's customer-rating row. */
function Stars() {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label="Rated 5 out of 5">
      {Array.from({ length: 5 }, (_, index) => (
        <svg
          key={index}
          viewBox="0 0 24 24"
          width={15}
          height={15}
          fill="#f59e0b"
          aria-hidden="true"
          className="erp-fade"
          style={delay(420 + index * 60)}
        >
          <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95L12 2.6z" />
        </svg>
      ))}
    </span>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = React.useState<DisplayError | null>(null);
  const [demoPending, setDemoPending] = React.useState<string | null>(null);
  const [showResetHint, setShowResetHint] = React.useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
      router.push('/');
    } catch (e) {
      setServerError(describeSignInError(e));
    }
  });

  /** Autofills the form with a demo account and submits right away. */
  const signInAsDemo = async (email: string) => {
    setServerError(null);
    setDemoPending(email);
    setValue('email', email, { shouldValidate: true });
    setValue('password', DEMO_PASSWORD, { shouldValidate: true });
    try {
      await login(email, DEMO_PASSWORD);
      router.push('/');
    } catch (e) {
      setServerError(describeSignInError(e));
    } finally {
      setDemoPending(null);
    }
  };

  const busy = isSubmitting || demoPending !== null;

  return (
    <main className="erp-auth-backdrop erp-auth-light relative flex min-h-screen items-center justify-center overflow-hidden px-3 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      {/* Decorative blurred colour fields behind the glass card. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="erp-float absolute -left-24 -top-16 h-72 w-72 rounded-full bg-[#2563eb]/25 blur-3xl sm:h-96 sm:w-96" />
        <span className="erp-float-slow absolute -bottom-24 -right-20 h-80 w-80 rounded-full bg-[#7c3aed]/20 blur-3xl sm:h-[26rem] sm:w-[26rem]" />
        <span className="erp-float absolute right-1/4 top-1/4 h-56 w-56 rounded-full bg-[#0ea5e9]/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-[76rem]">
        <div
          className="erp-glass erp-fade grid overflow-hidden rounded-[1.25rem] shadow-[0_30px_80px_rgb(8_26_46/22%)] sm:rounded-[1.75rem] lg:grid-cols-[1.15fr_1fr]"
          style={delay(0)}
        >
          {/* ── Brand panel (desktop / tablet) ─────────────────────────── */}
          <section aria-label="About netERp" className="relative hidden flex-col lg:flex">
            {/* Blue masthead, echoing the reference card. */}
            <div className="relative overflow-hidden bg-[linear-gradient(142deg,#0b3aa8_0%,#1d4ed8_46%,#2563eb_100%)] px-10 pb-20 pt-10 text-white xl:px-12 xl:pb-24 xl:pt-12">
              <span
                aria-hidden="true"
                className="erp-float pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/15 blur-2xl"
              />
              <span
                aria-hidden="true"
                className="erp-float-slow pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-[#7c3aed]/35 blur-3xl"
              />

              <div className="erp-slide-left relative flex items-center gap-3" style={delay(80)}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-inset ring-white/30 backdrop-blur">
                  <Icon name="dashboard" size={24} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[1.375rem] font-extrabold leading-tight tracking-tight">
                    netERp
                  </p>
                  <p className="truncate text-xs text-white/75">Enterprise Resource Planning</p>
                </div>
              </div>

              <h2
                className="erp-slide-left relative mt-8 max-w-md text-[1.75rem] font-bold leading-snug tracking-tight xl:text-[2rem]"
                style={delay(160)}
              >
                Run your whole business from one workspace.
              </h2>
              <p
                className="erp-slide-left relative mt-3 max-w-md text-sm leading-relaxed text-white/80"
                style={delay(240)}
              >
                Finance, sales, procurement, inventory, HR and payroll in a single connected
                platform — built for day-to-day operations, not just reporting.
              </p>
              <p
                className="erp-slide-left relative mt-3 max-w-md text-sm leading-relaxed text-white/70"
                style={delay(300)}
              >
                From quotations and purchase orders to ledgers, approvals and payroll runs, netERp
                keeps every record linked, auditable and permission-aware.
              </p>
            </div>

            {/* Light lower panel that lifts over the masthead. */}
            <div className="erp-glass-panel relative -mt-12 flex flex-1 flex-col gap-7 px-10 pb-9 pt-7 xl:px-12">
              <div
                className="erp-glass-strong erp-rise rounded-2xl border border-[rgb(255_255_255/70%)] px-4 py-3.5"
                style={delay(360)}
              >
                <p className="text-[0.8125rem] font-semibold text-[var(--erp-fg-strong)]">
                  Customers Already Using netERp
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  <span className="flex -space-x-2.5">
                    {AVATARS.map((initials, index) => (
                      <span
                        key={initials}
                        className="erp-rise flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(140deg,var(--erp-primary),#7c3aed)] text-[0.625rem] font-bold text-white ring-2 ring-white"
                        style={delay(400 + index * 70)}
                      >
                        {initials}
                      </span>
                    ))}
                  </span>
                  <Stars />
                </div>
              </div>

              <div className="erp-rise" style={delay(520)}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--erp-muted)]">
                  Key Modules
                </p>
                <div className="mt-3 grid grid-cols-5 gap-2.5">
                  {KEY_MODULES.map((mod, index) => (
                    <span
                      key={mod.label}
                      className="erp-lift erp-rise flex flex-col items-center gap-1.5 rounded-xl border border-[var(--erp-border)] bg-[var(--erp-primary-soft)] px-1.5 py-3 text-center"
                      style={delay(560 + index * 70)}
                    >
                      <span className="text-[var(--erp-primary)]">
                        <Icon name={mod.icon} size={19} />
                      </span>
                      <span className="text-[0.625rem] font-semibold leading-tight text-[var(--erp-muted)]">
                        {mod.label}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <p className="mt-auto pt-2 text-[0.6875rem] text-[var(--erp-muted-soft)]">
                © {new Date().getFullYear()} netERp · Demo environment
              </p>
            </div>
          </section>

          {/* ── Sign-in panel ──────────────────────────────────────────── */}
          <section className="erp-glass-panel relative flex flex-col border-t-[3px] border-[var(--erp-primary)] px-5 py-8 sm:px-9 sm:py-10 lg:border-l lg:border-t-0 lg:px-11 lg:py-12">
            {/* Compact brand row — replaces the brand panel below lg. */}
            <div className="erp-fade mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(140deg,#0b3aa8,#2563eb)] text-white shadow-lg">
                <Icon name="dashboard" size={20} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-[var(--erp-fg-strong)]">netERp</p>
                <p className="truncate text-xs text-[var(--erp-muted)]">
                  Enterprise Resource Planning
                </p>
              </div>
            </div>

            <div className="erp-rise" style={delay(120)}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-[var(--erp-muted)]">
                  Welcome to <span className="font-semibold text-[var(--erp-primary)]">netERp</span>
                </p>
                <p className="text-right text-xs leading-snug text-[var(--erp-muted-soft)]">
                  No Account?{' '}
                  <span className="mt-0.5 block font-medium text-[var(--erp-primary)]">
                    Contact Us
                  </span>
                </p>
              </div>
              <h1 className="mt-1.5 text-[2rem] font-bold leading-tight tracking-tight text-[var(--erp-fg-strong)] sm:text-[2.25rem]">
                Sign in
              </h1>
            </div>

            {serverError ? (
              <div className="erp-rise mt-5">
                <Alert tone="error" title={serverError.title}>
                  {serverError.message}
                </Alert>
              </div>
            ) : null}

            <form
              onSubmit={(e) => void onSubmit(e)}
              className="erp-rise mt-7 flex flex-1 flex-col"
              style={delay(200)}
              noValidate
            >
              <div>
                <label htmlFor="email" className="erp-field-label">
                  Enter your email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  required
                  {...register('email')}
                  className="erp-input h-11"
                  aria-invalid={errors.email ? 'true' : undefined}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                />
                {errors.email ? (
                  <p id="email-error" className="mt-1 text-xs text-[var(--erp-danger)]">
                    {errors.email.message}
                  </p>
                ) : null}
              </div>

              <div className="mt-5">
                <label htmlFor="password" className="erp-field-label">
                  Enter your Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  required
                  {...register('password')}
                  className="erp-input h-11"
                  aria-invalid={errors.password ? 'true' : undefined}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                />
                {errors.password ? (
                  <p id="password-error" className="mt-1 text-xs text-[var(--erp-danger)]">
                    {errors.password.message}
                  </p>
                ) : null}
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowResetHint((v) => !v);
                    }}
                    className="rounded text-xs font-medium text-[var(--erp-primary)] underline-offset-2 hover:underline"
                    aria-expanded={showResetHint}
                  >
                    Forgot Password
                  </button>
                </div>
                {showResetHint ? (
                  <p className="erp-fade mt-1 text-xs text-[var(--erp-muted)]" role="status">
                    Self-service reset is not enabled in the demo. Use a demo account below, or ask
                    your administrator to reset your password.
                  </p>
                ) : null}
              </div>

              <Button
                type="submit"
                loading={isSubmitting}
                size="lg"
                className="erp-lift mt-6 h-11 w-full rounded-xl text-sm"
              >
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>

              {SHOW_DEMO_ACCOUNTS ? (
                <div
                  className="erp-glass-inset erp-rise mt-7 rounded-2xl border border-[var(--erp-border)] p-4"
                  style={delay(300)}
                >
                  <p className="mb-3 text-xs font-medium text-[var(--erp-muted)]">
                    Demo accounts — one click signs you in (password {DEMO_PASSWORD}):
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {DEMO_ACCOUNTS.map((account) => (
                      <button
                        key={account.email}
                        type="button"
                        className="erp-lift flex min-w-0 flex-col items-start gap-0.5 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] px-3 py-2.5 text-left hover:border-[var(--erp-primary)] hover:bg-[var(--erp-primary-soft)] disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          void signInAsDemo(account.email);
                        }}
                      >
                        <span className="text-sm font-medium text-[var(--erp-fg)]">
                          {account.label}
                        </span>
                        <span className="block min-w-0 max-w-full">
                          <span className="block truncate text-xs text-[var(--erp-muted)]">
                            {demoPending === account.email ? 'Signing in…' : account.hint}
                          </span>
                          <span className="block truncate text-[10px] text-[var(--erp-muted-soft)]">
                            {account.email}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="erp-fade mt-auto pt-6 text-center text-[11px] leading-relaxed text-[var(--erp-muted-soft)] lg:text-left">
                {SHOW_DEMO_ACCOUNTS
                  ? 'Protected workspace. Sign-in needs the API and database running (see .freebuff/run.md).'
                  : 'Protected workspace. Access is logged and permission-checked.'}
              </p>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
