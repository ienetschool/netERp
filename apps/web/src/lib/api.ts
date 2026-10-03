'use client';

/**
 * Thin typed API client. Server state belongs to TanStack Query; this module
 * only knows how to talk to the ERP API envelope safely.
 */

const API_BASE = '/api/v1';

interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

const TOKEN_KEY = 'erp.tokens';

export function readTokens(): StoredTokens | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: StoredTokens): void {
  window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const tokens = readTokens();
    if (!tokens?.refreshToken) return false;
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const body = (await res.json()) as Envelope<StoredTokens>;
    storeTokens(body.data);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<T> {
  const tokens = readTokens();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (tokens?.accessToken) {
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && retryOn401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiFetch<T>(path, init, false);
    }
  }

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed with status ${res.status}`;
    let details: unknown;
    try {
      const body = (await res.json()) as { code?: string; message?: string; details?: unknown };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
      details = body.details;
    } catch {
      // non-JSON error body — keep defaults
    }
    throw new ApiError(code, message, res.status, details);
  }

  const body = (await res.json()) as Envelope<T> | T;
  if (typeof body === 'object' && body !== null && 'data' in body) {
    return body.data;
  }
  return body;
}

/**
 * Fetches a binary artefact (export, document) with the bearer token and
 * hands it to the browser as a file. Plain links cannot send the header, so
 * this keeps downloads authorization-checked by the API.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const tokens = readTokens();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {},
  });
  if (!res.ok) {
    throw new ApiError('HTTP_ERROR', `Download failed with status ${res.status}`, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
