'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearTokens, readTokens, storeTokens } from './api';

export interface Principal {
  userId: string;
  email: string;
  displayName?: string;
  permissions: string[];
  companyIds: string[] | null;
  branchIds: string[] | null;
  departmentIds: string[] | null;
  warehouseIds: string[] | null;
  isSuperAdmin: boolean;
}

interface AuthState {
  principal: Principal | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!readTokens()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<Principal>('/auth/me');
        if (!cancelled) setPrincipal(me);
      } catch {
        clearTokens();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
      email,
      password,
    });
    storeTokens(tokens);
    const me = await api.get<Principal>('/auth/me');
    setPrincipal(me);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // best-effort; local session cleared regardless
    }
    clearTokens();
    setPrincipal(null);
    router.push('/login');
  }, [router]);

  const value = useMemo(
    () => ({ principal, loading, login, logout }),
    [principal, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

const STORAGE_KEY = 'erp.navigation.collapsed';

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/** Permission-aware UI helper (server authorization remains authoritative). */
export function usePermissions(): {
  can: (key: string) => boolean;
  isSuperAdmin: boolean;
} {
  const { principal } = useAuth();
  return useMemo(() => {
    if (!principal) return { can: () => false, isSuperAdmin: false };
    const set = new Set(principal.permissions);
    const wildcard = principal.isSuperAdmin;
    const can = (key: string) => {
      if (wildcard) return true;
      if (set.has('*')) return true;
      if (set.has(key)) return true;
      const [module, resource] = key.split('.');
      if (module && set.has(`${module}.*`)) return true;
      if (module && resource && set.has(`${module}.${resource}.*`)) return true;
      return false;
    };
    return { can, isSuperAdmin: wildcard };
  }, [principal]);
}
