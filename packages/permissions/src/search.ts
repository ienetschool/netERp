/**
 * Search records only when the principal has the module's canonical view grant.
 * Unknown indexed entity types fail closed.
 */
export const SEARCH_ENTITY_PERMISSIONS: Readonly<Record<string, string>> = {
  user: 'identity.user.view',
  role: 'identity.role.view',
  company: 'organization.company.view',
  branch: 'organization.branch.view',
  department: 'organization.department.view',
  warehouse: 'organization.warehouse.view',
  employee: 'hr.employee.view',
  attendance: 'hr.attendance.view',
  leave_request: 'hr.leave.view',
  payroll_run: 'payroll.payroll_run.view',
  supplier: 'procurement.supplier.view',
  rfq: 'procurement.rfq.view',
  supplier_quotation: 'procurement.quotation.view',
  purchase_request: 'procurement.purchase_request.view',
  purchase_order: 'procurement.purchase_order.view',
  goods_receipt: 'procurement.goods_receipt.view',
  supplier_invoice: 'procurement.supplier_invoice.view',
  supplier_payment: 'procurement.supplier_payment.view',
  product: 'inventory.product.view',
  stock_balance: 'inventory.stock.view',
  stock_movement: 'inventory.stock.view',
  stock_transfer: 'inventory.stock_transfer.view',
  stock_adjustment: 'inventory.stock_adjustment.view',
  customer: 'sales.customer.view',
  sales_quotation: 'sales.quotation.view',
  sales_order: 'sales.sales_order.view',
  delivery: 'sales.delivery.view',
  customer_invoice: 'sales.invoice.view',
  customer_receipt: 'sales.receipt.view',
  account: 'accounting.account.view',
  journal_entry: 'accounting.journal.view',
  asset: 'assets.asset.view',
  visitor: 'office.visitor.view',
  call: 'office.call.view',
  correspondence: 'office.correspondence.view',
  file_record: 'office.file_room.view',
  conversation: 'communication.chat.view',
  notification: 'communication.notification.view',
  document: 'documents.document.view',
  approval_task: 'workflow.approval_task.view',
  report: 'reporting.report.view',
};

export function permittedSearchEntityTypes(can: (permission: string) => boolean): string[] {
  return Object.entries(SEARCH_ENTITY_PERMISSIONS)
    .filter(([, permission]) => can(permission))
    .map(([entityType]) => entityType);
}
