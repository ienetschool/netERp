import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { BusinessRuleError, NotFoundError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { OutboxService } from '../platform/outbox.service.js';
import { WorkflowEngineService } from '../workflow/workflow-engine.service.js';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import type {
  EmployeeCreateInput,
  EmployeeUpdateInput,
  AttendanceUpsertInput,
  LeaveRequestCreateInput,
  HolidayCreateInput,
} from '@erp/validation';

/**
 * HR module (PRD Stage 3): employees, attendance, leave, holidays.
 * Leave requests with requiresApproval leave types are started on the
 * `leave_request` workflow and land in the approver inbox automatically.
 */
@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowEngineService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---- Employees -----------------------------------------------------------

  async createEmployee(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    input: EmployeeCreateInput,
    requestId: string | null,
  ): Promise<unknown> {
    const employee = await this.prisma.employee.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        departmentId: input.departmentId ?? null,
        employeeNo: input.employeeNo,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        lastName: input.lastName,
        displayName: [input.firstName, input.middleName, input.lastName].filter(Boolean).join(' '),
        gender: input.gender ?? null,
        dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null,
        nationality: input.nationality ?? null,
        nationalId: input.nationalId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        hireDate: new Date(`${input.hireDate}T00:00:00Z`),
        employmentType: input.employmentType ?? null,
        jobTitle: input.jobTitle ?? null,
        managerEmployeeId: input.managerEmployeeId ?? null,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'hr.employee_created',
      resourceType: 'employee',
      resourceId: employee.id,
      companyId: employee.companyId,
      branchId: employee.branchId,
      requestId,
    });
    return employee;
  }

  async listEmployees(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    pagination: { page: number; pageSize: number },
  ): Promise<unknown> {
    const where = {
      status: 'ACTIVE',
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ employeeNo: 'asc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { rows, total };
  }

  async getEmployee(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    id: string,
  ): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee || employee.status === 'ARCHIVED') throw new NotFoundError('Employee not found');
    if (principal.companyIds && !principal.companyIds.includes(employee.companyId)) {
      throw new NotFoundError('Employee not found');
    }
    return employee;
  }

  async updateEmployee(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    id: string,
    input: EmployeeUpdateInput,
    requestId: string | null,
  ): Promise<unknown> {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing || existing.status === 'ARCHIVED') throw new NotFoundError('Employee not found');
    if (principal.companyIds && !principal.companyIds.includes(existing.companyId)) {
      throw new NotFoundError('Employee not found');
    }
    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.firstName !== undefined ||
        input.middleName !== undefined ||
        input.lastName !== undefined
          ? {
              displayName: [input.firstName, input.middleName, input.lastName].some(
                (v) => v !== undefined,
              )
                ? [
                    input.firstName ?? existing.firstName,
                    input.middleName ?? existing.middleName,
                    input.lastName ?? existing.lastName,
                  ]
                    .filter(Boolean)
                    .join(' ')
                : existing.displayName,
            }
          : {}),
        ...(
          [
            'firstName',
            'middleName',
            'lastName',
            'gender',
            'nationality',
            'nationalId',
            'email',
            'phone',
            'address',
            'employmentType',
            'jobTitle',
            'managerEmployeeId',
          ] as const
        ).reduce<Record<string, string | null>>((acc, key) => {
          const value: string | null | undefined = input[key];
          if (value !== undefined) acc[key] = value;
          return acc;
        }, {}),
        ...(input.dateOfBirth !== undefined
          ? { dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null }
          : {}),
        ...(input.hireDate !== undefined
          ? { hireDate: new Date(`${input.hireDate}T00:00:00Z`) }
          : {}),
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'hr.employee_updated',
      resourceType: 'employee',
      resourceId: id,
      companyId: existing.companyId,
      requestId,
    });
    return employee;
  }

  async setEmploymentStatus(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    id: string,
    employmentStatus: string,
    requestId: string | null,
  ): Promise<unknown> {
    const allowed = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RETIRED'];
    if (!allowed.includes(employmentStatus)) {
      throw new BusinessRuleError(`Employment status must be one of ${allowed.join(', ')}`);
    }
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Employee not found');
    if (principal.companyIds && !principal.companyIds.includes(existing.companyId)) {
      throw new NotFoundError('Employee not found');
    }
    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        employmentStatus,
        ...(employmentStatus === 'TERMINATED' || employmentStatus === 'RETIRED'
          ? { terminationDate: new Date() }
          : {}),
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'hr.employee_status_changed',
      resourceType: 'employee',
      resourceId: id,
      companyId: existing.companyId,
      requestId,
      metadata: { employmentStatus },
    });
    return employee;
  }

  // ---- Attendance ----------------------------------------------------------

  async upsertAttendance(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    input: AttendanceUpsertInput,
  ): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw new NotFoundError('Employee not found');
    if (principal.companyIds && !principal.companyIds.includes(employee.companyId)) {
      throw new NotFoundError('Employee not found');
    }
    const date = new Date(`${input.attendanceDate}T00:00:00Z`);
    const row = await this.prisma.attendance.upsert({
      where: {
        employeeId_attendanceDate: { employeeId: input.employeeId, attendanceDate: date },
      },
      update: {
        status: input.status,
        clockIn: input.clockIn ? new Date(input.clockIn) : undefined,
        clockOut: input.clockOut ? new Date(input.clockOut) : undefined,
        workedMinutes: input.workedMinutes,
        overtimeMinutes: input.overtimeMinutes,
        notes: input.notes,
      },
      create: {
        employeeId: input.employeeId,
        companyId: employee.companyId,
        branchId: input.branchId ?? employee.branchId,
        attendanceDate: date,
        status: input.status,
        clockIn: input.clockIn ? new Date(input.clockIn) : null,
        clockOut: input.clockOut ? new Date(input.clockOut) : null,
        workedMinutes: input.workedMinutes ?? null,
        overtimeMinutes: input.overtimeMinutes ?? null,
        notes: input.notes ?? null,
      },
    });
    return row;
  }

  async listAttendance(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    query: { employeeId?: string; from?: string; to?: string; page: number; pageSize: number },
  ): Promise<unknown> {
    const where: Prisma.AttendanceWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.from || query.to
        ? {
            attendanceDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00Z`) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        orderBy: [{ attendanceDate: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { employee: { select: { employeeNo: true, displayName: true } } },
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Leave ---------------------------------------------------------------

  async createLeaveRequest(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    input: LeaveRequestCreateInput,
    requestId: string | null,
  ): Promise<unknown> {
    const employee = await this.prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw new NotFoundError('Employee not found');
    if (principal.companyIds && !principal.companyIds.includes(employee.companyId)) {
      throw new NotFoundError('Employee not found');
    }
    const leaveType = await this.prisma.leaveType.findUnique({ where: { id: input.leaveTypeId } });
    if (!leaveType || leaveType.companyId !== employee.companyId) {
      throw new NotFoundError('Leave type not found');
    }
    if (new Date(input.endDate) < new Date(input.startDate)) {
      throw new BusinessRuleError('Leave end date is before start date');
    }

    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        companyId: employee.companyId,
        branchId: input.branchId ?? employee.branchId,
        startDate: new Date(`${input.startDate}T00:00:00Z`),
        endDate: new Date(`${input.endDate}T00:00:00Z`),
        requestedDays: input.requestedDays,
        reason: input.reason ?? null,
        status: 'DRAFT',
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'hr.leave_request_created',
      resourceType: 'leave_request',
      resourceId: request.id,
      companyId: request.companyId,
      requestId,
    });
    return request;
  }

  /**
   * Submits a leave request: DRAFT → SUBMITTED, then starts the
   * `leave_request` workflow when the leave type requires approval. Arrival in
   * PENDING_APPROVAL is driven by the definition's submit transition approver.
   */
  async submitLeaveRequest(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    id: string,
    requestId: string | null,
  ): Promise<unknown> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { leaveType: true },
    });
    if (!request) throw new NotFoundError('Leave request not found');
    if (request.status !== 'DRAFT') {
      throw new BusinessRuleError(`Leave request is ${request.status.toLowerCase()}, not DRAFT`);
    }
    if (principal.companyIds && !principal.companyIds.includes(request.companyId)) {
      throw new NotFoundError('Leave request not found');
    }

    let workflowInstanceId: string | null = null;
    if (request.leaveType.requiresApproval) {
      const started = await this.workflow.startInstance({
        entityType: 'leave_request',
        entityId: request.id,
        companyId: request.companyId,
        actorUserId: principal.userId,
      });
      workflowInstanceId = started.instanceId;
      // Advance DRAFT → PENDING_APPROVAL via the definition's submit action so
      // the approver declared on that transition receives the task.
      await this.workflow.executeTransition({
        instanceId: started.instanceId,
        action: 'submit',
        actorUserId: principal.userId,
        amount: request.requestedDays.toString(),
      });
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', submittedAt: new Date(), workflowInstanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'hr.leave_request_submitted',
      resourceType: 'leave_request',
      resourceId: id,
      companyId: request.companyId,
      requestId,
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'hr.leave_request.submitted',
        aggregateType: 'leave_request',
        aggregateId: id,
        payload: { employeeId: request.employeeId, workflowInstanceId },
      },
      this.prisma,
    );
    return updated;
  }

  /** Bridges workflow terminal states back onto the leave request. */
  async applyWorkflowOutcome(
    instanceId: string,
    outcome: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    actorUserId: string,
  ): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { workflowInstanceId: instanceId },
    });
    if (!request) return; // workflow instance not bound to a leave request
    if (request.status !== 'PENDING_APPROVAL') return;

    await this.prisma.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: outcome,
        ...(outcome === 'APPROVED'
          ? { approvedAt: new Date(), approvedBy: actorUserId }
          : { rejectedAt: new Date(), rejectedBy: actorUserId }),
      },
    });
  }

  async listLeaveRequests(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    query: { status?: string; employeeId?: string; page: number; pageSize: number },
  ): Promise<unknown> {
    const where: Prisma.LeaveRequestWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          employee: { select: { employeeNo: true, displayName: true } },
          leaveType: { select: { code: true, name: true } },
        },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Holidays ------------------------------------------------------------

  async createHoliday(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    input: HolidayCreateInput,
    requestId: string | null,
  ): Promise<unknown> {
    const holiday = await this.prisma.holiday.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        name: input.name,
        holidayDate: new Date(`${input.holidayDate}T00:00:00Z`),
        isRecurring: input.isRecurring,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'hr.holiday_created',
      resourceType: 'holiday',
      resourceId: holiday.id,
      companyId: holiday.companyId,
      requestId,
    });
    return holiday;
  }

  async listHolidays(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    year: number,
  ): Promise<unknown> {
    const where: Prisma.HolidayWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      holidayDate: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
      },
    };
    return this.prisma.holiday.findMany({ where, orderBy: [{ holidayDate: 'asc' }] });
  }

  /** Leaves types for dropdowns on create forms. */
  async listLeaveTypes(
    principal: RequestPrincipal & { isSuperAdmin?: boolean },
    companyId?: string | null,
  ): Promise<unknown> {
    const where: Prisma.LeaveTypeWhereInput = {
      status: 'ACTIVE',
      ...(principal.companyIds
        ? { companyId: { in: principal.companyIds } }
        : companyId
          ? { companyId }
          : {}),
    };
    return this.prisma.leaveType.findMany({ where, orderBy: [{ code: 'asc' }] });
  }
}
