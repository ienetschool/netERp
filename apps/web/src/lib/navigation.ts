export interface NavItem {
  label: string;
  href?: string;
  permission?: string;
  children?: NavItem[];
}

/**
 * Primary navigation map (UI-UX.md §45). Items render only when the principal
 * holds the mapped permission; the server remains the enforcement boundary.
 * Groups activate with their vertical slices; Stage 11 adds Reporting.
 */
export const NAVIGATION: NavItem[] = [
  { label: 'Dashboard', href: '/' },
  {
    label: 'My Work',
    children: [
      { label: 'Approvals', href: '/approvals', permission: 'workflow.approval_task.view' },
      {
        label: 'Notifications',
        href: '/notifications',
        permission: 'communication.notification.view',
      },
    ],
  },
  {
    label: 'HR',
    permission: 'hr.employee.view',
    children: [
      { label: 'Employees', href: '/hr/employees', permission: 'hr.employee.view' },
      { label: 'Leave', href: '/hr/leave', permission: 'hr.leave.view' },
    ],
  },
  {
    label: 'Payroll',
    permission: 'payroll.payroll_run.view',
    children: [
      { label: 'Pay Groups', href: '/payroll/pay-groups', permission: 'payroll.pay_group.view' },
      {
        label: 'Salary Structures',
        href: '/payroll/salary-structures',
        permission: 'payroll.salary_structure.view',
      },
      { label: 'Payroll Runs', href: '/payroll/runs', permission: 'payroll.payroll_run.view' },
    ],
  },
  {
    label: 'Procurement',
    permission: 'procurement.purchase_order.view',
    children: [
      {
        label: 'Suppliers',
        href: '/procurement/suppliers',
        permission: 'procurement.supplier.view',
      },
      {
        label: 'Purchase Requests',
        href: '/procurement/purchase-requests',
        permission: 'procurement.purchase_request.view',
      },
      {
        label: 'Purchase Orders',
        href: '/procurement/purchase-orders',
        permission: 'procurement.purchase_order.view',
      },
    ],
  },
  {
    label: 'Inventory',
    permission: 'inventory.product.view',
    children: [
      { label: 'Products', href: '/inventory/products', permission: 'inventory.product.view' },
      { label: 'Stock', href: '/inventory/stock', permission: 'inventory.stock.view' },
    ],
  },
  {
    label: 'Sales',
    permission: 'sales.customer.view',
    children: [
      { label: 'Customers', href: '/sales/customers', permission: 'sales.customer.view' },
      { label: 'Quotations', href: '/sales/quotations', permission: 'sales.quotation.view' },
      { label: 'Sales Orders', href: '/sales/orders', permission: 'sales.sales_order.view' },
      { label: 'Deliveries', href: '/sales/deliveries', permission: 'sales.delivery.view' },
      { label: 'Invoices', href: '/sales/invoices', permission: 'sales.invoice.view' },
      { label: 'Receipts', href: '/sales/receipts', permission: 'sales.receipt.view' },
    ],
  },
  {
    label: 'Accounting',
    permission: 'accounting.journal.view',
    children: [
      { label: 'Accounts', href: '/accounting/accounts', permission: 'accounting.account.view' },
      { label: 'Journals', href: '/accounting/journals', permission: 'accounting.journal.view' },
      { label: 'GL Reports', href: '/accounting/reports', permission: 'accounting.journal.view' },
    ],
  },
  {
    label: 'Office',
    permission: 'office.visitor.view',
    children: [
      { label: 'Visitors', href: '/office/visitors', permission: 'office.visitor.view' },
      { label: 'Calls', href: '/office/calls', permission: 'office.call.view' },
      {
        label: 'Correspondence',
        href: '/office/correspondence',
        permission: 'office.correspondence.view',
      },
      { label: 'File Room', href: '/office/files', permission: 'office.file_room.view' },
    ],
  },
  {
    label: 'Communication',
    permission: 'communication.chat.view',
    children: [
      { label: 'Chat', href: '/communication/chat', permission: 'communication.chat.view' },
    ],
  },
  {
    label: 'Reports',
    permission: 'reporting.report.view',
    children: [
      { label: 'Report Runner', href: '/reports', permission: 'reporting.report.view' },
      {
        label: 'Scheduled Reports',
        href: '/reports/scheduled',
        permission: 'reporting.report.view',
      },
    ],
  },
  { label: 'Documents', href: '/documents', permission: 'documents.document.view' },
  {
    label: 'Administration',
    permission: 'identity.user.view',
    children: [
      { label: 'Users', href: '/admin/users', permission: 'identity.user.view' },
      { label: 'Roles', href: '/admin/roles', permission: 'identity.role.view' },
      { label: 'Companies', href: '/admin/companies', permission: 'organization.company.view' },
      { label: 'Branches', href: '/admin/branches', permission: 'organization.branch.view' },
      {
        label: 'Departments',
        href: '/admin/departments',
        permission: 'organization.department.view',
      },
      { label: 'Warehouses', href: '/admin/warehouses', permission: 'organization.warehouse.view' },
      { label: 'Settings', href: '/admin/settings', permission: 'settings.configuration.view' },
      { label: 'Audit Trail', href: '/admin/audit', permission: 'audit.audit_log.view' },
    ],
  },
];
