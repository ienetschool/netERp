import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { Money, sumMoney } from '@erp/types';
import { BusinessRuleError, NotFoundError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { OutboxService } from '../platform/outbox.service.js';
import { WorkflowEngineService } from '../workflow/workflow-engine.service.js';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import type {
  PayGroupCreateInput,
  SalaryStructureCreateInput,
  SalaryAssignmentCreateInput,
  PayrollRunCreateInput,
} from '@erp/validation';

type Principal = RequestPrincipal & { isSuperAdmin?: boolean };

/** Component codes below these defaults must exist in the company COA. */
const DEFAULT_EXPENSE_ACCOUNT_CODE = '5100';
const DEFAULT_LIABILITY_ACCOUNT_CODE = '2200';

export interface PayrollException {
  employeeNo: string | null;
  employeeName: string;
  reason: string;
}

export interface JournalLinePayload {
  accountCode: string;
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  amount: string;
  description: string;
}

export interface JournalPayload {
  journalDate: string;
  currencyId: string;
  sourceType: 'payroll_run';
  sourceId: string;
  lines: JournalLinePayload[];
  totals: { debits: string; credits: string };
}

/**
 * Converts a percentage decimal string into a multiplication factor by
 * shifting the decimal point two places — exact string math, no binary float.
 * Examples: "7.5" -> "0.075", "100" -> "1", "0.5" -> "0.005".
 */
export function percentToFactor(percent: string): string {
  if (!/^\d+(\.\d+)?$/.test(percent)) {
    throw new BusinessRuleError(`Invalid percentage: ${percent}`);
  }
  const [intPart, frac = ''] = percent.split('.');
  const int = intPart ?? '0';
  const padded = int.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}${frac}`;
}

/**
 * Payroll module (PRD Stage 4): pay groups, salary structures, effective-dated
 * salary assignments, and the payroll engine (calculate -> approve -> post).
 *
 * Posting emits a balanced journal payload on the outbox for the accounting
 * vertical slice to persist as a Journal; until that stage lands, no GL rows
 * are written (CLAUDE.md §43: never invent financial effects).
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowEngineService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private scopeGuard(principal: Principal, companyId: string): void {
    if (principal.companyIds && !principal.companyIds.includes(companyId)) {
      throw new NotFoundError('Record not found');
    }
  }

  // ---- Pay groups ----------------------------------------------------------

  async createPayGroup(principal: Principal, input: PayGroupCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const payGroup = await this.prisma.payGroup.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        frequency: input.frequency,
        currencyId: input.currencyId,
        payDayRule: input.payDayRule,
        payDayValue: input.payDayValue ?? null,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.pay_group_created',
      resourceType: 'pay_group',
      resourceId: payGroup.id,
      companyId: payGroup.companyId,
      requestId,
    });
    return payGroup;
  }

  async listPayGroups(principal: Principal) {
    const where: Prisma.PayGroupWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    return this.prisma.payGroup.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      include: { currency: { select: { code: true } }, _count: { select: { employees: true } } },
    });
  }

  // ---- Salary structures ---------------------------------------------------

  async createSalaryStructure(
    principal: Principal,
    input: SalaryStructureCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const codes = new Set<string>();
    for (const c of input.components) {
      if (codes.has(c.code)) {
        throw new BusinessRuleError(`Duplicate component code ${c.code}`);
      }
      codes.add(c.code);
    }
    const structure = await this.prisma.salaryStructure.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        currencyId: input.currencyId,
        components: {
          create: input.components.map((c) => ({
            code: c.code,
            name: c.name,
            type: c.type,
            calculationMethod: c.calculationMethod,
            value: c.value ?? null,
            percentage: c.percentage ?? null,
            accountId: c.accountId ?? null,
            taxable: c.taxable,
          })),
        },
      },
      include: { components: { orderBy: [{ type: 'asc' }, { code: 'asc' }] } },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.salary_structure_created',
      resourceType: 'salary_structure',
      resourceId: structure.id,
      companyId: structure.companyId,
      requestId,
    });
    return structure;
  }

  async listSalaryStructures(principal: Principal) {
    const where: Prisma.SalaryStructureWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    return this.prisma.salaryStructure.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      include: {
        currency: { select: { code: true } },
        components: { orderBy: [{ type: 'asc' }, { code: 'asc' }] },
        _count: { select: { assignments: true } },
      },
    });
  }

  // ---- Salary assignments (effective-dated; CLAUDE.md §44 history rule) ----

  async assignSalary(
    principal: Principal,
    input: SalaryAssignmentCreateInput,
    requestId: string | null,
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw new NotFoundError('Employee not found');
    this.scopeGuard(principal, employee.companyId);

    const structure = await this.prisma.salaryStructure.findUnique({
      where: { id: input.salaryStructureId },
    });
    if (!structure || structure.companyId !== employee.companyId) {
      throw new NotFoundError('Salary structure not found');
    }

    const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00Z`);
    const baseSalary = Money.fromDecimalString(input.baseSalary);
    if (baseSalary.isNegative()) {
      throw new BusinessRuleError('Base salary cannot be negative');
    }

    const assignment = await this.prisma.$transaction(async (tx) => {
      // Close the currently ACTIVE assignment the day before the new one starts.
      const current = await tx.employeeSalaryAssignment.findFirst({
        where: { employeeId: employee.id, status: 'ACTIVE', effectiveTo: null },
        orderBy: [{ effectiveFrom: 'desc' }],
      });
      if (current) {
        const dayBefore = new Date(effectiveFrom.getTime() - 24 * 60 * 60 * 1000);
        if (dayBefore < new Date(current.effectiveFrom)) {
          throw new BusinessRuleError(
            'Effective date overlaps the current active salary assignment',
          );
        }
        await tx.employeeSalaryAssignment.update({
          where: { id: current.id },
          data: { effectiveTo: dayBefore, status: 'SUPERSEDED' },
        });
      }
      return tx.employeeSalaryAssignment.create({
        data: {
          employeeId: employee.id,
          salaryStructureId: structure.id,
          effectiveFrom,
          baseSalary: baseSalary.toString(),
          currencyId: structure.currencyId,
        },
      });
    });

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.salary_assigned',
      resourceType: 'employee_salary_assignment',
      resourceId: assignment.id,
      companyId: employee.companyId,
      requestId,
      metadata: { employeeId: employee.id, effectiveFrom: input.effectiveFrom },
    });
    return assignment;
  }

  async listSalaryAssignments(
    principal: Principal,
    query: { employeeId?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.EmployeeSalaryAssignmentWhereInput = {
      ...(principal.companyIds ? { employee: { companyId: { in: principal.companyIds } } } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employeeSalaryAssignment.findMany({
        where,
        orderBy: [{ effectiveFrom: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          employee: { select: { employeeNo: true, displayName: true } },
          salaryStructure: { select: { name: true } },
          currency: { select: { code: true } },
        },
      }),
      this.prisma.employeeSalaryAssignment.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Payroll runs --------------------------------------------------------

  async createPayrollRun(
    principal: Principal,
    input: PayrollRunCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const payGroup = await this.prisma.payGroup.findUnique({ where: { id: input.payGroupId } });
    if (!payGroup || payGroup.companyId !== input.companyId) {
      throw new NotFoundError('Pay group not found');
    }
    const run = await this.prisma.payrollRun.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        payGroupId: payGroup.id,
        periodStart: new Date(`${input.periodStart}T00:00:00Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00Z`),
        paymentDate: new Date(`${input.paymentDate}T00:00:00Z`),
        currencyId: payGroup.currencyId,
        createdById: principal.userId,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.run_created',
      resourceType: 'payroll_run',
      resourceId: run.id,
      companyId: run.companyId,
      requestId,
    });
    return run;
  }

  async listPayrollRuns(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.PayrollRunWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payrollRun.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          payGroup: { select: { name: true, frequency: true } },
          currency: { select: { code: true } },
          _count: { select: { entries: true } },
        },
      }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return { rows, total };
  }

  /** Run detail with per-employee payslip entries and their lines. */
  async getPayrollRun(principal: Principal, id: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        payGroup: { select: { name: true, frequency: true } },
        currency: { select: { code: true } },
        entries: {
          orderBy: [{ createdAt: 'asc' }],
          include: {
            employee: { select: { employeeNo: true, displayName: true } },
            lines: {
              orderBy: [{ createdAt: 'asc' }],
              include: { salaryComponent: { select: { code: true, name: true, type: true } } },
            },
          },
        },
      },
    });
    if (!run) throw new NotFoundError('Payroll run not found');
    this.scopeGuard(principal, run.companyId);
    return run;
  }

  /**
   * Payroll calculation (USER-FLOWS §9.2): base salary + earnings − deductions;
   * employer cost tracked separately. Employees are skipped as exceptions when
   * no effective salary assignment covers the period or the assignment currency
   * does not match the run currency. All arithmetic goes through Money.
   */
  async calculatePayrollRun(principal: Principal, id: string, requestId: string | null) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('Payroll run not found');
    this.scopeGuard(principal, run.companyId);
    if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') {
      throw new BusinessRuleError(`Payroll run is ${run.status.toLowerCase()}; cannot calculate`);
    }

    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'CALCULATING' } });

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: run.companyId,
        employmentStatus: 'ACTIVE',
        status: 'ACTIVE',
        payGroupId: run.payGroupId,
        ...(run.branchId ? { branchId: run.branchId } : {}),
      },
      orderBy: [{ employeeNo: 'asc' }],
    });

    const exceptions: PayrollException[] = [];
    const plan: Array<{
      employee: { id: string; employeeNo: string; displayName: string };
      assignment: { id: string; baseSalary: string };
      components: Array<{
        id: string;
        name: string;
        type: string;
        calculationMethod: string;
        value: string | null;
        percentage: string | null;
        accountId: string | null;
        taxable: boolean;
      }>;
    }> = [];

    for (const employee of employees) {
      const assignment = await this.prisma.employeeSalaryAssignment.findFirst({
        where: {
          employeeId: employee.id,
          status: 'ACTIVE',
          effectiveFrom: { lte: run.periodEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodStart } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }],
      });
      if (!assignment) {
        exceptions.push({
          employeeNo: employee.employeeNo,
          employeeName: employee.displayName,
          reason: 'No effective salary assignment covers this period',
        });
        continue;
      }
      if (assignment.currencyId !== run.currencyId) {
        exceptions.push({
          employeeNo: employee.employeeNo,
          employeeName: employee.displayName,
          reason: 'Salary assignment currency does not match the run currency',
        });
        continue;
      }
      const components = await this.prisma.salaryComponent.findMany({
        where: { salaryStructureId: assignment.salaryStructureId, status: 'ACTIVE' },
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
      });
      plan.push({
        employee: {
          id: employee.id,
          employeeNo: employee.employeeNo,
          displayName: employee.displayName,
        },
        assignment: { id: assignment.id, baseSalary: assignment.baseSalary.toString() },
        components: components.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          calculationMethod: c.calculationMethod,
          value: c.value?.toString() ?? null,
          percentage: c.percentage?.toString() ?? null,
          accountId: c.accountId,
          taxable: c.taxable,
        })),
      });
    }

    const entriesData = plan.map(({ employee, assignment, components }) => {
      const base = Money.fromDecimalString(assignment.baseSalary);
      let gross = Money.zero();
      let deductions = Money.zero();
      let employerCost = Money.zero();
      const lines = components.map((c) => {
        const amount =
          c.calculationMethod === 'FLAT'
            ? Money.fromDecimalString(c.value as string)
            : Money.fromDecimalString(
                base.multiplyByFactor(percentToFactor(c.percentage as string)).toString(),
              );
        if (c.type === 'EARNING') gross = gross.plus(amount);
        else if (c.type === 'DEDUCTION') deductions = deductions.plus(amount);
        else employerCost = employerCost.plus(amount);
        return {
          salaryComponentId: c.id,
          description: c.name,
          quantity: '1',
          rate: amount.toString(),
          amount: amount.toString(),
          taxable: c.taxable,
          accountId: c.accountId,
        };
      });
      const net = gross.minus(deductions);
      return {
        employeeId: employee.id,
        grossAmount: gross.toString(),
        deductionAmount: deductions.toString(),
        netAmount: net.toString(),
        employerCost: employerCost.toString(),
        lines,
      };
    });

    const totalGross = sumMoney(entriesData.map((e) => Money.fromDecimalString(e.grossAmount)));
    const totalDeductions = sumMoney(
      entriesData.map((e) => Money.fromDecimalString(e.deductionAmount)),
    );
    const totalNet = sumMoney(entriesData.map((e) => Money.fromDecimalString(e.netAmount)));
    const totalEmployerCost = sumMoney(
      entriesData.map((e) => Money.fromDecimalString(e.employerCost)),
    );

    // Invariant: lines reconcile to entry totals (CLAUDE.md §40, USER-FLOWS §28.8).
    for (const entry of entriesData) {
      const linesSum = sumMoney(entry.lines.map((l) => Money.fromDecimalString(l.amount)));
      const expected = Money.fromDecimalString(entry.grossAmount)
        .plus(Money.fromDecimalString(entry.deductionAmount))
        .plus(Money.fromDecimalString(entry.employerCost));
      if (!linesSum.eq(expected)) {
        throw new BusinessRuleError('Payroll lines do not reconcile to entry totals');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payrollEntry.deleteMany({ where: { payrollRunId: run.id } });
      for (const entry of entriesData) {
        await tx.payrollEntry.create({
          data: {
            payrollRunId: run.id,
            employeeId: entry.employeeId,
            grossAmount: entry.grossAmount,
            deductionAmount: entry.deductionAmount,
            netAmount: entry.netAmount,
            employerCost: entry.employerCost,
            lines: { create: entry.lines },
          },
        });
      }
      return tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: 'CALCULATED',
          employeeCount: entriesData.length,
          totalGross: totalGross.toString(),
          totalDeductions: totalDeductions.toString(),
          totalNet: totalNet.toString(),
          totalEmployerCost: totalEmployerCost.toString(),
          exceptions: exceptions as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.run_calculated',
      resourceType: 'payroll_run',
      resourceId: run.id,
      companyId: run.companyId,
      requestId,
      metadata: { employeeCount: entriesData.length, exceptionCount: exceptions.length },
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'payroll.run.calculated',
        aggregateType: 'payroll_run',
        aggregateId: run.id,
        payload: {
          employeeCount: entriesData.length,
          totalGross: totalGross.toString(),
          totalNet: totalNet.toString(),
          exceptionCount: exceptions.length,
        },
      },
      this.prisma,
    );
    return { run: updated, exceptions };
  }

  /**
   * Submits a CALCULATED run for approval (USER-FLOWS §9.3). When a
   * `payroll_run` workflow definition exists the run goes through the approval
   * inbox; the APPROVED/REJECTED/CANCELLED status is applied by
   * applyWorkflowOutcome when the decision lands.
   */
  async submitPayrollRun(principal: Principal, id: string, requestId: string | null) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('Payroll run not found');
    this.scopeGuard(principal, run.companyId);
    if (run.status !== 'CALCULATED') {
      throw new BusinessRuleError(`Payroll run is ${run.status.toLowerCase()}, not CALCULATED`);
    }

    const definition = await this.workflow.resolveDefinition('payroll_run', run.companyId);
    let workflowInstanceId: string | null = run.workflowInstanceId;
    if (definition && !workflowInstanceId) {
      const started = await this.workflow.startInstance({
        entityType: 'payroll_run',
        entityId: run.id,
        companyId: run.companyId,
        actorUserId: principal.userId,
      });
      await this.workflow.executeTransition({
        instanceId: started.instanceId,
        action: 'submit',
        actorUserId: principal.userId,
        amount: run.totalNet.toString(),
      });
      workflowInstanceId = started.instanceId;
    }

    const updated = await this.prisma.payrollRun.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', workflowInstanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.run_submitted',
      resourceType: 'payroll_run',
      resourceId: id,
      companyId: run.companyId,
      requestId,
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'payroll.run.submitted',
        aggregateType: 'payroll_run',
        aggregateId: id,
        payload: { workflowInstanceId },
      },
      this.prisma,
    );
    return updated;
  }

  /** Direct approval for runs submitted without a workflow definition. */
  async approvePayrollRun(principal: Principal, id: string, requestId: string | null) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('Payroll run not found');
    this.scopeGuard(principal, run.companyId);
    if (run.status !== 'PENDING_APPROVAL') {
      throw new BusinessRuleError(
        `Payroll run is ${run.status.toLowerCase()}, not PENDING_APPROVAL`,
      );
    }
    if (run.workflowInstanceId) {
      throw new BusinessRuleError(
        'This run is on a workflow; approve it through the approval inbox',
      );
    }
    const updated = await this.prisma.payrollRun.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: principal.userId, approvedAt: new Date() },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.run_approved',
      resourceType: 'payroll_run',
      resourceId: id,
      companyId: run.companyId,
      requestId,
    });
    return updated;
  }

  /** Bridges workflow terminal states back onto the payroll run. */
  async applyWorkflowOutcome(
    instanceId: string,
    outcome: string,
    actorUserId: string,
  ): Promise<void> {
    if (outcome === 'IN_PROGRESS') return;
    const run = await this.prisma.payrollRun.findUnique({
      where: { workflowInstanceId: instanceId },
    });
    if (!run) return;
    if (run.status !== 'PENDING_APPROVAL') return;

    if (outcome === 'COMPLETED') {
      await this.prisma.payrollRun.update({
        where: { id: run.id },
        data: { status: 'APPROVED', approvedBy: actorUserId, approvedAt: new Date() },
      });
      return;
    }
    if (outcome === 'REJECTED') {
      // Rejected runs fall back to CALCULATED for correction and resubmission.
      await this.prisma.payrollRun.update({
        where: { id: run.id },
        data: { status: 'CALCULATED' },
      });
      return;
    }
    await this.prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'CANCELLED' } });
  }

  /**
   * Posts an APPROVED run (USER-FLOWS §9.4): validates an open financial period
   * covering the payment date and emits a balanced journal payload on the
   * outbox. The accounting vertical slice persists the Journal; payroll
   * accounting therefore always reconciles to payroll totals by construction
   * (debits = gross + employer cost = net + deductions = credits).
   */
  async postPayrollRun(principal: Principal, id: string, requestId: string | null) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('Payroll run not found');
    this.scopeGuard(principal, run.companyId);
    if (run.status !== 'APPROVED') {
      throw new BusinessRuleError(`Payroll run is ${run.status.toLowerCase()}, not APPROVED`);
    }

    const openPeriod = await this.prisma.financialPeriod.findFirst({
      where: {
        companyId: run.companyId,
        status: 'OPEN',
        startDate: { lte: run.paymentDate },
        endDate: { gte: run.paymentDate },
      },
    });
    if (!openPeriod) {
      throw new BusinessRuleError('No open financial period covers the payment date');
    }

    const [expenseAccount, liabilityAccount] = await Promise.all([
      this.prisma.account.findFirst({
        where: { companyId: run.companyId, accountCode: DEFAULT_EXPENSE_ACCOUNT_CODE },
      }),
      this.prisma.account.findFirst({
        where: { companyId: run.companyId, accountCode: DEFAULT_LIABILITY_ACCOUNT_CODE },
      }),
    ]);
    if (!expenseAccount || !liabilityAccount) {
      throw new BusinessRuleError(
        'Payroll posting accounts missing from the chart of accounts (5100 expense, 2200 liabilities)',
      );
    }

    const gross = Money.fromDecimalString(run.totalGross.toString());
    const deductions = Money.fromDecimalString(run.totalDeductions.toString());
    const net = Money.fromDecimalString(run.totalNet.toString());
    const employerCost = Money.fromDecimalString(run.totalEmployerCost.toString());

    const lines: JournalLinePayload[] = [];
    if (!gross.isZero()) {
      lines.push({
        accountCode: expenseAccount.accountCode,
        accountId: expenseAccount.id,
        side: 'DEBIT',
        amount: gross.toString(),
        description: 'Salaries expense',
      });
    }
    if (!employerCost.isZero()) {
      lines.push({
        accountCode: expenseAccount.accountCode,
        accountId: expenseAccount.id,
        side: 'DEBIT',
        amount: employerCost.toString(),
        description: 'Employer cost',
      });
    }
    if (!net.isZero()) {
      lines.push({
        accountCode: liabilityAccount.accountCode,
        accountId: liabilityAccount.id,
        side: 'CREDIT',
        amount: net.toString(),
        description: 'Net salaries payable',
      });
    }
    if (!deductions.isZero()) {
      lines.push({
        accountCode: liabilityAccount.accountCode,
        accountId: liabilityAccount.id,
        side: 'CREDIT',
        amount: deductions.toString(),
        description: 'Deductions payable',
      });
    }

    const debits = sumMoney(
      lines.filter((l) => l.side === 'DEBIT').map((l) => Money.fromDecimalString(l.amount)),
    );
    const credits = sumMoney(
      lines.filter((l) => l.side === 'CREDIT').map((l) => Money.fromDecimalString(l.amount)),
    );
    if (!debits.eq(credits)) {
      throw new BusinessRuleError('Payroll journal does not balance');
    }
    const journal: JournalPayload = {
      journalDate: run.paymentDate.toISOString().slice(0, 10),
      currencyId: run.currencyId,
      sourceType: 'payroll_run',
      sourceId: run.id,
      lines,
      totals: { debits: debits.toString(), credits: credits.toString() },
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: 'POSTED', postedBy: principal.userId, postedAt: new Date() },
      });
      await tx.payrollEntry.updateMany({
        where: { payrollRunId: run.id },
        data: { status: 'POSTED' },
      });
      await this.outbox.emit(
        {
          eventType: 'payroll.run.posted',
          aggregateType: 'payroll_run',
          aggregateId: run.id,
          payload: { journal },
        },
        tx,
      );
      return row;
    });

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.run_posted',
      resourceType: 'payroll_run',
      resourceId: id,
      companyId: run.companyId,
      requestId,
      metadata: { journalTotals: journal.totals },
    });
    return updated;
  }

  async cancelPayrollRun(principal: Principal, id: string, requestId: string | null) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('Payroll run not found');
    this.scopeGuard(principal, run.companyId);
    if (!['DRAFT', 'CALCULATED', 'PENDING_APPROVAL'].includes(run.status)) {
      throw new BusinessRuleError(
        `Payroll run is ${run.status.toLowerCase()} and cannot be cancelled`,
      );
    }
    const updated = await this.prisma.payrollRun.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'payroll.run_cancelled',
      resourceType: 'payroll_run',
      resourceId: id,
      companyId: run.companyId,
      requestId,
    });
    return updated;
  }
}
