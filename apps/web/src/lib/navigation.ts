import type { IconName } from '@erp/ui';

export interface NavItem {
  label: string;
  href?: string;
  permission?: string;
  children?: NavItem[];
  /** Icon from the shared icon set, rendered by the sidebar and the palette. */
  icon?: IconName;
}

/**
 * Primary navigation map (UI-UX.md §45). Items render only when the principal
 * holds the mapped permission; the server remains the enforcement boundary.
 */
export const NAVIGATION: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: 'dashboard' },
  {
    label: 'My Work',
    icon: 'check-square',
    children: [
      {
        label: 'Approvals',
        href: '/approvals',
        permission: 'workflow.approval_task.view',
        icon: 'approvals',
      },
      {
        label: 'Notifications',
        href: '/notifications',
        permission: 'communication.notification.view',
        icon: 'bell',
      },
    ],
  },
  {
    label: 'HR',
    permission: 'hr.employee.view',
    icon: 'hr',
    children: [
      { label: 'Employees', href: '/hr/employees', permission: 'hr.employee.view', icon: 'users' },
      { label: 'Leave', href: '/hr/leave', permission: 'hr.leave.view', icon: 'calendar' },
    ],
  },
  {
    label: 'Payroll',
    permission: 'payroll.payroll_run.view',
    icon: 'payroll',
    children: [
      {
        label: 'Pay Groups',
        href: '/payroll/pay-groups',
        permission: 'payroll.pay_group.view',
        icon: 'users',
      },
      {
        label: 'Salary Structures',
        href: '/payroll/salary-structures',
        permission: 'payroll.salary_structure.view',
        icon: 'finance',
      },
      {
        label: 'Payroll Runs',
        href: '/payroll/runs',
        permission: 'payroll.payroll_run.view',
        icon: 'payroll',
      },
    ],
  },
  {
    label: 'Procurement',
    permission: 'procurement.purchase_order.view',
    icon: 'procurement',
    children: [
      {
        label: 'Suppliers',
        href: '/procurement/suppliers',
        permission: 'procurement.supplier.view',
        icon: 'building',
      },
      {
        label: 'Purchase Requests',
        href: '/procurement/purchase-requests',
        permission: 'procurement.purchase_request.view',
        icon: 'inbox',
      },
      {
        label: 'Purchase Orders',
        href: '/procurement/purchase-orders',
        permission: 'procurement.purchase_order.view',
        icon: 'procurement',
      },
    ],
  },
  {
    label: 'Inventory',
    permission: 'inventory.product.view',
    icon: 'inventory',
    children: [
      {
        label: 'Products',
        href: '/inventory/products',
        permission: 'inventory.product.view',
        icon: 'grid',
      },
      {
        label: 'Stock',
        href: '/inventory/stock',
        permission: 'inventory.stock.view',
        icon: 'inventory',
      },
    ],
  },
  {
    label: 'Sales',
    permission: 'sales.customer.view',
    icon: 'sales',
    children: [
      {
        label: 'Customers',
        href: '/sales/customers',
        permission: 'sales.customer.view',
        icon: 'users',
      },
      {
        label: 'Quotations',
        href: '/sales/quotations',
        permission: 'sales.quotation.view',
        icon: 'finance',
      },
      {
        label: 'Sales Orders',
        href: '/sales/orders',
        permission: 'sales.sales_order.view',
        icon: 'cart',
      },
      {
        label: 'Deliveries',
        href: '/sales/deliveries',
        permission: 'sales.delivery.view',
        icon: 'activity',
      },
      {
        label: 'Invoices',
        href: '/sales/invoices',
        permission: 'sales.invoice.view',
        icon: 'finance',
      },
      {
        label: 'Receipts',
        href: '/sales/receipts',
        permission: 'sales.receipt.view',
        icon: 'wallet',
      },
    ],
  },
  {
    label: 'Accounting',
    permission: 'accounting.journal.view',
    icon: 'finance',
    children: [
      {
        label: 'Accounts',
        href: '/accounting/accounts',
        permission: 'accounting.account.view',
        icon: 'wallet',
      },
      {
        label: 'Journals',
        href: '/accounting/journals',
        permission: 'accounting.journal.view',
        icon: 'finance',
      },
      {
        label: 'GL Reports',
        href: '/accounting/reports',
        permission: 'accounting.journal.view',
        icon: 'reports',
      },
    ],
  },
  {
    label: 'Office',
    permission: 'office.visitor.view',
    icon: 'building',
    children: [
      {
        label: 'Visitors',
        href: '/office/visitors',
        permission: 'office.visitor.view',
        icon: 'users',
      },
      { label: 'Calls', href: '/office/calls', permission: 'office.call.view', icon: 'activity' },
      {
        label: 'Correspondence',
        href: '/office/correspondence',
        permission: 'office.correspondence.view',
        icon: 'documents',
      },
      {
        label: 'File Room',
        href: '/office/files',
        permission: 'office.file_room.view',
        icon: 'inbox',
      },
    ],
  },
  {
    label: 'Communication',
    permission: 'communication.chat.view',
    icon: 'send',
    children: [
      {
        label: 'Chat',
        href: '/communication/chat',
        permission: 'communication.chat.view',
        icon: 'send',
      },
    ],
  },
  {
    label: 'Reports',
    permission: 'reporting.report.view',
    icon: 'reports',
    children: [
      {
        label: 'Report Runner',
        href: '/reports',
        permission: 'reporting.report.view',
        icon: 'reports',
      },
      {
        label: 'Scheduled Reports',
        href: '/reports/scheduled',
        permission: 'reporting.report.view',
        icon: 'clock',
      },
    ],
  },
  {
    label: 'Documents',
    href: '/documents',
    permission: 'documents.document.view',
    icon: 'documents',
  },
  {
    label: 'Administration',
    permission: 'identity.user.view',
    icon: 'settings',
    children: [
      { label: 'Users', href: '/admin/users', permission: 'identity.user.view', icon: 'users' },
      {
        label: 'Roles',
        href: '/admin/roles',
        permission: 'identity.role.view',
        icon: 'check-square',
      },
      {
        label: 'Companies',
        href: '/admin/companies',
        permission: 'organization.company.view',
        icon: 'building',
      },
      {
        label: 'Branches',
        href: '/admin/branches',
        permission: 'organization.branch.view',
        icon: 'building',
      },
      {
        label: 'Departments',
        href: '/admin/departments',
        permission: 'organization.department.view',
        icon: 'grid',
      },
      {
        label: 'Warehouses',
        href: '/admin/warehouses',
        permission: 'organization.warehouse.view',
        icon: 'inventory',
      },
      {
        label: 'Settings',
        href: '/admin/settings',
        permission: 'settings.configuration.view',
        icon: 'settings',
      },
      {
        label: 'Audit Trail',
        href: '/admin/audit',
        permission: 'audit.audit_log.view',
        icon: 'activity',
      },
    ],
  },
];
