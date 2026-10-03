import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { NotFoundError, BusinessRuleError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { NumberingService } from '../platform/numbering.service.js';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import type {
  visitorCheckInSchema,
  visitorCheckOutSchema,
  callCompleteSchema,
  correspondenceCreateSchema,
  correspondenceAssignSchema,
  fileCreateSchema,
  fileIssueSchema,
  fileReturnSchema,
  fileArchiveSchema,
} from '@erp/validation';
import type { z } from 'zod';

type Principal = RequestPrincipal;
type VisitorCheckInInput = z.infer<typeof visitorCheckInSchema>;
type VisitorCheckOutInput = z.infer<typeof visitorCheckOutSchema>;
type CallCompleteInput = z.infer<typeof callCompleteSchema>;
type CorrespondenceCreateInput = z.infer<typeof correspondenceCreateSchema>;
type CorrespondenceAssignInput = z.infer<typeof correspondenceAssignSchema>;
type FileCreateInput = z.infer<typeof fileCreateSchema>;
type FileIssueInput = z.infer<typeof fileIssueSchema>;
type FileReturnInput = z.infer<typeof fileReturnSchema>;
type FileArchiveInput = z.infer<typeof fileArchiveSchema>;

const FILE_MOVEMENT_ACTION = {
  CREATED: 'CREATED',
  ISSUED: 'ISSUED',
  RETURNED: 'RETURNED',
  ARCHIVED: 'ARCHIVED',
} as const;

/**
 * Office management (Stage 9, PRD §4.4): visitors (USER-FLOWS §18.1), call
 * log, correspondence registry (§18.2) and the physical file room (§18.3).
 * Every lifecycle move is state-gated and audit-recorded; visits, calls and
 * correspondence are operational records — no approval workflow or GL postings.
 */
@Injectable()
export class OfficeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private scopeGuard(principal: Principal, companyId: string): void {
    if (principal.companyIds && !principal.companyIds.includes(companyId)) {
      throw new NotFoundError('Resource not found in your scope');
    }
  }

  // ---- Visitors -----------------------------------------------------------

  async createVisitor(
    principal: Principal,
    input: {
      companyId: string;
      branchId?: string | null;
      name: string;
      companyName?: string | null;
      phone?: string | null;
      email?: string | null;
      hostEmployeeId?: string | null;
      purpose?: string | null;
    },
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    return this.prisma.$transaction(async (tx) => {
      const visitorNo = await this.numbering.nextDocumentNumber(tx, input.companyId, 'VISITOR');
      const visitor = await tx.visitor.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          visitorNo,
          name: input.name,
          companyName: input.companyName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          hostEmployeeId: input.hostEmployeeId ?? null,
          purpose: input.purpose ?? null,
          status: 'EXPECTED',
          createdById: principal.userId,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.visitor_created',
          resourceType: 'visitor',
          resourceId: visitor.id,
          companyId: input.companyId,
          requestId,
          metadata: { visitorNo },
        },
        tx,
      );
      return visitor;
    });
  }

  async checkInVisitor(
    principal: Principal,
    id: string,
    input: VisitorCheckInInput,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const visitor = await tx.visitor.findUnique({ where: { id } });
      if (!visitor) throw new NotFoundError('Visitor not found');
      this.scopeGuard(principal, visitor.companyId);
      if (visitor.status !== 'EXPECTED') {
        throw new BusinessRuleError(`Visitor is ${visitor.status.toLowerCase()}, not EXPECTED`);
      }
      const updated = await tx.visitor.update({
        where: { id },
        data: {
          status: 'CHECKED_IN',
          checkInAt: new Date(),
          ...(input.purpose ? { purpose: input.purpose } : {}),
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.visitor_checked_in',
          resourceType: 'visitor',
          resourceId: id,
          companyId: visitor.companyId,
          requestId,
          metadata: { visitorNo: visitor.visitorNo },
        },
        tx,
      );
      return updated;
    });
  }

  async checkOutVisitor(
    principal: Principal,
    id: string,
    _input: VisitorCheckOutInput,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const visitor = await tx.visitor.findUnique({ where: { id } });
      if (!visitor) throw new NotFoundError('Visitor not found');
      this.scopeGuard(principal, visitor.companyId);
      if (visitor.status !== 'CHECKED_IN') {
        throw new BusinessRuleError(`Visitor is ${visitor.status.toLowerCase()}, not CHECKED_IN`);
      }
      const updated = await tx.visitor.update({
        where: { id },
        data: { status: 'CHECKED_OUT', checkOutAt: new Date() },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.visitor_checked_out',
          resourceType: 'visitor',
          resourceId: id,
          companyId: visitor.companyId,
          requestId,
          metadata: { visitorNo: visitor.visitorNo },
        },
        tx,
      );
      return updated;
    });
  }

  async listVisitors(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.VisitorWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.visitor.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.visitor.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Call log -----------------------------------------------------------

  async createCall(
    principal: Principal,
    input: {
      companyId: string;
      branchId?: string | null;
      callerName: string;
      callerPhone?: string | null;
      recipientEmployeeId?: string | null;
      subject: string;
      notes?: string | null;
      callTime?: Date | null;
      direction: 'INBOUND' | 'OUTBOUND';
    },
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    return this.prisma.$transaction(async (tx) => {
      const call = await tx.callLog.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          callerName: input.callerName,
          callerPhone: input.callerPhone ?? null,
          recipientEmployeeId: input.recipientEmployeeId ?? null,
          subject: input.subject,
          notes: input.notes ?? null,
          callTime: input.callTime ?? new Date(),
          direction: input.direction,
          status: 'OPEN',
          createdById: principal.userId,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.call_created',
          resourceType: 'call_log',
          resourceId: call.id,
          companyId: input.companyId,
          requestId,
          metadata: { callerName: input.callerName, subject: input.subject },
        },
        tx,
      );
      return call;
    });
  }

  async completeCall(
    principal: Principal,
    id: string,
    input: CallCompleteInput,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const call = await tx.callLog.findUnique({ where: { id } });
      if (!call) throw new NotFoundError('Call not found');
      this.scopeGuard(principal, call.companyId);
      if (call.status !== 'OPEN') {
        throw new BusinessRuleError(`Call is ${call.status.toLowerCase()}, not OPEN`);
      }
      const updated = await tx.callLog.update({
        where: { id },
        data: { status: 'COMPLETED', ...(input.notes ? { notes: input.notes } : {}) },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.call_completed',
          resourceType: 'call_log',
          resourceId: id,
          companyId: call.companyId,
          requestId,
          metadata: { callerName: call.callerName },
        },
        tx,
      );
      return updated;
    });
  }

  async listCalls(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.CallLogWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.callLog.findMany({
        where,
        orderBy: [{ callTime: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.callLog.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Correspondence -----------------------------------------------------

  async createCorrespondence(
    principal: Principal,
    input: CorrespondenceCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    return this.prisma.$transaction(async (tx) => {
      const correspondenceNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        'CORRESPONDENCE',
      );
      const correspondence = await tx.correspondence.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          correspondenceNo,
          direction: input.direction,
          correspondenceType: input.correspondenceType,
          sender: input.sender,
          recipient: input.recipient,
          subject: input.subject,
          receivedAt: input.receivedAt ?? null,
          sentAt: input.sentAt ?? null,
          documentId: input.documentId ?? null,
          status: 'OPEN',
          createdById: principal.userId,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.correspondence_created',
          resourceType: 'correspondence',
          resourceId: correspondence.id,
          companyId: input.companyId,
          requestId,
          metadata: { correspondenceNo, direction: input.direction },
        },
        tx,
      );
      return correspondence;
    });
  }

  async assignCorrespondence(
    principal: Principal,
    id: string,
    input: CorrespondenceAssignInput,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const correspondence = await tx.correspondence.findUnique({ where: { id } });
      if (!correspondence) throw new NotFoundError('Correspondence not found');
      this.scopeGuard(principal, correspondence.companyId);
      if (correspondence.status === 'CLOSED') {
        throw new BusinessRuleError('Correspondence is CLOSED and cannot be reassigned');
      }
      const updated = await tx.correspondence.update({
        where: { id },
        data: { assignedTo: input.assignedTo, status: 'IN_PROGRESS' },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.correspondence_assigned',
          resourceType: 'correspondence',
          resourceId: id,
          companyId: correspondence.companyId,
          requestId,
          metadata: { correspondenceNo: correspondence.correspondenceNo },
        },
        tx,
      );
      return updated;
    });
  }

  async closeCorrespondence(principal: Principal, id: string, requestId: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const correspondence = await tx.correspondence.findUnique({ where: { id } });
      if (!correspondence) throw new NotFoundError('Correspondence not found');
      this.scopeGuard(principal, correspondence.companyId);
      if (correspondence.status === 'CLOSED') {
        throw new BusinessRuleError('Correspondence already CLOSED');
      }
      const updated = await tx.correspondence.update({
        where: { id },
        data: { status: 'CLOSED' },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.correspondence_closed',
          resourceType: 'correspondence',
          resourceId: id,
          companyId: correspondence.companyId,
          requestId,
          metadata: { correspondenceNo: correspondence.correspondenceNo },
        },
        tx,
      );
      return updated;
    });
  }

  async listCorrespondence(
    principal: Principal,
    query: { status?: string; direction?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.CorrespondenceWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.correspondence.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.correspondence.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- File room ----------------------------------------------------------

  async createFile(principal: Principal, input: FileCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    return this.prisma.$transaction(async (tx) => {
      const fileNo = await this.numbering.nextDocumentNumber(tx, input.companyId, 'FILE');
      const file = await tx.fileRecord.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          fileNo,
          title: input.title,
          category: input.category ?? null,
          locationCode: input.locationCode ?? null,
          notes: input.notes ?? null,
          status: 'AVAILABLE',
          createdById: principal.userId,
        },
      });
      await tx.fileMovement.create({
        data: {
          fileId: file.id,
          action: FILE_MOVEMENT_ACTION.CREATED,
          actorUserId: principal.userId,
          note: 'Registered',
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.file_created',
          resourceType: 'file_record',
          resourceId: file.id,
          companyId: input.companyId,
          requestId,
          metadata: { fileNo },
        },
        tx,
      );
      return file;
    });
  }

  async issueFile(
    principal: Principal,
    id: string,
    input: FileIssueInput,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileRecord.findUnique({ where: { id } });
      if (!file) throw new NotFoundError('File not found');
      this.scopeGuard(principal, file.companyId);
      if (file.status !== 'AVAILABLE') {
        throw new BusinessRuleError(`File is ${file.status.toLowerCase()}, not AVAILABLE`);
      }
      const updated = await tx.fileRecord.update({
        where: { id },
        data: {
          status: 'ISSUED',
          issuedToEmployeeId: input.issuedToEmployeeId,
          issuedAt: new Date(),
          dueAt: input.dueAt ?? null,
        },
      });
      await tx.fileMovement.create({
        data: {
          fileId: id,
          action: FILE_MOVEMENT_ACTION.ISSUED,
          actorUserId: principal.userId,
          issuedToEmployeeId: input.issuedToEmployeeId,
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.file_issued',
          resourceType: 'file_record',
          resourceId: id,
          companyId: file.companyId,
          requestId,
          metadata: { fileNo: file.fileNo },
        },
        tx,
      );
      return updated;
    });
  }

  async returnFile(
    principal: Principal,
    id: string,
    input: FileReturnInput,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileRecord.findUnique({ where: { id } });
      if (!file) throw new NotFoundError('File not found');
      this.scopeGuard(principal, file.companyId);
      if (file.status !== 'ISSUED') {
        throw new BusinessRuleError(`File is ${file.status.toLowerCase()}, not ISSUED`);
      }
      const updated = await tx.fileRecord.update({
        where: { id },
        data: {
          status: 'AVAILABLE',
          returnedAt: new Date(),
          issuedToEmployeeId: null,
        },
      });
      await tx.fileMovement.create({
        data: {
          fileId: id,
          action: FILE_MOVEMENT_ACTION.RETURNED,
          actorUserId: principal.userId,
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.file_returned',
          resourceType: 'file_record',
          resourceId: id,
          companyId: file.companyId,
          requestId,
          metadata: { fileNo: file.fileNo },
        },
        tx,
      );
      return updated;
    });
  }

  async archiveFile(
    principal: Principal,
    id: string,
    input: FileArchiveInput,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.fileRecord.findUnique({ where: { id } });
      if (!file) throw new NotFoundError('File not found');
      this.scopeGuard(principal, file.companyId);
      if (file.status === 'ISSUED') {
        throw new BusinessRuleError('File is ISSUED; it must be returned before archiving');
      }
      if (file.status === 'ARCHIVED') {
        throw new BusinessRuleError('File already ARCHIVED');
      }
      const updated = await tx.fileRecord.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      });
      await tx.fileMovement.create({
        data: {
          fileId: id,
          action: FILE_MOVEMENT_ACTION.ARCHIVED,
          actorUserId: principal.userId,
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          actorUserId: principal.userId,
          action: 'office.file_archived',
          resourceType: 'file_record',
          resourceId: id,
          companyId: file.companyId,
          requestId,
          metadata: { fileNo: file.fileNo },
        },
        tx,
      );
      return updated;
    });
  }

  async listFiles(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.FileRecordWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.fileRecord.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { movements: { orderBy: { at: 'desc' }, take: 5 } },
      }),
      this.prisma.fileRecord.count({ where }),
    ]);
    return { rows, total };
  }

  async getFileMovements(principal: Principal, id: string) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id } });
    if (!file) throw new NotFoundError('File not found');
    this.scopeGuard(principal, file.companyId);
    const movements = await this.prisma.fileMovement.findMany({
      where: { fileId: id },
      orderBy: { at: 'desc' },
    });
    return { data: movements };
  }
}
