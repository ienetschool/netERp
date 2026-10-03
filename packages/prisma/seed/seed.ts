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
  payroll: ['pay_group', 'salary_structure', 'payroll_run'],
  procurement: [
    'supplier',
    'purchase_request',
    'rfq',
    'quotation',
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
  const rows: Array<{ module: string; resource: string; action: string }> = [];
  for (const [module, resources] of Object.entries(MODULES_RESOURCES)) {
    for (const resource of resources) {
      for (const action of ACTIONS) {
        rows.push({ module, resource, action });
      }
    }
  }
  await prisma.permission.createMany({ data: rows, skipDuplicates: true });
  const all = await prisma.permission.findMany({
    select: { id: true, module: true, resource: true, action: true },
  });
  const byKey = new Map<string, string>(
    all.map((p) => [`${p.module}.${p.resource}.${p.action}`, p.id] as const),
  );
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
      include: (m, _r, a) =>
        ['accounting', 'payroll', 'procurement', 'sales'].includes(m) ||
        // Finance managers consume reporting (run, export, schedule) but never
        // administer other people's. A second reporting principal makes
        // per-user isolation (saved reports, exports, schedules) real.
        (m === 'reporting' && ['view', 'export', 'download', 'create'].includes(a)),
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
      code: 'FRONT_OFFICE_CLERK',
      name: 'Front Office Clerk',
      description: 'Stage 9 demo user for visitors, calls, correspondence, and file room',
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
  let roleIdx = 0;
  for (const def of roleDefs) {
    roleIdx += 1;
    console.log(`[seed] ensureRoles ${roleIdx}/${roleDefs.length} ${def.code}`);
    const role = await prisma.role.upsert({
      where: { code: def.code },
      update: {},
      create: { code: def.code, name: def.name, description: def.description, isSystemRole: true },
    });
    byCode.set(def.code, role.id);

    const rows: Array<{ roleId: string; permissionId: string }> = [];
    for (const [key, permissionId] of permissions) {
      const [module, resource, action] = key.split('.');
      if (def.include(module ?? '', resource ?? '', action ?? ''))
        rows.push({ roleId: role.id, permissionId });
    }
    console.log(
      `[seed] ensureRoles ${roleIdx}/${roleDefs.length} ${def.code} -> ${rows.length} perms`,
    );
    if (rows.length > 0) {
      await prisma.rolePermission.createMany({
        data: rows,
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

  // Payroll approver for the demo (USER-FLOWS §27: finance review).
  const finance = await prisma.user.upsert({
    where: { email: 'finance@demo.local' },
    update: {},
    create: {
      email: 'finance@demo.local',
      displayName: 'Finance Manager',
      passwordHash,
    },
  });
  const financeManagerRoleId = roleIds.get('FINANCE_MANAGER');
  if (!financeManagerRoleId) throw new Error('FINANCE_MANAGER role missing after seed');
  const finAssignment = await prisma.userRoleAssignment.findFirst({
    where: { userId: finance.id, roleId: financeManagerRoleId },
  });
  if (!finAssignment) {
    await prisma.userRoleAssignment.create({
      data: {
        userId: finance.id,
        roleId: financeManagerRoleId,
        companyId: org.companyId,
      },
    });
  }

  // Stage 9 demo user: front-office clerk exercising the office module.
  const clerk = await prisma.user.upsert({
    where: { email: 'office@demo.local' },
    update: {},
    create: {
      email: 'office@demo.local',
      displayName: 'Front Office Clerk',
      passwordHash,
    },
  });
  const clerkRoleId = roleIds.get('FRONT_OFFICE_CLERK');
  if (!clerkRoleId) throw new Error('FRONT_OFFICE_CLERK role missing after seed');
  const clerkAssignment = await prisma.userRoleAssignment.findFirst({
    where: { userId: clerk.id, roleId: clerkRoleId },
  });
  if (!clerkAssignment) {
    await prisma.userRoleAssignment.create({
      data: {
        userId: clerk.id,
        roleId: clerkRoleId,
        companyId: org.companyId,
        branchId: org.branchId,
      },
    });
  }
}

/**
 * Demo approval workflow (PRD Stage 2: lets the workflow engine and approval
 * inbox be exercised end-to-end). Purchase requests route:
 * DRAFT --submit--> PENDING_APPROVAL --approve--> APPROVED
 *                                 --reject--->  REJECTED
 * Arriving at PENDING_APPROVAL creates a task for the BRANCH_MANAGER role,
 * which the seeded manager@demo.local holds.
 */
async function ensureDemoWorkflow(
  roleIds: Map<string, string>,
  org: { companyId: string },
): Promise<void> {
  const existing = await prisma.workflowDefinition.findFirst({
    where: { companyId: org.companyId, entityType: 'purchase_request', version: 1 },
  });
  if (existing) return;

  const approverRoleId = roleIds.get('BRANCH_MANAGER');
  if (!approverRoleId) throw new Error('BRANCH_MANAGER role missing after seed');

  const definition = await prisma.workflowDefinition.create({
    data: {
      companyId: org.companyId,
      name: 'Purchase request approval',
      entityType: 'purchase_request',
      version: 1,
      status: 'ACTIVE',
    },
  });

  await prisma.workflowState.createMany({
    data: [
      {
        definitionId: definition.id,
        code: 'DRAFT',
        name: 'Draft',
        isInitial: true,
        isTerminal: false,
      },
      {
        definitionId: definition.id,
        code: 'PENDING_APPROVAL',
        name: 'Pending Approval',
        isInitial: false,
        isTerminal: false,
      },
      {
        definitionId: definition.id,
        code: 'APPROVED',
        name: 'Approved',
        isInitial: false,
        isTerminal: true,
      },
      {
        definitionId: definition.id,
        code: 'REJECTED',
        name: 'Rejected',
        isInitial: false,
        isTerminal: true,
      },
    ],
  });

  const states = await prisma.workflowState.findMany({ where: { definitionId: definition.id } });
  const byCode = new Map(states.map((s) => [s.code, s.id]));

  await prisma.workflowTransition.createMany({
    data: [
      {
        definitionId: definition.id,
        fromStateId: byCode.get('DRAFT') as string,
        toStateId: byCode.get('PENDING_APPROVAL') as string,
        action: 'submit',
        condition: { approverType: 'ROLE', approverId: approverRoleId },
      },
      {
        definitionId: definition.id,
        fromStateId: byCode.get('PENDING_APPROVAL') as string,
        toStateId: byCode.get('APPROVED') as string,
        action: 'approve',
      },
      {
        definitionId: definition.id,
        fromStateId: byCode.get('PENDING_APPROVAL') as string,
        toStateId: byCode.get('REJECTED') as string,
        action: 'reject',
      },
    ],
  });
}

/**
 * HR demo data (PRD Stage 3): leave types, holidays, employees, and a
 * leave_request approval workflow routed to the BRANCH_MANAGER role.
 */
async function ensureHrData(
  roleIds: Map<string, string>,
  org: { companyId: string; branchId: string; departmentId: string },
): Promise<void> {
  const leaveTypes: Array<{ code: string; name: string; paid: boolean; allowance: number | null }> =
    [
      { code: 'AL', name: 'Annual Leave', paid: true, allowance: 20 },
      { code: 'SL', name: 'Sick Leave', paid: true, allowance: 10 },
      { code: 'UPL', name: 'Unpaid Leave', paid: false, allowance: null },
    ];
  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { companyId_code: { companyId: org.companyId, code: lt.code } },
      update: {},
      create: {
        companyId: org.companyId,
        code: lt.code,
        name: lt.name,
        paid: lt.paid,
        annualAllowance: lt.allowance,
        requiresApproval: true,
      },
    });
  }

  const year = new Date().getUTCFullYear();
  const holidays = [
    { name: 'New Year Day', date: `${year}-01-01` },
    { name: 'Company Foundation Day', date: `${year}-06-15` },
  ];
  for (const h of holidays) {
    const existing = await prisma.holiday.findFirst({
      where: { companyId: org.companyId, holidayDate: new Date(`${h.date}T00:00:00Z`) },
    });
    if (!existing) {
      await prisma.holiday.create({
        data: {
          companyId: org.companyId,
          branchId: org.branchId,
          name: h.name,
          holidayDate: new Date(`${h.date}T00:00:00Z`),
        },
      });
    }
  }

  const employees: Array<{ no: string; first: string; last: string; title: string }> = [
    { no: 'E-0001', first: 'Amina', last: 'Diop', title: 'Office Manager' },
    { no: 'E-0002', first: 'Ravi', last: 'Sharma', title: 'Accountant' },
    { no: 'E-0003', first: 'Lena', last: 'Novak', title: 'Sales Officer' },
  ];
  const employeeIds: string[] = [];
  for (const e of employees) {
    const row = await prisma.employee.upsert({
      where: { companyId_employeeNo: { companyId: org.companyId, employeeNo: e.no } },
      update: {},
      create: {
        companyId: org.companyId,
        branchId: org.branchId,
        departmentId: org.departmentId,
        employeeNo: e.no,
        firstName: e.first,
        lastName: e.last,
        displayName: `${e.first} ${e.last}`,
        email: `${e.no.toLowerCase()}@demo.local`,
        hireDate: new Date(`${year - 1}-01-01T00:00:00Z`),
        employmentStatus: 'ACTIVE',
        employmentType: 'FULL_TIME',
        jobTitle: e.title,
      },
    });
    employeeIds.push(row.id);
  }

  // leave_request workflow: DRAFT -> PENDING_APPROVAL (BRANCH_MANAGER) -> APPROVED/REJECTED
  const existingLeaveWorkflow = await prisma.workflowDefinition.findFirst({
    where: { companyId: org.companyId, entityType: 'leave_request', version: 1 },
  });
  if (!existingLeaveWorkflow) {
    const approverRoleId = roleIds.get('BRANCH_MANAGER');
    if (!approverRoleId) throw new Error('BRANCH_MANAGER role missing after seed');
    const definition = await prisma.workflowDefinition.create({
      data: {
        companyId: org.companyId,
        name: 'Leave request approval',
        entityType: 'leave_request',
        version: 1,
        status: 'ACTIVE',
      },
    });
    await prisma.workflowState.createMany({
      data: [
        {
          definitionId: definition.id,
          code: 'DRAFT',
          name: 'Draft',
          isInitial: true,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'PENDING_APPROVAL',
          name: 'Pending Approval',
          isInitial: false,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'APPROVED',
          name: 'Approved',
          isInitial: false,
          isTerminal: true,
        },
        {
          definitionId: definition.id,
          code: 'REJECTED',
          name: 'Rejected',
          isInitial: false,
          isTerminal: true,
        },
      ],
    });
    const states = await prisma.workflowState.findMany({ where: { definitionId: definition.id } });
    const byCode = new Map(states.map((s) => [s.code, s.id]));
    await prisma.workflowTransition.createMany({
      data: [
        {
          definitionId: definition.id,
          fromStateId: byCode.get('DRAFT') as string,
          toStateId: byCode.get('PENDING_APPROVAL') as string,
          action: 'submit',
          condition: { approverType: 'ROLE', approverId: approverRoleId },
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('APPROVED') as string,
          action: 'approve',
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('REJECTED') as string,
          action: 'reject',
        },
      ],
    });
  }

  // Demo supplier so procurement flows can be exercised immediately.
  const usd = await prisma.currency.findUnique({ where: { code: 'USD' } });
  if (usd) {
    await prisma.supplier.upsert({
      where: { companyId_supplierNo: { companyId: org.companyId, supplierNo: 'SUP-0001' } },
      update: {},
      create: {
        companyId: org.companyId,
        branchId: org.branchId,
        supplierNo: 'SUP-0001',
        legalName: 'Office Supplies Trading LLC',
        displayName: 'Office Supplies Trading',
        email: 'sales@officesupplies.example',
        currencyId: usd.id,
      },
    });
  }

  // purchase_order workflow: DRAFT -> PENDING_APPROVAL (BRANCH_MANAGER) -> APPROVED/REJECTED
  const existingPoWorkflow = await prisma.workflowDefinition.findFirst({
    where: { companyId: org.companyId, entityType: 'purchase_order', version: 1 },
  });
  if (!existingPoWorkflow) {
    const poApproverRoleId = roleIds.get('BRANCH_MANAGER');
    if (!poApproverRoleId) throw new Error('BRANCH_MANAGER role missing after seed');
    const poDefinition = await prisma.workflowDefinition.create({
      data: {
        companyId: org.companyId,
        name: 'Purchase order approval',
        entityType: 'purchase_order',
        version: 1,
        status: 'ACTIVE',
      },
    });
    await prisma.workflowState.createMany({
      data: [
        {
          definitionId: poDefinition.id,
          code: 'DRAFT',
          name: 'Draft',
          isInitial: true,
          isTerminal: false,
        },
        {
          definitionId: poDefinition.id,
          code: 'PENDING_APPROVAL',
          name: 'Pending Approval',
          isInitial: false,
          isTerminal: false,
        },
        {
          definitionId: poDefinition.id,
          code: 'APPROVED',
          name: 'Approved',
          isInitial: false,
          isTerminal: true,
        },
        {
          definitionId: poDefinition.id,
          code: 'REJECTED',
          name: 'Rejected',
          isInitial: false,
          isTerminal: true,
        },
      ],
    });
    const poStates = await prisma.workflowState.findMany({
      where: { definitionId: poDefinition.id },
    });
    const poByCode = new Map(poStates.map((s) => [s.code, s.id]));
    await prisma.workflowTransition.createMany({
      data: [
        {
          definitionId: poDefinition.id,
          fromStateId: poByCode.get('DRAFT') as string,
          toStateId: poByCode.get('PENDING_APPROVAL') as string,
          action: 'submit',
          condition: { approverType: 'ROLE', approverId: poApproverRoleId },
        },
        {
          definitionId: poDefinition.id,
          fromStateId: poByCode.get('PENDING_APPROVAL') as string,
          toStateId: poByCode.get('APPROVED') as string,
          action: 'approve',
        },
        {
          definitionId: poDefinition.id,
          fromStateId: poByCode.get('PENDING_APPROVAL') as string,
          toStateId: poByCode.get('REJECTED') as string,
          action: 'reject',
        },
      ],
    });
  }

  // A ready-to-approve demo leave request sitting in the manager inbox.
  const annualLeave = await prisma.leaveType.findFirst({
    where: { companyId: org.companyId, code: 'AL' },
  });
  const existingLeaveRequest = await prisma.leaveRequest.findFirst({
    where: {
      companyId: org.companyId,
      employeeId: employeeIds[0] as string,
      startDate: new Date(`${year + 1}-01-05T00:00:00Z`),
    },
  });
  if (annualLeave && employeeIds[0] && !existingLeaveRequest) {
    await prisma.leaveRequest.create({
      data: {
        employeeId: employeeIds[0],
        leaveTypeId: annualLeave.id,
        companyId: org.companyId,
        branchId: org.branchId,
        startDate: new Date(`${year + 1}-01-05T00:00:00Z`),
        endDate: new Date(`${year + 1}-01-09T00:00:00Z`),
        requestedDays: 5,
        reason: 'Seed demo: pending approval',
        status: 'PENDING_APPROVAL',
        submittedAt: new Date(),
      },
    });
  }
}

/**
 * Payroll demo data (PRD Stage 4): a monthly pay group, a salary structure
 * with percentage/flat components, effective-dated assignments for the demo
 * employees, and a payroll_run workflow routed to FINANCE_MANAGER.
 */
async function ensurePayrollData(
  roleIds: Map<string, string>,
  org: { companyId: string; branchId: string },
): Promise<void> {
  const currency = await prisma.currency.findUnique({ where: { code: 'USD' } });
  if (!currency) throw new Error('USD currency missing after seed');

  const payGroup = await prisma.payGroup.upsert({
    where: { companyId_name: { companyId: org.companyId, name: 'Monthly Staff' } },
    update: {},
    create: {
      companyId: org.companyId,
      name: 'Monthly Staff',
      frequency: 'MONTHLY',
      currencyId: currency.id,
      payDayRule: 'LAST_DAY_OF_MONTH',
    },
  });

  const structure = await prisma.salaryStructure.upsert({
    where: { companyId_name: { companyId: org.companyId, name: 'Standard Staff' } },
    update: {},
    create: {
      companyId: org.companyId,
      name: 'Standard Staff',
      currencyId: currency.id,
      components: {
        create: [
          {
            code: 'BASIC',
            name: 'Basic Salary',
            type: 'EARNING',
            calculationMethod: 'PERCENT_OF_BASE',
            percentage: '100',
            taxable: true,
          },
          {
            code: 'HOUSING',
            name: 'Housing Allowance',
            type: 'EARNING',
            calculationMethod: 'PERCENT_OF_BASE',
            percentage: '25',
            taxable: true,
          },
          {
            code: 'TRANSPORT',
            name: 'Transport Allowance',
            type: 'EARNING',
            calculationMethod: 'FLAT',
            value: '150',
            taxable: true,
          },
          {
            code: 'PENSION_EE',
            name: 'Pension (Employee)',
            type: 'DEDUCTION',
            calculationMethod: 'PERCENT_OF_BASE',
            percentage: '5',
            taxable: false,
          },
          {
            code: 'PENSION_ER',
            name: 'Pension (Employer)',
            type: 'EMPLOYER_CONTRIBUTION',
            calculationMethod: 'PERCENT_OF_BASE',
            percentage: '10',
            taxable: false,
          },
        ],
      },
    },
  });

  const year = new Date().getUTCFullYear();
  const employees = await prisma.employee.findMany({
    where: { companyId: org.companyId, employmentStatus: 'ACTIVE' },
    orderBy: [{ employeeNo: 'asc' }],
  });
  const baseSalaries = ['4500.00', '3800.00', '3200.00'];
  for (const [index, employee] of employees.entries()) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { payGroupId: payGroup.id },
    });
    const existingAssignment = await prisma.employeeSalaryAssignment.findFirst({
      where: { employeeId: employee.id, status: 'ACTIVE', effectiveTo: null },
    });
    if (existingAssignment) continue;
    await prisma.employeeSalaryAssignment.create({
      data: {
        employeeId: employee.id,
        salaryStructureId: structure.id,
        effectiveFrom: new Date(`${year - 1}-01-01T00:00:00Z`),
        baseSalary: baseSalaries[index % baseSalaries.length] as string,
        currencyId: currency.id,
      },
    });
  }

  // payroll_run workflow: PENDING_APPROVAL goes to the FINANCE_MANAGER role.
  const existingPayrollWorkflow = await prisma.workflowDefinition.findFirst({
    where: { companyId: org.companyId, entityType: 'payroll_run', version: 1 },
  });
  if (!existingPayrollWorkflow) {
    const approverRoleId = roleIds.get('FINANCE_MANAGER');
    if (!approverRoleId) throw new Error('FINANCE_MANAGER role missing after seed');
    const definition = await prisma.workflowDefinition.create({
      data: {
        companyId: org.companyId,
        name: 'Payroll run approval',
        entityType: 'payroll_run',
        version: 1,
        status: 'ACTIVE',
      },
    });
    await prisma.workflowState.createMany({
      data: [
        {
          definitionId: definition.id,
          code: 'DRAFT',
          name: 'Draft',
          isInitial: true,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'PENDING_APPROVAL',
          name: 'Pending Approval',
          isInitial: false,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'APPROVED',
          name: 'Approved',
          isInitial: false,
          isTerminal: true,
        },
        {
          definitionId: definition.id,
          code: 'REJECTED',
          name: 'Rejected',
          isInitial: false,
          isTerminal: true,
        },
      ],
    });
    const states = await prisma.workflowState.findMany({ where: { definitionId: definition.id } });
    const byCode = new Map(states.map((s) => [s.code, s.id]));
    await prisma.workflowTransition.createMany({
      data: [
        {
          definitionId: definition.id,
          fromStateId: byCode.get('DRAFT') as string,
          toStateId: byCode.get('PENDING_APPROVAL') as string,
          action: 'submit',
          condition: { approverType: 'ROLE', approverId: approverRoleId },
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('APPROVED') as string,
          action: 'approve',
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('REJECTED') as string,
          action: 'reject',
        },
      ],
    });
  }
}

async function ensureInventoryData(
  roleIds: Map<string, string>,
  org: { companyId: string; branchId: string; warehouseId: string },
): Promise<void> {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: org.warehouseId } });
  if (!warehouse) throw new Error('Main warehouse missing after seed');
  const location = await prisma.warehouseLocation.findUnique({
    where: { warehouseId_code: { warehouseId: org.warehouseId, code: 'GENERAL' } },
  });
  if (!location) throw new Error('GENERAL warehouse location missing after seed');

  const unit = await prisma.unitOfMeasure.upsert({
    where: { companyId_code: { companyId: org.companyId, code: 'EA' } },
    update: {},
    create: { companyId: org.companyId, code: 'EA', name: 'Each', symbol: 'ea', precision: 0 },
  });

  const category = await prisma.productCategory.upsert({
    where: { companyId_code: { companyId: org.companyId, code: 'OFFICE' } },
    update: {},
    create: { companyId: org.companyId, code: 'OFFICE', name: 'Office Supplies' },
  });

  const demoProducts = [
    { sku: 'SKU-0001', name: 'A4 Copy Paper (ream)', standardCost: '4.50', reorderLevel: '20' },
    {
      sku: 'SKU-0002',
      name: 'Ballpoint Pen (box of 12)',
      standardCost: '3.20',
      reorderLevel: '15',
    },
    { sku: 'SKU-0003', name: 'Stapler', standardCost: '6.00', reorderLevel: '5' },
    { sku: 'SKU-0004', name: 'Sticky Notes (pack)', standardCost: '1.80', reorderLevel: '25' },
    { sku: 'SKU-0005', name: 'Whiteboard Marker (set)', standardCost: '5.40', reorderLevel: '10' },
  ];
  const productIds: string[] = [];
  for (const p of demoProducts) {
    const row = await prisma.product.upsert({
      where: { companyId_sku: { companyId: org.companyId, sku: p.sku } },
      update: {},
      create: {
        companyId: org.companyId,
        sku: p.sku,
        name: p.name,
        categoryId: category.id,
        productType: 'STOCK',
        baseUnitId: unit.id,
        standardCost: p.standardCost,
        reorderLevel: p.reorderLevel,
        reorderQty: '10',
      },
    });
    productIds.push(row.id);
  }

  // Opening stock: one RECEIPT movement + balance per product (idempotent —
  // the movement reference is unique per product, so re-seeding is a no-op).
  for (const [index, productId] of productIds.entries()) {
    const product = demoProducts[index];
    if (!product) continue;
    const existing = await prisma.stockMovement.findFirst({
      where: {
        productId,
        referenceType: 'opening_stock',
        referenceNo: 'OPENING',
      },
    });
    if (existing) continue;
    const quantity = '100';
    await prisma.$transaction(async (tx) => {
      await tx.stockBalance.create({
        data: {
          companyId: org.companyId,
          warehouseId: org.warehouseId,
          warehouseLocationId: location.id,
          productId,
          onHand: quantity,
          avgCost: product.standardCost,
        },
      });
      await tx.stockMovement.create({
        data: {
          companyId: org.companyId,
          warehouseId: org.warehouseId,
          warehouseLocationId: location.id,
          productId,
          movementType: 'RECEIPT',
          quantity,
          unitCost: product.standardCost,
          totalCost: (Number(product.standardCost) * 100).toFixed(2),
          referenceType: 'opening_stock',
          referenceNo: 'OPENING',
        },
      });
    });
  }

  // stock_adjustment workflow mirrors the payroll_run shape (DRAFT →
  // PENDING_APPROVAL → APPROVED/REJECTED, approver INVENTORY_MANAGER).
  const existingAdjWorkflow = await prisma.workflowDefinition.findFirst({
    where: { companyId: org.companyId, entityType: 'stock_adjustment', version: 1 },
  });
  if (!existingAdjWorkflow) {
    const approverRoleId = roleIds.get('INVENTORY_MANAGER');
    if (!approverRoleId) throw new Error('INVENTORY_MANAGER role missing after seed');
    const definition = await prisma.workflowDefinition.create({
      data: {
        companyId: org.companyId,
        name: 'Stock adjustment approval',
        entityType: 'stock_adjustment',
        version: 1,
        status: 'ACTIVE',
      },
    });
    await prisma.workflowState.createMany({
      data: [
        {
          definitionId: definition.id,
          code: 'DRAFT',
          name: 'Draft',
          isInitial: true,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'PENDING_APPROVAL',
          name: 'Pending Approval',
          isInitial: false,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'APPROVED',
          name: 'Approved',
          isInitial: false,
          isTerminal: true,
        },
        {
          definitionId: definition.id,
          code: 'REJECTED',
          name: 'Rejected',
          isInitial: false,
          isTerminal: true,
        },
      ],
    });
    const states = await prisma.workflowState.findMany({ where: { definitionId: definition.id } });
    const byCode = new Map(states.map((s) => [s.code, s.id]));
    await prisma.workflowTransition.createMany({
      data: [
        {
          definitionId: definition.id,
          fromStateId: byCode.get('DRAFT') as string,
          toStateId: byCode.get('PENDING_APPROVAL') as string,
          action: 'submit',
          condition: { approverType: 'ROLE', approverId: approverRoleId },
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('APPROVED') as string,
          action: 'approve',
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('REJECTED') as string,
          action: 'reject',
        },
      ],
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding foundation data...');
  const permissions = await ensurePermissions();
  console.log(`Permissions: ${permissions.size}`);
  const roles = await ensureRoles(permissions);
  console.log(`Roles: ${roles.size}`);
  console.log('Company tree, users, workflows, demo data...');
  const org = await ensureCompanyTree();
  console.log('Company tree ok');
  await ensureUsers(roles, org);
  console.log('Users ok');
  await ensureDemoWorkflow(roles, { companyId: org.companyId });
  console.log('Demo workflow ok');
  await ensureHrData(roles, {
    companyId: org.companyId,
    branchId: org.branchId,
    departmentId: org.departmentId,
  });
  console.log('HR data ok');
  await ensurePayrollData(roles, { companyId: org.companyId, branchId: org.branchId });
  console.log('Payroll data ok');
  await ensureInventoryData(roles, {
    companyId: org.companyId,
    branchId: org.branchId,
    warehouseId: org.warehouseId,
  });
  console.log('Inventory data ok');
  await ensureSalesData(roles, {
    companyId: org.companyId,
    branchId: org.branchId,
  });
  console.log('Sales data ok');
  await ensureAccountingData(roles, { companyId: org.companyId });
  console.log('Accounting data ok');
  await ensureOfficeData(roles, {
    companyId: org.companyId,
    branchId: org.branchId,
    departmentId: org.departmentId,
  });
  console.log('Office data ok');
  await ensureCommunicationData({ companyId: org.companyId });
  console.log('Communication data ok');
  await ensureReportingData({ companyId: org.companyId });
  console.log('Reporting data ok');
  console.log(
    'Seed complete. Users: admin@demo.local / manager@demo.local / finance@demo.local (password: Admin123!)',
  );
  console.log(
    'Demo workflows: purchase_request and leave_request to BRANCH_MANAGER; payroll_run to FINANCE_MANAGER; stock_adjustment to INVENTORY_MANAGER; sales_quotation and sales_order to SALES_MANAGER.',
  );
}

/**
 * Stage 8 accounting seed: journal approval workflow (DRAFT →
 * PENDING_APPROVAL → APPROVED/REJECTED, approver CHIEF_ACCOUNTANT). The
 * chart of accounts already exists from the foundation seed. Idempotent.
 */
async function ensureAccountingData(
  roleIds: Map<string, string>,
  org: { companyId: string },
): Promise<void> {
  const existing = await prisma.workflowDefinition.findFirst({
    where: { companyId: org.companyId, entityType: 'journal_entry', version: 1 },
  });
  if (existing) return;
  const approverRoleId = roleIds.get('CHIEF_ACCOUNTANT');
  if (!approverRoleId) throw new Error('CHIEF_ACCOUNTANT role missing after seed');
  const definition = await prisma.workflowDefinition.create({
    data: {
      companyId: org.companyId,
      name: 'Journal entry approval',
      entityType: 'journal_entry',
      version: 1,
      status: 'ACTIVE',
    },
  });
  await prisma.workflowState.createMany({
    data: [
      {
        definitionId: definition.id,
        code: 'DRAFT',
        name: 'Draft',
        isInitial: true,
        isTerminal: false,
      },
      {
        definitionId: definition.id,
        code: 'PENDING_APPROVAL',
        name: 'Pending Approval',
        isInitial: false,
        isTerminal: false,
      },
      {
        definitionId: definition.id,
        code: 'APPROVED',
        name: 'Approved',
        isInitial: false,
        isTerminal: true,
      },
      {
        definitionId: definition.id,
        code: 'REJECTED',
        name: 'Rejected',
        isInitial: false,
        isTerminal: true,
      },
    ],
  });
  const states = await prisma.workflowState.findMany({ where: { definitionId: definition.id } });
  const byCode = new Map(states.map((s) => [s.code, s.id]));
  await prisma.workflowTransition.createMany({
    data: [
      {
        definitionId: definition.id,
        fromStateId: byCode.get('DRAFT') as string,
        toStateId: byCode.get('PENDING_APPROVAL') as string,
        action: 'submit',
        condition: { approverType: 'ROLE', approverId: approverRoleId },
      },
      {
        definitionId: definition.id,
        fromStateId: byCode.get('PENDING_APPROVAL') as string,
        toStateId: byCode.get('APPROVED') as string,
        action: 'approve',
      },
      {
        definitionId: definition.id,
        fromStateId: byCode.get('PENDING_APPROVAL') as string,
        toStateId: byCode.get('REJECTED') as string,
        action: 'reject',
      },
    ],
  });
}

/**
 * Stage 7 sales seed: one demo customer plus quotation/order approval
 * workflows (DRAFT → PENDING_APPROVAL → APPROVED/REJECTED, approver
 * SALES_MANAGER). Idempotent.
 */
async function ensureSalesData(
  roleIds: Map<string, string>,
  org: { companyId: string; branchId: string },
): Promise<void> {
  const currency = await prisma.currency.findUnique({ where: { code: 'USD' } });
  if (!currency) throw new Error('USD currency missing after seed');

  const existingCustomer = await prisma.customer.findFirst({
    where: { companyId: org.companyId, customerNo: 'CUS-DEMO-001' },
  });
  if (!existingCustomer) {
    await prisma.customer.create({
      data: {
        companyId: org.companyId,
        branchId: org.branchId,
        customerNo: 'CUS-DEMO-001',
        legalName: 'Demo Customer LLC',
        displayName: 'Demo Customer',
        email: 'sales@democustomer.example',
        phone: '+1-555-0100',
        address: '100 Market Street, Springfield',
        currencyId: currency.id,
        creditLimit: '5000',
      },
    });
  }

  const approverRoleId = roleIds.get('SALES_MANAGER');
  if (!approverRoleId) throw new Error('SALES_MANAGER role missing after seed');

  const salesWorkflows: Array<{ entityType: string; name: string }> = [
    { entityType: 'sales_quotation', name: 'Sales quotation approval' },
    { entityType: 'sales_order', name: 'Sales order approval' },
  ];
  for (const wf of salesWorkflows) {
    const existing = await prisma.workflowDefinition.findFirst({
      where: { companyId: org.companyId, entityType: wf.entityType, version: 1 },
    });
    if (existing) continue;
    const definition = await prisma.workflowDefinition.create({
      data: {
        companyId: org.companyId,
        name: wf.name,
        entityType: wf.entityType,
        version: 1,
        status: 'ACTIVE',
      },
    });
    await prisma.workflowState.createMany({
      data: [
        {
          definitionId: definition.id,
          code: 'DRAFT',
          name: 'Draft',
          isInitial: true,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'PENDING_APPROVAL',
          name: 'Pending Approval',
          isInitial: false,
          isTerminal: false,
        },
        {
          definitionId: definition.id,
          code: 'APPROVED',
          name: 'Approved',
          isInitial: false,
          isTerminal: true,
        },
        {
          definitionId: definition.id,
          code: 'REJECTED',
          name: 'Rejected',
          isInitial: false,
          isTerminal: true,
        },
      ],
    });
    const states = await prisma.workflowState.findMany({ where: { definitionId: definition.id } });
    const byCode = new Map(states.map((s) => [s.code, s.id]));
    await prisma.workflowTransition.createMany({
      data: [
        {
          definitionId: definition.id,
          fromStateId: byCode.get('DRAFT') as string,
          toStateId: byCode.get('PENDING_APPROVAL') as string,
          action: 'submit',
          condition: { approverType: 'ROLE', approverId: approverRoleId },
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('APPROVED') as string,
          action: 'approve',
        },
        {
          definitionId: definition.id,
          fromStateId: byCode.get('PENDING_APPROVAL') as string,
          toStateId: byCode.get('REJECTED') as string,
          action: 'reject',
        },
      ],
    });
  }
}

/**
 * Stage 9 office seed: one record per office sub-domain so the module is
 * immediately explorable (visitors, call log, correspondence, file room).
 * Idempotent on the document numbers; roles granted automatically via
 * ensureRoles (RECEPTIONIST / FRONT_OFFICE_CLERK already include office).
 */
async function ensureOfficeData(
  _roleIds: Map<string, string>,
  org: { companyId: string; branchId: string; departmentId: string },
): Promise<void> {
  // Visitors.
  await prisma.visitor.upsert({
    where: { companyId_visitorNo: { companyId: org.companyId, visitorNo: 'VIS-DEMO-001' } },
    update: {},
    create: {
      companyId: org.companyId,
      branchId: org.branchId,
      visitorNo: 'VIS-DEMO-001',
      name: 'Fatima Zahra',
      companyName: 'Zahra Trading LLC',
      phone: '+1-555-0142',
      email: 'fatima@zahratrading.example',
      purpose: 'Supplier meeting with procurement',
      status: 'CHECKED_IN',
      checkInAt: new Date(),
      createdById: (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo.local' } }))
        .id,
    },
  });
  await prisma.visitor.upsert({
    where: { companyId_visitorNo: { companyId: org.companyId, visitorNo: 'VIS-DEMO-002' } },
    update: {},
    create: {
      companyId: org.companyId,
      branchId: org.branchId,
      visitorNo: 'VIS-DEMO-002',
      name: 'Marcus Webb',
      companyName: 'Webb Consulting',
      purpose: 'Quarterly audit review',
      status: 'EXPECTED',
      createdById: (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo.local' } }))
        .id,
    },
  });

  // Call log (CallLog has no document number in DATA-MODEL §22; dedupe on
  // caller + subject being present at all).
  const existingCall = await prisma.callLog.findFirst({
    where: {
      companyId: org.companyId,
      callerName: 'Priya Sharma',
      subject: 'Delivery window confirmation for PO',
    },
  });
  if (!existingCall) {
    await prisma.callLog.create({
      data: {
        companyId: org.companyId,
        branchId: org.branchId,
        callerName: 'Priya Sharma',
        callerPhone: '+1-555-0199',
        subject: 'Delivery window confirmation for PO',
        notes: 'Requested afternoon delivery; warehouse confirmed.',
        callTime: new Date(),
        direction: 'INBOUND',
        status: 'COMPLETED',
        createdById: (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo.local' } }))
          .id,
      },
    });
  }

  // Correspondence.
  await prisma.correspondence.upsert({
    where: {
      companyId_correspondenceNo: { companyId: org.companyId, correspondenceNo: 'CORR-DEMO-001' },
    },
    update: {},
    create: {
      companyId: org.companyId,
      branchId: org.branchId,
      correspondenceNo: 'CORR-DEMO-001',
      direction: 'INCOMING',
      correspondenceType: 'LETTER',
      sender: 'City Revenue Authority',
      recipient: 'Moves Fast Corp',
      subject: 'Quarterly tax filing reminder',
      receivedAt: new Date(),
      status: 'OPEN',
      createdById: (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo.local' } }))
        .id,
    },
  });

  // File room: one AVAILABLE and one ISSUED file with movement history.
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo.local' } });
  const managerUser = await prisma.user.findUniqueOrThrow({
    where: { email: 'manager@demo.local' },
  });
  await prisma.fileRecord.upsert({
    where: { companyId_fileNo: { companyId: org.companyId, fileNo: 'FILE-DEMO-001' } },
    update: {},
    create: {
      companyId: org.companyId,
      branchId: org.branchId,
      fileNo: 'FILE-DEMO-001',
      title: 'Employment contracts — Operations',
      category: 'HR',
      locationCode: 'CAB-A-02',
      status: 'AVAILABLE',
      notes: 'Original signed copies.',
      createdById: adminUser.id,
    },
  });
  const issuedFile = await prisma.fileRecord.upsert({
    where: { companyId_fileNo: { companyId: org.companyId, fileNo: 'FILE-DEMO-002' } },
    update: {},
    create: {
      companyId: org.companyId,
      branchId: org.branchId,
      fileNo: 'FILE-DEMO-002',
      title: 'Vendor agreements 2026',
      category: 'PROCUREMENT',
      locationCode: 'CAB-B-01',
      status: 'ISSUED',
      issuedToEmployeeId: managerUser.id,
      issuedAt: new Date(),
      createdById: adminUser.id,
    },
  });
  const movements = await prisma.fileMovement.count({ where: { fileId: issuedFile.id } });
  if (movements === 0) {
    await prisma.fileMovement.createMany({
      data: [
        {
          fileId: issuedFile.id,
          action: 'CREATED',
          actorUserId: adminUser.id,
          note: 'Registered',
        },
        {
          fileId: issuedFile.id,
          action: 'ISSUED',
          actorUserId: adminUser.id,
          issuedToEmployeeId: managerUser.id,
          note: 'For contract review',
        },
      ],
    });
  }
}

/**
 * Stage 10 communication seed: a direct chat and a group chat so the chat
 * surface has live history on first load (DATA-MODEL §22, USER-FLOWS §19.1).
 * Idempotent: conversations are matched before anything is written.
 */
async function ensureCommunicationData(org: { companyId: string }): Promise<void> {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo.local' } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: 'manager@demo.local' } });
  const clerk = await prisma.user.findUniqueOrThrow({ where: { email: 'office@demo.local' } });

  const bothParties = (a: string, b: string) =>
    [{ participants: { some: { userId: a } } }, { participants: { some: { userId: b } } }] as const;

  const direct = await prisma.conversation.findFirst({
    where: {
      companyId: org.companyId,
      type: 'DIRECT',
      AND: [...bothParties(admin.id, manager.id)],
    },
    select: { id: true },
  });
  if (!direct) {
    const created = await prisma.conversation.create({
      data: {
        companyId: org.companyId,
        type: 'DIRECT',
        createdById: admin.id,
        lastMessageAt: new Date(),
        participants: {
          create: [
            { userId: admin.id, role: 'OWNER' },
            { userId: manager.id, role: 'MEMBER' },
          ],
        },
        messages: {
          create: [
            {
              senderUserId: admin.id,
              messageType: 'TEXT',
              content: 'Please review the quarter-end pack before the board meeting.',
            },
            {
              senderUserId: manager.id,
              messageType: 'TEXT',
              content: 'On it — sales figures and the AR ageing look healthy so far.',
            },
          ],
        },
      },
      select: { id: true },
    });
    console.log(`[seed] direct chat ${created.id} created`);
  }

  const group = await prisma.conversation.findFirst({
    where: { companyId: org.companyId, type: 'GROUP', name: 'Operations' },
    select: { id: true },
  });
  if (!group) {
    const created = await prisma.conversation.create({
      data: {
        companyId: org.companyId,
        type: 'GROUP',
        name: 'Operations',
        createdById: admin.id,
        lastMessageAt: new Date(),
        participants: {
          create: [
            { userId: admin.id, role: 'OWNER' },
            { userId: manager.id, role: 'MEMBER' },
            { userId: clerk.id, role: 'MEMBER' },
          ],
        },
        messages: {
          create: [
            {
              senderUserId: admin.id,
              messageType: 'TEXT',
              content: 'Front office: visitor badges are ready at the reception desk.',
            },
            {
              senderUserId: clerk.id,
              messageType: 'TEXT',
              content: 'Received — I will hand them out and log arrivals in the register.',
            },
          ],
        },
      },
      select: { id: true },
    });
    console.log(`[seed] group chat ${created.id} created`);
  }
}

/**
 * Stage 11 reporting seed: the report catalogue. Each definition is a
 * declarative queryDefinition interpreted by the engine
 * (packages/reporting/src/engine.ts) — never SQL. Financial reports
 * read POSTED accounting data only, as UI-UX §21 requires. Idempotent:
 * definitions are upserted by their unique code.
 */
async function ensureReportingData(org: { companyId: string }): Promise<void> {
  const definitions: Array<{
    code: string;
    name: string;
    description: string;
    module: string;
    permission: string;
    queryDefinition: Record<string, unknown>;
  }> = [
    {
      code: 'GL_TRIAL_BALANCE',
      name: 'Trial balance',
      description: 'Debit and credit totals per account from posted journals.',
      module: 'accounting',
      permission: 'accounting.journal.view',
      queryDefinition: {
        source: 'JOURNAL_LINE',
        metrics: ['debit', 'credit'],
        dimensions: ['account', 'accountName', 'accountType'],
        defaultGrouping: ['account'],
        defaultSorting: { field: 'account', direction: 'asc' },
      },
    },
    {
      code: 'GL_VOLUME_BY_ACCOUNT_TYPE',
      name: 'Posted volume by account type',
      description: 'Activity level per account type, from posted journals.',
      module: 'accounting',
      permission: 'accounting.journal.view',
      queryDefinition: {
        source: 'JOURNAL_LINE',
        metrics: ['debit', 'credit'],
        dimensions: ['accountType', 'account'],
        defaultGrouping: ['accountType'],
        defaultSorting: { field: 'debit', direction: 'desc' },
      },
    },
    {
      code: 'AR_OUTSTANDING',
      name: 'Customer receivables',
      description: 'Outstanding customer invoices by customer.',
      module: 'accounting',
      permission: 'accounting.ar.view',
      queryDefinition: {
        source: 'CUSTOMER_INVOICE',
        metrics: ['grandTotal', 'balance', 'invoiceCount'],
        dimensions: ['customer', 'customerName', 'status'],
        defaultGrouping: ['customerName'],
        defaultSorting: { field: 'balance', direction: 'desc' },
      },
    },
    {
      code: 'AP_OUTSTANDING',
      name: 'Supplier payables',
      description: 'Outstanding supplier invoices by supplier.',
      module: 'accounting',
      permission: 'accounting.ap.view',
      queryDefinition: {
        source: 'SUPPLIER_INVOICE',
        metrics: ['grandTotal', 'balance', 'invoiceCount'],
        dimensions: ['supplier', 'supplierName', 'status'],
        defaultGrouping: ['supplierName'],
        defaultSorting: { field: 'balance', direction: 'desc' },
      },
    },
    {
      code: 'SALES_BY_CUSTOMER',
      name: 'Sales orders by customer',
      description: 'Order value and tax per customer.',
      module: 'sales',
      permission: 'sales.order.view',
      queryDefinition: {
        source: 'SALES_ORDER',
        metrics: ['grandTotal', 'taxTotal', 'orderCount'],
        dimensions: ['customer', 'customerName', 'status', 'branch'],
        defaultGrouping: ['customerName'],
        defaultSorting: { field: 'grandTotal', direction: 'desc' },
      },
    },
    {
      code: 'PROCUREMENT_BY_SUPPLIER',
      name: 'Purchase orders by supplier',
      description: 'Committed spend per supplier.',
      module: 'procurement',
      permission: 'procurement.purchase_order.view',
      queryDefinition: {
        source: 'PURCHASE_ORDER',
        metrics: ['grandTotal', 'taxTotal', 'orderCount'],
        dimensions: ['supplier', 'supplierName', 'status', 'warehouse'],
        defaultGrouping: ['supplierName'],
        defaultSorting: { field: 'grandTotal', direction: 'desc' },
      },
    },
    {
      code: 'STOCK_BY_PRODUCT',
      name: 'Stock on hand by product',
      description: 'On hand and reserved quantities per product.',
      module: 'inventory',
      permission: 'inventory.stock.view',
      queryDefinition: {
        source: 'STOCK_BALANCE',
        metrics: ['onHand', 'reserved', 'balanceCount'],
        dimensions: ['product', 'productName', 'warehouse'],
        defaultGrouping: ['productName'],
        defaultSorting: { field: 'onHand', direction: 'desc' },
      },
    },
    {
      code: 'PAYROLL_COST',
      name: 'Payroll cost',
      description: 'Gross and net payroll cost per run.',
      module: 'payroll',
      permission: 'payroll.payroll_run.view',
      queryDefinition: {
        source: 'PAYROLL_RUN',
        metrics: ['totalGross', 'totalNet', 'employeeCount'],
        dimensions: ['branch', 'status'],
        defaultGrouping: ['branch'],
        defaultSorting: { field: 'totalGross', direction: 'desc' },
      },
    },
    {
      code: 'HEADCOUNT',
      name: 'Headcount',
      description: 'Employees per department and branch.',
      module: 'hr',
      permission: 'hr.employee.view',
      queryDefinition: {
        source: 'EMPLOYEE',
        metrics: ['headcount'],
        dimensions: ['department', 'branch', 'status'],
        defaultGrouping: ['department'],
      },
    },
  ];

  for (const definition of definitions) {
    await prisma.reportDefinition.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        description: definition.description,
        module: definition.module,
        permission: definition.permission,
        queryDefinition: definition.queryDefinition as never,
        status: 'ACTIVE',
      },
      create: { ...definition, queryDefinition: definition.queryDefinition as never },
    });
  }
  console.log(`Report definitions: ${definitions.length}`);

  // A saved configuration and a schedule for the demo admin account.
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@demo.local' } });
  const trialBalance = await prisma.reportDefinition.findUniqueOrThrow({
    where: { code: 'GL_TRIAL_BALANCE' },
  });

  const existingSaved = await prisma.savedReport.findFirst({
    where: { userId: admin.id, reportDefinitionId: trialBalance.id, name: 'Quarter to date' },
  });
  if (!existingSaved) {
    await prisma.savedReport.create({
      data: {
        userId: admin.id,
        reportDefinitionId: trialBalance.id,
        name: 'Quarter to date',
        filters: { from: '2026-07-01', to: '2026-09-30' },
        columns: [],
        grouping: ['accountType'],
        sorting: { field: 'debit', direction: 'desc' },
      },
    });
  }

  const existingSchedule = await prisma.scheduledReport.findFirst({
    where: { ownerUserId: admin.id, reportDefinitionId: trialBalance.id },
  });
  if (!existingSchedule) {
    const schedule = { frequency: 'WEEKLY', time: '07:00', dayOfWeek: 1 };
    await prisma.scheduledReport.create({
      data: {
        reportDefinitionId: trialBalance.id,
        ownerUserId: admin.id,
        companyId: org.companyId,
        schedule: JSON.stringify(schedule),
        timezone: 'UTC',
        filters: {},
        outputFormat: 'CSV',
        deliveryChannel: 'IN_APP',
        recipientConfiguration: { userIds: [admin.id], emails: [] },
        status: 'ACTIVE',
        nextRunAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })

  .finally(() => prisma.$disconnect());
