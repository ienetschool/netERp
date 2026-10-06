'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NAVIGATION } from '@/lib/navigation';
import { usePermissions } from '@/lib/auth';
import {
  flattenNavigation,
  groupSearchResults,
  searchDestination,
  type SearchResult,
} from '@/lib/command-palette';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { can } = usePermissions();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const commands = useMemo(() => flattenNavigation(NAVIGATION, can), [can]);

  useEffect(() => {
    if (!open) {
      setTerm('');
      setDebouncedTerm('');
      setActiveIndex(0);
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedTerm(term.trim());
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedTerm]);

  const searchQuery = useQuery({
    queryKey: ['global-search', debouncedTerm],
    queryFn: () =>
      api.get<Record<string, SearchResult[]>>(`/search?q=${encodeURIComponent(debouncedTerm)}`),
    enabled: open && debouncedTerm.length >= 2,
    staleTime: 15_000,
    retry: 1,
  });
  const resultGroups = groupSearchResults(searchQuery.data);
  const results = resultGroups.flatMap((group) => group.results);
  const groupsWithStartIndex = useMemo(() => {
    let startIndex = 0;
    return resultGroups.map((group) => {
      const current = { ...group, startIndex };
      startIndex += group.results.length;
      return current;
    });
  }, [resultGroups]);
  const searching = term.trim().length >= 2;
  const showingResults = searching && debouncedTerm === term.trim();
  const entries = showingResults
    ? results.map((result) => ({ kind: 'result' as const, result }))
    : searching
      ? []
      : commands.map((command) => ({ kind: 'command' as const, command }));

  useEffect(() => {
    if (activeIndex >= entries.length) setActiveIndex(0);
  }, [activeIndex, entries.length]);

  function activate(index: number): void {
    const entry = entries[index];
    if (!entry) return;
    const href = entry.kind === 'command' ? entry.command.href : searchDestination(entry.result);
    if (!href) return;
    router.push(href);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="erp-dialog-backdrop fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-3 pb-8 pt-[10vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        className="erp-dialog-panel w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--erp-border)] erp-frost shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => (entries.length ? (current + 1) % entries.length : 0));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) =>
              entries.length ? (current - 1 + entries.length) % entries.length : 0,
            );
          } else if (event.key === 'Enter' && entries.length > 0) {
            event.preventDefault();
            activate(activeIndex);
          } else if (event.key === 'Tab') {
            const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
              'input:not([disabled]), button:not([disabled]), a[href]',
            );
            if (!focusable || focusable.length === 0) return;
            const first = focusable.item(0);
            const last = focusable.item(focusable.length - 1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id="command-palette-title" className="sr-only">
          Global search and commands
        </h2>
        <label className="flex items-center gap-3 border-b border-[var(--erp-border)] px-4">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-5 w-5 shrink-0 text-[var(--erp-muted)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <span className="sr-only">Search records or commands</span>
          <input
            ref={inputRef}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
            }}
            placeholder="Search records or jump to a module…"
            autoComplete="off"
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--erp-muted)]"
          />
          <button
            type="button"
            onClick={() => {
              onClose();
            }}
            className="rounded border border-[var(--erp-border)] px-2 py-1 text-xs text-[var(--erp-muted)] hover:bg-[var(--erp-surface-alt)]"
            aria-label="Close search"
          >
            Esc
          </button>
        </label>

        <div className="max-h-[min(65vh,34rem)] overflow-y-auto p-2" aria-live="polite">
          {term.trim().length < 2 ? (
            <>
              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                Navigate
              </p>
              {commands.map((command, index) => (
                <button
                  key={`${command.href}:${command.label}`}
                  type="button"
                  aria-current={activeIndex === index ? 'true' : undefined}
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    activate(index);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${activeIndex === index ? 'bg-[var(--erp-surface-alt)] text-[var(--erp-fg)]' : 'text-[var(--erp-muted)] hover:bg-[var(--erp-surface-alt)]'}`}
                >
                  <span>{command.href === '/' ? `${command.label} (Home)` : command.label}</span>
                  <span aria-hidden="true" className="text-xs">
                    ↵
                  </span>
                </button>
              ))}
            </>
          ) : debouncedTerm.length < 2 || debouncedTerm !== term.trim() ? (
            <p role="status" className="px-3 py-8 text-center text-sm text-[var(--erp-muted)]">
              {debouncedTerm.length < 2
                ? 'Type at least 2 characters to search authorized records.'
                : 'Searching…'}
            </p>
          ) : searchQuery.isLoading || searchQuery.isFetching ? (
            <p role="status" className="px-3 py-8 text-center text-sm text-[var(--erp-muted)]">
              Searching…
            </p>
          ) : searchQuery.isError ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-[var(--erp-danger)]">Search could not be completed.</p>
              <button
                type="button"
                className="mt-2 rounded px-3 py-1.5 text-sm underline"
                onClick={() => {
                  void searchQuery.refetch();
                }}
              >
                Retry
              </button>
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-[var(--erp-muted)]">
              No matching records in your authorized scope.
            </p>
          ) : (
            <>
              {groupsWithStartIndex.map((group) => (
                <section key={group.entityType} aria-label={group.label}>
                  <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                    {group.label}
                  </h3>
                  {group.results.map((result, index) => {
                    const entryIndex = group.startIndex + index;
                    const label = result.entityType.replaceAll('_', ' ');
                    return (
                      <button
                        key={`${result.entityType}:${result.entityId}`}
                        type="button"
                        aria-current={activeIndex === entryIndex ? 'true' : undefined}
                        onMouseEnter={() => {
                          setActiveIndex(entryIndex);
                        }}
                        onClick={() => {
                          activate(entryIndex);
                        }}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left ${activeIndex === entryIndex ? 'bg-[var(--erp-surface-alt)]' : 'hover:bg-[var(--erp-surface-alt)]'}`}
                      >
                        <span className="inline-flex h-8 min-w-8 items-center justify-center rounded bg-[var(--erp-info-bg)] px-1 text-[10px] font-semibold uppercase text-[var(--erp-info)]">
                          {label.slice(0, 3)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{result.title}</span>
                          <span className="block truncate text-xs text-[var(--erp-muted)]">
                            {[result.subtitle, result.status].filter(Boolean).join(' · ') ||
                              result.entityId}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs capitalize text-[var(--erp-muted)]">
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </section>
              ))}
            </>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-[var(--erp-border)] px-4 py-2 text-[11px] text-[var(--erp-muted)]">
          <span>Search is limited to your permissions and organization scope</span>
          <span>
            <kbd className="rounded border border-[var(--erp-border)] px-1">↑</kbd>{' '}
            <kbd className="rounded border border-[var(--erp-border)] px-1">↓</kbd> select ·{' '}
            <kbd className="rounded border border-[var(--erp-border)] px-1">↵</kbd> open
          </span>
        </footer>
      </div>
    </div>
  );
}
