/**
 * Central permission taxonomy (CLAUDE.md §61: no duplicated permission logic).
 * Permission key format: `<module>.<resource>.<action>`
 * Source: DATA-MODEL.md §5, USER-FLOWS.md §26, ARCHITECTURE.md §13.
 */

export const MODULES = [
  'identity',
  'organization',
  'hr',
  'payroll',
  'procurement',
  'inventory',
  'sales',
  'accounting',
  'assets',
  'office',
  'communication',
  'reporting',
  'documents',
  'workflow',
  'settings',
  'audit',
] as const;

export type Module = (typeof MODULES)[number];

export const ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'submit',
  'approve',
  'reject',
  'post',
  'reverse',
  'cancel',
  'export',
  'print',
  'upload',
  'download',
  'assign',
  'transfer',
  'reconcile',
] as const;

export type Action = (typeof ACTIONS)[number];

export const RESOURCES: Record<Module, readonly string[]> = {
  identity: ['user', 'role', 'session'],
  organization: ['company', 'branch', 'department', 'cost_center', 'warehouse'],
  hr: ['employee', 'attendance', 'leave', 'holiday'],
  payroll: ['payroll_run'],
  procurement: [
    'supplier',
    'purchase_request',
    'rfq',
    'purchase_order',
    'goods_receipt',
    'supplier_invoice',
    'supplier_payment',
  ],
  inventory: ['product', 'stock', 'stock_transfer', 'stock_adjustment'],
  sales: ['customer', 'quotation', 'sales_order', 'delivery', 'invoice', 'receipt'],
  accounting: ['account', 'journal', 'period', 'ar', 'ap', 'bank', 'cash', 'tax'],
  assets: ['asset'],
  office: ['visitor', 'call', 'correspondence', 'file_room', 'document'],
  communication: ['chat', 'notification', 'email', 'sms', 'whatsapp'],
  reporting: ['report', 'dashboard', 'export'],
  documents: ['document', 'document_version'],
  workflow: ['workflow_definition', 'approval_task'],
  settings: ['numbering', 'configuration'],
  audit: ['audit_log'],
};

export function permissionKey(module: string, resource: string, action: string): string {
  return `${module}.${resource}.${action}`;
}

export function parsePermissionKey(
  key: string,
): { module: string; resource: string; action: string } | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  const [module, resource, action] = parts;
  if (!module || !resource || !action) return null;
  return { module, resource, action };
}

export function allPermissionKeys(): string[] {
  const keys: string[] = [];
  for (const module of MODULES) {
    for (const resource of RESOURCES[module]) {
      for (const action of ACTIONS) {
        keys.push(permissionKey(module, resource, action));
      }
    }
  }
  return keys;
}

/**
 * Flat, immutable set of granted permission keys with wildcard support.
 * Wildcards: `*`, `module.*`, `module.resource.*`.
 */
export class PermissionSet {
  private readonly granted: ReadonlySet<string>;

  constructor(keys: Iterable<string>) {
    this.granted = new Set(keys);
  }

  has(key: string): boolean {
    if (this.granted.has('*')) return true;
    if (this.granted.has(key)) return true;
    const parsed = parsePermissionKey(key);
    if (!parsed) return false;
    if (this.granted.has(`${parsed.module}.*`)) return true;
    if (this.granted.has(`${parsed.module}.${parsed.resource}.*`)) return true;
    return false;
  }

  hasAny(keys: Iterable<string>): boolean {
    for (const key of keys) {
      if (this.has(key)) return true;
    }
    return false;
  }

  hasAll(keys: Iterable<string>): boolean {
    for (const key of keys) {
      if (!this.has(key)) return false;
    }
    return true;
  }

  keys(): string[] {
    return [...this.granted];
  }

  get size(): number {
    return this.granted.size;
  }
}

/** Role codes seeded by the foundation seed (DATA-MODEL §5). */
export const SYSTEM_ROLES = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'BRANCH_MANAGER',
  'HR_MANAGER',
  'HR_OFFICER',
  'ACCOUNTANT',
  'CHIEF_ACCOUNTANT',
  'FINANCE_MANAGER',
  'PURCHASE_OFFICER',
  'PROCUREMENT_MANAGER',
  'INVENTORY_MANAGER',
  'SALES_OFFICER',
  'SALES_MANAGER',
  'RECEPTIONIST',
  'DOCUMENT_OFFICER',
  'EMPLOYEE',
  'AUDITOR',
  'READ_ONLY',
] as const;
