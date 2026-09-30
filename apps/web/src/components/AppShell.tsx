'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAVIGATION, type NavItem } from '@/lib/navigation';
import { useAuth, usePermissions, useSidebarCollapsed } from '@/lib/auth';

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active =
    item.href !== undefined &&
    (pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)));
  if (!item.href) return null;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={`flex items-center rounded-md px-3 py-2 text-sm transition
        ${active ? 'bg-[var(--erp-surface-alt)] font-medium text-[var(--erp-fg)]' : 'text-[var(--erp-muted)] hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)]'}
        ${collapsed ? 'justify-center' : ''}`}
    >
      <span aria-hidden="true" className="mr-2 text-xs">
        {active ? '▸' : '·'}
      </span>
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function NavGroup({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { can } = usePermissions();
  if (item.permission && !can(item.permission)) return null;
  if (!item.children) {
    return <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />;
  }
  const visibleChildren = item.children.filter((c) => !c.permission || can(c.permission));
  if (visibleChildren.length === 0) return null;
  return (
    <div>
      <p
        className={`px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)] ${collapsed ? 'text-center' : ''}`}
      >
        {collapsed ? item.label.slice(0, 2) : item.label}
      </p>
      {!collapsed && (
        <div className="space-y-0.5">
          {visibleChildren.map((child) => (
            <NavLink key={child.href} item={child} collapsed={false} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { principal, logout } = useAuth();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const crumbs = pathname.split('/').filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--erp-border)] bg-[var(--erp-surface)] px-4">
        <button
          type="button"
          aria-label="Toggle navigation"
          onClick={() => {
            if (window.innerWidth < 1024) {
              setMobileOpen((v) => !v);
            } else {
              toggleCollapsed();
            }
          }}
          className="rounded p-2 text-[var(--erp-muted)] hover:bg-[var(--erp-surface-alt)]"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <Link href="/" className="font-semibold tracking-tight">
          ERP
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {principal ? (
            <>
              <span className="hidden text-sm text-[var(--erp-muted)] sm:inline">
                {principal.email}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-sm hover:bg-[var(--erp-surface-alt)]"
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Primary"
          className={`${
            mobileOpen ? 'fixed inset-y-14 left-0 z-10 block w-64 overflow-y-auto' : 'hidden'
          } shrink-0 border-r border-[var(--erp-border)] bg-[var(--erp-surface)] p-2 lg:sticky lg:top-14 lg:block lg:h-[calc(100vh-3.5rem)] ${
            collapsed ? 'lg:w-14' : 'lg:w-60'
          }`}
        >
          <div className="space-y-0.5">
            {NAVIGATION.map((item) => (
              <NavGroup
                key={item.label}
                item={item}
                collapsed={collapsed}
                onNavigate={() => {
                  setMobileOpen(false);
                }}
              />
            ))}
          </div>
        </nav>

        <main id="main" className="min-w-0 flex-1 p-4 lg:p-6">
          <nav aria-label="Breadcrumb" className="mb-4 text-xs text-[var(--erp-muted)]">
            <ol className="flex items-center gap-1">
              <li>
                <Link href="/" className="hover:underline">
                  Home
                </Link>
              </li>
              {crumbs.map((c, i) => (
                <li key={`${c}-${i}`} className="flex items-center gap-1">
                  <span aria-hidden="true">/</span>
                  <span className="capitalize">{c.replaceAll('-', ' ')}</span>
                </li>
              ))}
            </ol>
          </nav>
          {children}
        </main>
      </div>
    </div>
  );
}
