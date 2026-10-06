import type { NavItem } from './navigation';

export interface PaletteCommand {
  label: string;
  href: string;
  permission?: string;
  group: string;
}

export interface SearchResult {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  status?: string | null;
  metadata?: unknown;
}

// Search results open a real, implemented module list. Record-detail pages and
// list-level search parameters are not consistently available yet, so do not
// fabricate deep links or imply that a query parameter filters the destination.
export const SEARCH_ENTITY_ROUTES: Readonly<Record<string, string>> = {
  employee: '/hr/employees',
  supplier: '/procurement/suppliers',
  purchase_request: '/procurement/purchase-requests',
  purchase_order: '/procurement/purchase-orders',
  product: '/inventory/products',
  customer: '/sales/customers',
  sales_order: '/sales/orders',
  delivery: '/sales/deliveries',
  customer_invoice: '/sales/invoices',
  journal_entry: '/accounting/journals',
  document: '/documents',
  visitor: '/office/visitors',
  call: '/office/calls',
  correspondence: '/office/correspondence',
  file_record: '/office/files',
  conversation: '/communication/chat',
  report: '/reports',
};

export function flattenNavigation(
  items: NavItem[],
  can: (permission: string) => boolean,
): PaletteCommand[] {
  return items.flatMap((item) => {
    if (item.permission && !can(item.permission)) return [];
    if (item.children?.length) {
      return flattenNavigation(item.children, can);
    }
    if (item.href) {
      return [
        { label: item.label, href: item.href, permission: item.permission, group: 'Navigate' },
      ];
    }
    return [];
  });
}

export interface SearchResultGroup {
  entityType: string;
  label: string;
  results: SearchResult[];
}

export function groupSearchResults(
  groups: Record<string, SearchResult[]> | undefined,
): SearchResultGroup[] {
  return Object.entries(groups ?? {})
    .map(([entityType, results]) => ({
      entityType,
      label: entityType.replaceAll('_', ' '),
      results: [...results].sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function searchDestination(result: SearchResult): string | null {
  return SEARCH_ENTITY_ROUTES[result.entityType] ?? null;
}

// Notifications carry the Prisma model name in `resourceType` (e.g. `message`,
// `report_export`, `call_log`), not the search entity type, so they need their
// own allowlist. Each entry pairs a real module list with the permission that
// guards it; anything unmapped renders no link rather than an arbitrary href.
const NOTIFICATION_DESTINATIONS: Readonly<Record<string, { href: string; permission: string }>> = {
  message: { href: '/communication/chat', permission: 'communication.chat.view' },
  conversation: { href: '/communication/chat', permission: 'communication.chat.view' },
  report_export: { href: '/reports', permission: 'reporting.report.view' },
  scheduled_report: { href: '/reports/scheduled', permission: 'reporting.report.view' },
  leave_request: { href: '/hr/leave', permission: 'hr.leave.view' },
  employee: { href: '/hr/employees', permission: 'hr.employee.view' },
  payroll_run: { href: '/payroll/runs', permission: 'payroll.payroll_run.view' },
  supplier: { href: '/procurement/suppliers', permission: 'procurement.supplier.view' },
  purchase_request: {
    href: '/procurement/purchase-requests',
    permission: 'procurement.purchase_request.view',
  },
  purchase_order: {
    href: '/procurement/purchase-orders',
    permission: 'procurement.purchase_order.view',
  },
  product: { href: '/inventory/products', permission: 'inventory.product.view' },
  customer: { href: '/sales/customers', permission: 'sales.customer.view' },
  sales_order: { href: '/sales/orders', permission: 'sales.sales_order.view' },
  delivery: { href: '/sales/deliveries', permission: 'sales.delivery.view' },
  customer_invoice: { href: '/sales/invoices', permission: 'sales.invoice.view' },
  journal_entry: { href: '/accounting/journals', permission: 'accounting.journal.view' },
  visitor: { href: '/office/visitors', permission: 'office.visitor.view' },
  call_log: { href: '/office/calls', permission: 'office.call.view' },
  correspondence: { href: '/office/correspondence', permission: 'office.correspondence.view' },
  file_record: { href: '/office/files', permission: 'office.file_room.view' },
  approval_task: { href: '/approvals', permission: 'workflow.approval_task.view' },
  document: { href: '/documents', permission: 'documents.document.view' },
};

export function notificationDestination(
  resourceType: string | null,
  can: (permission: string) => boolean,
): string | null {
  if (!resourceType) return null;
  const destination = NOTIFICATION_DESTINATIONS[resourceType];
  if (!destination) return null;
  if (!can(destination.permission)) return null;
  return destination.href;
}
