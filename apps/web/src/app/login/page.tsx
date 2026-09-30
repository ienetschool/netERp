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

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
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
      </div>
    </main>
  );
}
