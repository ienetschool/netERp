/**
 * Foundation seed — safe, deterministic development data only.
 * Source: DATA-MODEL.md §35 seed order, ARCHITECTURE.md §52.
 * No real credentials, no production data.
 *
 * Idempotent: safe to re-run (`npm run db:seed`).
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const MODULES_RESOURCES: Record<string, string[]> = {
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

const ACTIONS = [
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
];

async function ensurePermissions(): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const [module, resources] of Object.entries(MODULES_RESOURCES)) {
    for (const resource of resources) {
      for (const action of ACTIONS) {
        const key = `${module}.${resource}.${action}`;
        const permission = await prisma.permission.upsert({
          where: { module_resource_action: { module, resource, action } },
          update: {},
          create: { module, resource, action },
        });
        byKey.set(key, permission.id);
      }
    }
  }
  return byKey;
}

async function ensureRoles(permissions: Map<string, string>): Promise<Map<string, string>> {
  const roleDefs: Array<{
    code: string;
    name: string;
    description: string;
    include: (module: string, resource: string, action: string) => boolean;
  }> = [
    {
      code: 'SUPER_ADMIN',
      name: 'Super Administrator',
      description: 'Full platform access across all companies',
      include: () => true,
    },
    {
      code: 'COMPANY_ADMIN',
      name: 'Company Administrator',
      description: 'Full administrative access within a company',
      include: (m) => m !== 'audit' || true, // audit read-only enforced elsewhere
    },
    {
      code: 'BRANCH_MANAGER',
      name: 'Branch Manager',
      description: 'Operational management within a branch',
      include: (m) =>
        ['organization', 'hr', 'procurement', 'inventory', 'sales', 'office'].includes(m),
    },
    {
      code: 'HR_MANAGER',
      name: 'HR Manager',
      description: 'HR and attendance management',
      include: (m) => ['hr', 'organization'].includes(m),
    },
    {
      code: 'HR_OFFICER',
      name: 'HR Officer',
      description: 'HR operations',
      include: (m) => m === 'hr',
    },
    {
      code: 'ACCOUNTANT',
      name: 'Accountant',
      description: 'Accounting operations',
      include: (m) => ['accounting', 'procurement', 'sales'].includes(m),
    },
    {
      code: 'CHIEF_ACCOUNTANT',
      name: 'Chief Accountant',
      description: 'Accounting management and posting authority',
      include: (m) => ['accounting', 'procurement', 'sales'].includes(m),
    },
    {
      code: 'FINANCE_MANAGER',
      name: 'Finance Manager',
      description: 'Finance oversight and approvals',
      include: (m) => ['accounting', 'payroll', 'procurement', 'sales'].includes(m),
    },
    {
      code: 'PURCHASE_OFFICER',
      name: 'Purchase Officer',
      description: 'Procurement operations',
      include: (m) => ['procurement', 'inventory'].includes(m),
    },
    {
      code: 'PROCUREMENT_MANAGER',
      name: 'Procurement Manager',
      description: 'Procurement management and approvals',
      include: (m) => ['procurement', 'inventory'].includes(m),
    },
    {
      code: 'INVENTORY_MANAGER',
      name: 'Inventory Manager',
      description: 'Inventory operations',
      include: (m) => m === 'inventory',
    },
    {
      code: 'SALES_OFFICER',
      name: 'Sales Officer',
      description: 'Sales operations',
      include: (m) => m === 'sales',
    },
    {
      code: 'SALES_MANAGER',
      name: 'Sales Manager',
      description: 'Sales management and approvals',
      include: (m) => m === 'sales',
    },
    {
      code: 'RECEPTIONIST',
      name: 'Receptionist',
      description: 'Front office operations',
      include: (m) => ['office', 'communication'].includes(m),
    },
    {
      code: 'DOCUMENT_OFFICER',
      name: 'Document Officer',
      description: 'Document and correspondence management',
      include: (m) => ['office', 'documents'].includes(m),
    },
    {
      code: 'EMPLOYEE',
      name: 'Employee',
      description: 'Self-service access',
      include: (m, r, a) =>
        (m === 'hr' && ['attendance', 'leave'].includes(r) && ['view', 'create'].includes(a)) ||
        (m === 'office' && r === 'document' && a === 'view') ||
        (m === 'communication' && r === 'notification' && ['view'].includes(a)) ||
        (m === 'payroll' && r === 'payroll_run' && a === 'view'),
    },
    {
      code: 'AUDITOR',
      name: 'Auditor',
      description: 'Read-only access including audit trail',
      include: (_m, _r, a) => a === 'view' || a === 'export' || a === 'download',
    },
    {
      code: 'READ_ONLY',
      name: 'Read Only',
      description: 'View-only access to operational modules',
      include: (_m, _r, a) => a === 'view',
    },
  ];

  const byCode = new Map<string, string>();
  for (const def of roleDefs) {
    const role = await prisma.role.upsert({
      where: { code: def.code },
      update: {},
      create: { code: def.code, name: def.name, description: def.description, isSystemRole: true },
    });
    byCode.set(def.code, role.id);

    const existing = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    const existingSet = new Set(existing.map((rp) => rp.permissionId));
    const toAdd: string[] = [];
    for (const [key, permissionId] of permissions) {
      const [module, resource, action] = key.split('.');
      if (existingSet.has(permissionId)) continue;
      if (def.include(module ?? '', resource ?? '', action ?? '')) toAdd.push(permissionId);
    }
    if (toAdd.length > 0) {
      await prisma.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
  return byCode;
}

async function ensureCompanyTree(): Promise<{
  companyId: string;
  branchId: string;
  departmentId: string;
  warehouseId: string;
}> {
  const currency = await prisma.currency.upsert({
    where: { code: 'USD' },
    update: {},
    create: { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
  });

  const company = await prisma.company.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: {
      code: 'DEMO',
      name: 'Demo Company',
      legalName: 'Demo Company LLC',
      baseCurrencyId: currency.id,
      timezone: 'UTC',
      email: 'admin@example.com',
    },
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'HQ' } },
    update: {},
    create: {
      companyId: company.id,
      code: 'HQ',
      name: 'Headquarters',
      type: 'HEAD_OFFICE',
      timezone: 'UTC',
    },
  });

  const department = await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: 'GEN' } },
    update: {},
    create: { companyId: company.id, branchId: branch.id, code: 'GEN', name: 'General' },
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    update: {},
    create: {
      companyId: company.id,
      branchId: branch.id,
      code: 'MAIN',
      name: 'Main Warehouse',
      type: 'MAIN',
    },
  });

  await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: warehouse.id, code: 'GENERAL' } },
    update: {},
    create: {
      warehouseId: warehouse.id,
      code: 'GENERAL',
      name: 'General Storage',
      locationType: 'BULK',
    },
  });

  const year = new Date().getUTCFullYear();
  const periodStart = new Date(Date.UTC(year, 0, 1));
  const periodEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  await prisma.financialPeriod.upsert({
    where: {
      companyId_fiscalYear_periodNo: { companyId: company.id, fiscalYear: year, periodNo: 1 },
    },
    update: {},
    create: {
      companyId: company.id,
      fiscalYear: year,
      periodNo: 1,
      startDate: periodStart,
      endDate: periodEnd,
      status: 'OPEN',
    },
  });

  // Minimal, generic chart of accounts (structure only — posting policy lives in the
  // accounting vertical slice, not here).
  const accounts: Array<{ code: string; name: string; type: string; normal: string }> = [
    { code: '1000', name: 'Assets', type: 'ASSET', normal: 'DEBIT' },
    { code: '1100', name: 'Cash', type: 'ASSET', normal: 'DEBIT' },
    { code: '1200', name: 'Accounts Receivable', type: 'ASSET', normal: 'DEBIT' },
    { code: '1400', name: 'Inventory', type: 'ASSET', normal: 'DEBIT' },
    { code: '2000', name: 'Liabilities', type: 'LIABILITY', normal: 'CREDIT' },
    { code: '2100', name: 'Accounts Payable', type: 'LIABILITY', normal: 'CREDIT' },
    { code: '2200', name: 'Payroll Liabilities', type: 'LIABILITY', normal: 'CREDIT' },
    { code: '3000', name: 'Equity', type: 'EQUITY', normal: 'CREDIT' },
    { code: '4000', name: 'Revenue', type: 'REVENUE', normal: 'CREDIT' },
    { code: '5000', name: 'Expenses', type: 'EXPENSE', normal: 'DEBIT' },
    { code: '5100', name: 'Salaries Expense', type: 'EXPENSE', normal: 'DEBIT' },
  ];
  for (const a of accounts) {
    await prisma.account.upsert({
      where: { companyId_accountCode: { companyId: company.id, accountCode: a.code } },
      update: {},
      create: {
        companyId: company.id,
        accountCode: a.code,
        accountName: a.name,
        accountType: a.type,
        normalBalance: a.normal,
      },
    });
  }

  return {
    companyId: company.id,
    branchId: branch.id,
    departmentId: department.id,
    warehouseId: warehouse.id,
  };
}

async function ensureUsers(
  roleIds: Map<string, string>,
  org: { companyId: string; branchId: string; departmentId: string; warehouseId: string },
): Promise<void> {
  const passwordHash = await argon2.hash('Admin123!');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.local' },
    update: {},
    create: {
      email: 'admin@demo.local',
      displayName: 'System Administrator',
      passwordHash,
    },
  });

  const superAdminRoleId = roleIds.get('SUPER_ADMIN');
  if (!superAdminRoleId) throw new Error('SUPER_ADMIN role missing after seed');
  const existingAssignments = await prisma.userRoleAssignment.findFirst({
    where: { userId: admin.id, roleId: superAdminRoleId },
  });
  if (!existingAssignments) {
    await prisma.userRoleAssignment.create({
      data: { userId: admin.id, roleId: superAdminRoleId },
    });
  }

  // A scoped demo user: visibility limited to the demo company/branch.
  const manager = await prisma.user.upsert({
    where: { email: 'manager@demo.local' },
    update: {},
    create: {
      email: 'manager@demo.local',
      displayName: 'Branch Manager',
      passwordHash,
    },
  });
  const branchManagerRoleId = roleIds.get('BRANCH_MANAGER');
  if (!branchManagerRoleId) throw new Error('BRANCH_MANAGER role missing after seed');
  const mgrAssignment = await prisma.userRoleAssignment.findFirst({
    where: { userId: manager.id, roleId: branchManagerRoleId },
  });
  if (!mgrAssignment) {
    await prisma.userRoleAssignment.create({
      data: {
        userId: manager.id,
        roleId: branchManagerRoleId,
        companyId: org.companyId,
        branchId: org.branchId,
      },
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding foundation data...');
  const permissions = await ensurePermissions();
  console.log(`Permissions: ${permissions.size}`);
  const roles = await ensureRoles(permissions);
  console.log(`Roles: ${roles.size}`);
  const org = await ensureCompanyTree();
  await ensureUsers(roles, org);
  console.log('Seed complete. Users: admin@demo.local / manager@demo.local (password: Admin123!)');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })

  .finally(() => prisma.$disconnect());
