'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button } from '@erp/ui';
import { useAuth } from '@/lib/auth';

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

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [demoPending, setDemoPending] = useState<string | null>(null);

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
      setServerError(e instanceof Error ? e.message : 'Sign in failed');
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
      setServerError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setDemoPending(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Enterprise Office ERP</h1>
        <p className="mb-6 text-sm text-[var(--erp-muted)]">Sign in to your workspace.</p>

        {serverError ? (
          <div className="mb-4">
            <Alert tone="error" title="Sign in failed">
              {serverError}
            </Alert>
          </div>
        ) : null}

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-xs font-medium text-[var(--erp-muted)]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              {...register('email')}
              className="h-[38px] w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-surface)] px-3 text-sm"
              aria-invalid={errors.email ? 'true' : undefined}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            {errors.email ? (
              <p id="email-error" className="mt-1 text-xs text-[var(--erp-danger)]">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-medium text-[var(--erp-muted)]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              {...register('password')}
              className="h-[38px] w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-surface)] px-3 text-sm"
              aria-invalid={errors.password ? 'true' : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
            {errors.password ? (
              <p id="password-error" className="mt-1 text-xs text-[var(--erp-danger)]">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" loading={isSubmitting} className="w-full">
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-6 rounded-lg border border-dashed border-[var(--erp-border)] p-3">
          <p className="mb-2 text-xs font-medium text-[var(--erp-muted)]">
            Demo accounts — one click signs you in (password {DEMO_PASSWORD}):
          </p>
          <div className="grid gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="flex items-center justify-between rounded-md border border-[var(--erp-border)] bg-[var(--erp-surface)] px-3 py-2 text-left text-sm hover:border-[var(--erp-accent)] disabled:opacity-50"
                disabled={demoPending !== null || isSubmitting}
                onClick={() => {
                  void signInAsDemo(account.email);
                }}
              >
                <span className="font-medium">{account.label}</span>
                <span className="text-xs text-[var(--erp-muted)]">
                  {demoPending === account.email ? 'Signing in…' : account.hint}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--erp-muted)]">
            Sign-in needs the API and database running (see .freebuff/run.md).
          </p>
        </div>
      </div>
    </main>
  );
}
