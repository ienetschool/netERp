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

async function main(): Promise<void> {
  console.log('Seeding foundation data...');
  const permissions = await ensurePermissions();
  console.log(`Permissions: ${permissions.size}`);
  const roles = await ensureRoles(permissions);
  console.log(`Roles: ${roles.size}`);
  const org = await ensureCompanyTree();
  await ensureUsers(roles, org);
  await ensureDemoWorkflow(roles, { companyId: org.companyId });
  await ensureHrData(roles, {
    companyId: org.companyId,
    branchId: org.branchId,
    departmentId: org.departmentId,
  });
  await ensurePayrollData(roles, { companyId: org.companyId, branchId: org.branchId });
  console.log(
    'Seed complete. Users: admin@demo.local / manager@demo.local / finance@demo.local (password: Admin123!)',
  );
  console.log(
    'Demo workflows: purchase_request and leave_request to BRANCH_MANAGER; payroll_run to FINANCE_MANAGER.',
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })

  .finally(() => prisma.$disconnect());
