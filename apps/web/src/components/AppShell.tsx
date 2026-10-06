'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAVIGATION, type NavItem } from '@/lib/navigation';
import { useAuth, usePermissions, useSidebarCollapsed } from '@/lib/auth';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@erp/ui';
import { CommandPalette } from './CommandPalette';

function CompanyBranchSelectors({
  principal,
}: {
  principal: ReturnType<typeof useAuth>['principal'];
}) {
  if (!principal?.companyIds) return null;
  return (
    <div className="hidden items-center gap-2 sm:inline-flex">
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--erp-primary-soft)] text-[var(--erp-primary)]"
        aria-hidden="true"
      >
        <Icon name="globe" size={14} />
      </span>
      <span className="text-[0.8125rem] font-medium text-[var(--erp-muted)]">
        Global Tech Solutions
      </span>
    </div>
  );
}

function NavLink({
  item,
  collapsed,
  onNavigate,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  badge?: number;
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
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={`group relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[0.8125rem] font-medium transition
        ${
          active
            ? 'bg-[var(--erp-nav-active)] text-[var(--erp-nav-fg-strong)]'
            : 'text-[var(--erp-nav-fg)] hover:bg-[var(--erp-nav-hover)] hover:text-[var(--erp-nav-fg-strong)]'
        }
        ${collapsed ? 'justify-center px-0' : ''}`}
    >
      {item.icon ? (
        <span
          aria-hidden="true"
          className={`shrink-0 ${active ? 'text-white' : 'text-[var(--erp-nav-fg)]'}`}
        >
          <Icon name={item.icon} size={17} />
        </span>
      ) : null}
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
      {!collapsed && badge !== undefined && badge > 0 ? (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--erp-primary)] px-1 text-[0.625rem] font-bold leading-none text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

function NavGroup({
  item,
  collapsed,
  onNavigate,
  unread,
  approvals,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  unread: number;
  approvals: number;
}) {
  const { can } = usePermissions();
  if (item.permission && !can(item.permission)) return null;
  if (!item.children) {
    return <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />;
  }
  const visibleChildren = item.children.filter(
    (child) => !child.permission || can(child.permission),
  );
  if (visibleChildren.length === 0) return null;
  return (
    <div className="mb-1">
      {!collapsed ? (
        <p className="px-3 pb-1 pt-3 text-[0.625rem] font-bold uppercase tracking-[0.08em] text-[var(--erp-nav-fg)]/60">
          {item.label}
        </p>
      ) : (
        <div aria-hidden="true" className="mx-3 my-2 h-px bg-[var(--erp-nav-fg)]/15" />
      )}
      <div className="space-y-0.5">
        {visibleChildren.map((child) => (
          <NavLink
            key={child.href}
            item={child}
            collapsed={collapsed}
            onNavigate={onNavigate}
            badge={
              child.href === '/notifications'
                ? unread
                : child.href === '/approvals'
                  ? approvals
                  : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { principal, logout } = useAuth();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { can } = usePermissions();
  const canViewNotifications = can('communication.notification.view');
  const canViewApprovals = can('workflow.approval_task.view');
  const unread = useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    enabled: Boolean(principal && canViewNotifications),
    refetchInterval: canViewNotifications ? 60_000 : false,
    staleTime: 30_000,
  });
  const approvals = useQuery({
    queryKey: ['approval-pending-count'],
    queryFn: () => api.get<unknown[]>('/workflow/approval-tasks?status=PENDING'),
    enabled: Boolean(principal && canViewApprovals),
    refetchInterval: canViewApprovals ? 60_000 : false,
    staleTime: 30_000,
  });

  const crumbs = pathname.split('/').filter(Boolean);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape' && mobileOpen) setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 1023px)');
    const updateViewport = () => {
      setIsMobile(mobile.matches);
      if (!mobile.matches) setMobileOpen(false);
    };
    updateViewport();
    mobile.addEventListener('change', updateViewport);
    return () => {
      mobile.removeEventListener('change', updateViewport);
    };
  }, []);

  const unreadCount = unread.data?.count ?? 0;
  const approvalCount = approvals.data?.length ?? 0;
  const displayName = principal?.displayName || principal?.email || '';
  const scopeLabel = principal
    ? principal.companyIds === null
      ? 'All companies'
      : `${principal.companyIds.length} ${principal.companyIds.length === 1 ? 'company' : 'companies'}`
    : '';

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <a href="#main" className="erp-skip-link">
        Skip to main content
      </a>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-[rgb(9_15_32/50%)] lg:hidden"
          onClick={() => {
            setMobileOpen(false);
          }}
        />
      ) : null}

      {/* Brand + navigation. Deep navy rail, matching the reference shell. */}
      <nav
        id="primary-navigation"
        aria-label="Primary"
        className={`${
          mobileOpen
            ? 'erp-mobile-nav fixed inset-y-0 left-0 z-40 flex w-[min(17rem,84vw)] flex-col'
            : 'hidden lg:sticky lg:top-0 lg:flex lg:h-screen'
        } z-40 shrink-0 flex-col bg-[var(--erp-nav)] lg:z-20 ${
          collapsed ? 'lg:w-[4.5rem]' : 'lg:w-[15.5rem]'
        }`}
      >
        <div
          className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--erp-nav-fg)]/10 px-4 ${
            collapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--erp-primary)] text-white">
            <Icon name="dashboard" size={16} />
          </span>
          {!collapsed ? (
            <span className="truncate text-[0.9375rem] font-semibold text-white">ERP System</span>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 py-2">
          {NAVIGATION.map((item) => (
            <NavGroup
              key={item.label}
              item={item}
              collapsed={!mobileOpen && collapsed}
              unread={unreadCount}
              approvals={approvalCount}
              onNavigate={() => {
                setMobileOpen(false);
              }}
            />
          ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="erp-topbar sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--erp-border)] px-3 sm:px-5">
          <button
            type="button"
            aria-label={
              isMobile
                ? mobileOpen
                  ? 'Close navigation'
                  : 'Open navigation'
                : collapsed
                  ? 'Expand navigation'
                  : 'Collapse navigation'
            }
            aria-expanded={isMobile ? mobileOpen : !collapsed}
            aria-controls="primary-navigation"
            onClick={() => {
              if (isMobile) {
                setMobileOpen((value) => !value);
              } else {
                toggleCollapsed();
              }
            }}
            className="rounded-lg p-2 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)] lg:hidden"
          >
            <Icon name="menu" size={19} />
          </button>
          <button
            type="button"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            aria-controls="primary-navigation"
            onClick={toggleCollapsed}
            className="hidden rounded-lg p-2 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)] lg:block"
          >
            <Icon name="menu" size={19} />
          </button>

          <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
            <ol className="flex items-center gap-1.5 text-[0.8125rem]">
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="text-[var(--erp-muted)]">
                  <Icon name="home" size={15} />
                </span>
                <Link
                  href="/"
                  className="text-[var(--erp-muted)] transition hover:text-[var(--erp-fg)]"
                >
                  Home
                </Link>
              </li>
              {crumbs.map((crumb, index) => (
                <li key={`${crumb}-${index}`} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="text-[var(--erp-muted-soft)]">
                    <Icon name="chevronRight" size={13} />
                  </span>
                  <span
                    className={
                      index === crumbs.length - 1
                        ? 'font-medium capitalize text-[var(--erp-fg)]'
                        : 'capitalize text-[var(--erp-muted)]'
                    }
                  >
                    {crumb.replaceAll('-', ' ')}
                  </span>
                </li>
              ))}
            </ol>
          </nav>

          <button
            type="button"
            onClick={() => {
              setPaletteOpen(true);
            }}
            className="ml-auto flex min-w-0 max-w-md flex-1 items-center gap-2 rounded-full border border-[var(--erp-border)] bg-[var(--erp-surface-alt)] px-3.5 py-1.5 text-left text-[0.8125rem] text-[var(--erp-muted)] transition hover:border-[var(--erp-border-strong)] hover:bg-[var(--erp-surface)] sm:ml-6"
            aria-label="Search records and navigate"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <span aria-hidden="true" className="shrink-0">
              <Icon name="search" size={15} />
            </span>
            <span className="truncate">
              Search anything… (e.g. invoice, customer, product, employee)
            </span>
            <kbd className="ml-auto hidden shrink-0 rounded border border-[var(--erp-border-strong)] erp-frost px-1.5 py-0.5 text-[0.625rem] font-semibold sm:inline">
              ⌘K
            </kbd>
          </button>

          <CompanyBranchSelectors principal={principal} />

          {principal ? (
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {canViewNotifications ? (
                <Link
                  href="/notifications"
                  aria-label={
                    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
                  }
                  className="relative rounded-lg p-2 text-[var(--erp-muted)] transition hover:bg-[var(--erp-surface-alt)] hover:text-[var(--erp-fg)]"
                >
                  <Icon name="bell" size={18} />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--erp-danger)] px-1 text-[0.5625rem] font-bold leading-none text-white ring-2 ring-[var(--erp-surface)]">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  ) : null}
                </Link>
              ) : null}

              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  onClick={() => {
                    setUserMenuOpen((value) => !value);
                  }}
                  className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition hover:bg-[var(--erp-surface-alt)]"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--erp-primary-soft)] text-xs font-bold text-[var(--erp-primary)]"
                  >
                    {displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="hidden min-w-0 text-left sm:block">
                    <span className="block max-w-[10rem] truncate text-[0.8125rem] font-semibold leading-tight text-[var(--erp-fg-strong)]">
                      {displayName}
                    </span>
                    <span className="block text-[0.6875rem] leading-tight text-[var(--erp-muted)]">
                      {principal.isSuperAdmin ? 'Administrator' : scopeLabel}
                    </span>
                  </span>
                  <span aria-hidden="true" className="hidden text-[var(--erp-muted)] sm:inline">
                    <Icon name="chevronDown" size={14} />
                  </span>
                </button>
                {userMenuOpen ? (
                  <div
                    role="menu"
                    className="erp-popover absolute right-0 z-[1000] mt-1.5 w-56 overflow-hidden rounded-xl border border-[var(--erp-border)] erp-frost py-1"
                    style={{ boxShadow: 'var(--erp-shadow-lg)' }}
                  >
                    <div className="border-b border-[var(--erp-border)] px-3.5 py-2.5">
                      <p className="truncate text-[0.8125rem] font-semibold text-[var(--erp-fg-strong)]">
                        {displayName}
                      </p>
                      <p className="truncate text-xs text-[var(--erp-muted)]">{principal.email}</p>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void logout()}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[0.8125rem] text-[var(--erp-fg)] transition hover:bg-[var(--erp-surface-alt)]"
                    >
                      <Icon name="logout" size={15} />
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </header>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-3 sm:p-5 lg:p-6">
          {/* Re-keyed on pathname so each route enters with a short rise-and-fade. */}
          <div key={pathname} className="erp-page-enter min-w-0">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
      />
    </div>
  );
}
