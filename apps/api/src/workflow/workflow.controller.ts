import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { RequirePermissions } from '../iam/permissions.guard.js';
import { WorkflowEngineService } from './workflow-engine.service.js';
import { PrismaService } from '@erp/prisma';
import { AuditService } from '../common/audit.service.js';
import { OutboxService } from '../platform/outbox.service.js';
import { HrService } from '../hr/hr.service.js';
import { ValidationError, NotFoundError } from '../common/errors.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import {
  workflowDefinitionSchema,
  workflowStartSchema,
  workflowActSchema,
  workflowTransitionSchema,
} from '@erp/validation';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

function requirePrincipal(req: AuthedRequest): RequestPrincipal {
  if (!req.principal) throw new NotFoundError('Principal missing');
  return req.principal;
}

/**
 * Workflow & approval endpoints (PRD Stage 2: workflow engine + approval inbox).
 */
@Controller('workflow')
@UseGuards(JwtAuthGuard)
export class WorkflowController {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly hr: HrService,
  ) {}

  // ---- Definitions ---------------------------------------------------------

  @Get('definitions')
  @RequirePermissions('workflow.workflow_definition.view')
  async listDefinitions(): Promise<unknown> {
    const definitions = await this.engine.listDefinitions();
    return { data: definitions };
  }

  @Post('definitions')
  @RequirePermissions('workflow.workflow_definition.create')
  async createDefinition(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = workflowDefinitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid workflow definition', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const input = parsed.data;
    const definition = await this.engine.createDefinition({
      companyId: input.companyId ?? null,
      name: input.name,
      entityType: input.entityType,
      states: input.states,
      transitions: input.transitions,
      actorUserId: principal.userId,
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'workflow.definition_created',
      resourceType: 'workflow_definition',
      resourceId: definition.id,
      companyId: input.companyId ?? null,
      requestId: getRequestId(req),
    });
    return { data: definition };
  }

  // ---- Instances -----------------------------------------------------------

  @Get('instances')
  @RequirePermissions('workflow.workflow_definition.view')
  async listInstances(): Promise<unknown> {
    const instances = await this.engine.listInstances();
    return { data: instances };
  }

  @Get('instances/:id')
  @RequirePermissions('workflow.workflow_definition.view')
  async getInstance(@Param('id') id: string): Promise<unknown> {
    const instance = await this.engine.getInstanceDetail(id);
    return { data: instance };
  }

  @Post('instances')
  @RequirePermissions('workflow.workflow_definition.create')
  async startInstance(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = workflowStartSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid workflow start request', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const result = await this.engine.startInstance({
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      companyId: parsed.data.companyId ?? null,
      actorUserId: principal.userId,
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'workflow.instance_started',
      resourceType: 'workflow_instance',
      resourceId: result.instanceId,
      requestId: getRequestId(req),
      metadata: { entityType: parsed.data.entityType, entityId: parsed.data.entityId },
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'workflow.instance.started',
        aggregateType: 'workflow_instance',
        aggregateId: result.instanceId,
        payload: {
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
          currentState: result.currentState,
        },
      },
      this.prisma,
    );
    return { data: result };
  }

  @Post('instances/:id/transition')
  @RequirePermissions('workflow.workflow_definition.edit')
  async transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = workflowTransitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid transition request', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const result = await this.engine.executeTransition({
      instanceId: id,
      action: parsed.data.action,
      actorUserId: principal.userId,
      amount: parsed.data.amount,
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'workflow.transition_executed',
      resourceType: 'workflow_instance',
      resourceId: id,
      requestId: getRequestId(req),
      metadata: { action: parsed.data.action, toState: result.currentState },
    });
    return { data: result };
  }

  // ---- Approval inbox ------------------------------------------------------

  @Get('approval-tasks')
  async inbox(
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const tasks = await this.engine.inboxForUser(principal.userId, status);
    return { data: tasks, meta: { requestId: getRequestId(req) } };
  }

  @Post('approval-tasks/:id/act')
  async act(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = workflowActSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Invalid approval action', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const result = await this.engine.act(id, parsed.data.decision, principal.userId, {
      comments: parsed.data.comments,
      rejectionReason: parsed.data.rejectionReason,
      amount: parsed.data.amount,
    });
    // Bridge the decision back onto the owning entity (DATA-MODEL §17:
    // workflow outcomes drive domain status). Domain-specific updates stay in
    // the owning module; new entity types add a case here or subscribe to the
    // workflow.approval.acted outbox event in the worker.
    if (result.entityType === 'leave_request') {
      await this.hr.applyWorkflowOutcome(
        result.instanceId,
        result.instanceStatus,
        principal.userId,
      );
    }
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'workflow.approval_acted',
      resourceType: 'approval_task',
      resourceId: id,
      requestId: getRequestId(req),
      metadata: { decision: parsed.data.decision, instanceStatus: result.instanceStatus },
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'workflow.approval.acted',
        aggregateType: 'approval_task',
        aggregateId: id,
        payload: {
          entityType: result.entityType,
          entityId: result.entityId,
          decision: parsed.data.decision,
          instanceStatus: result.instanceStatus,
          currentState: result.currentState,
        },
      },
      this.prisma,
    );
    return { data: result };
  }
}
