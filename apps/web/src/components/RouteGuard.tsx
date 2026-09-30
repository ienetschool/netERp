'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppShell } from './AppShell';

/**
 * Client-side route guard for UX only. The API enforces authorization for
 * every request (CLAUDE.md §31: server authorization always wins).
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { principal, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = pathname === '/login';

  useEffect(() => {
    if (!loading && !principal && !isPublic) {
      router.replace('/login');
    }
  }, [loading, principal, isPublic, router]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        role="status"
        aria-label="Loading application"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--erp-primary)] border-t-transparent" />
      </div>
    );
  }

  if (!principal) {
    return null; // redirect in flight
  }

  return <AppShell>{children}</AppShell>;
}
