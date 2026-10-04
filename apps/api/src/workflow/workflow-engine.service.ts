import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { Money } from '@erp/types';
import { BusinessRuleError, NotFoundError } from '../common/errors.js';
import type { Prisma } from '@erp/prisma';

export interface StartInstanceInput {
  entityType: string;
  entityId: string;
  companyId?: string | null;
  actorUserId: string;
}

export interface ExecuteTransitionInput {
  instanceId: string;
  action: string;
  actorUserId: string;
  comments?: string | undefined;
  /** Decimal-string entity amount, used for threshold-based approver routing. */
  amount?: string | undefined;
}

export interface StartInstanceResult {
  instanceId: string;
  currentState: string;
  approvalTasksCreated: number;
}

export type InstanceStatus = 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface ActResult {
  currentState: string | null;
  instanceStatus: InstanceStatus;
  /** Entity binding, so callers can apply domain outcomes (e.g. leave requests). */
  instanceId: string;
  entityType: string;
  entityId: string;
}

export interface ApprovalTaskView {
  id: string;
  step: number;
  status: string;
  dueAt: Date | null;
  entityType: string;
  entityId: string;
  /** The document number a human recognises, e.g. "JE-2026-000004". */
  entityLabel: string | null;
  currentState: string;
  workflow: string;
}

interface ApproverSpec {
  approverType: 'USER' | 'ROLE';
  approverId: string;
}

export interface CreateDefinitionInput {
  companyId: string | null;
  name: string;
  entityType: string;
  states: Array<{ code: string; name: string; isInitial: boolean; isTerminal: boolean }>;
  transitions: Array<{
    from: string;
    to: string;
    action: string;
    approverType?: string;
    approverId?: string;
  }>;
  actorUserId: string;
}

/**
 * Parses the approver declaration stored on a transition's `condition` JSON:
 * `{ approverType, approverId }` plus optional `amountRules` bands
 * (`{ minAmount?, maxAmount?, approverType, approverId }` — first match wins,
 * `[min, max)` semantics, evaluated only when an entity amount is supplied)
 * and `amountField` naming the entity amount field (DATA-MODEL §17: approval
 * rules depend on user, role, amount). Transitions without approver info are
 * unguarded.
 */
export function parseApprover(
  condition: Prisma.JsonValue | null,
  amount?: string,
): ApproverSpec | null {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null;
  const record = condition as Record<string, unknown>;

  const rules: unknown = record.amountRules;
  if (amount !== undefined && Array.isArray(rules)) {
    const entityAmount = Money.fromDecimalString(amount);
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
      const band = rule as Record<string, unknown>;
      if (
        (band.approverType !== 'USER' && band.approverType !== 'ROLE') ||
        typeof band.approverId !== 'string'
      ) {
        continue;
      }
      if (band.minAmount !== undefined && typeof band.minAmount !== 'string') continue;
      if (band.maxAmount !== undefined && typeof band.maxAmount !== 'string') continue;
      const minOk =
        band.minAmount === undefined || entityAmount.gte(Money.fromDecimalString(band.minAmount));
      const maxOk =
        band.maxAmount === undefined || !entityAmount.gte(Money.fromDecimalString(band.maxAmount));
      if (minOk && maxOk) {
        return { approverType: band.approverType, approverId: band.approverId };
      }
    }
  }

  const { approverType, approverId } = record;
  if ((approverType !== 'USER' && approverType !== 'ROLE') || typeof approverId !== 'string') {
    return null;
  }
  return { approverType, approverId };
}

/**
 * Workflow engine (DATA-MODEL §17, PRD Stage 2 "Workflow engine").
 *
 * Executes definitions persisted via WorkflowDefinition/State/Transition.
 * Arriving at a non-terminal state through a transition whose `condition`
 * declares an approver creates a PENDING ApprovalTask; further transitions are
 * blocked until the task is decided via `act()` (approve / reject / cancel).
 */
@Injectable()
export class WorkflowEngineService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the newest ACTIVE definition for an entity type (company override first). */
  async resolveDefinition(
    entityType: string,
    companyId?: string | null,
  ): Promise<{ id: string; name: string } | null> {
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: {
        entityType,
        status: 'ACTIVE',
        OR: [...(companyId ? [{ companyId }] : []), { companyId: null }],
      },
      orderBy: [{ version: 'desc' }],
    });
    if (!definition) return null;
    return { id: definition.id, name: definition.name };
  }

  /** Starts an instance in the definition's initial state. */
  async startInstance(
    input: StartInstanceInput,
    tx?: Prisma.TransactionClient,
  ): Promise<StartInstanceResult> {
    const client = tx ?? this.prisma;
    const definition = await this.resolveDefinition(input.entityType, input.companyId);
    if (!definition) {
      throw new NotFoundError(`No active workflow definition for entity type ${input.entityType}`);
    }

    const states = await client.workflowState.findMany({ where: { definitionId: definition.id } });
    const initial = states.find((s) => s.isInitial);
    if (!initial) {
      throw new BusinessRuleError(`Workflow ${definition.name} has no initial state`);
    }

    const existing = await client.workflowInstance.findFirst({
      where: {
        entityType: input.entityType,
        entityId: input.entityId,
        definitionId: definition.id,
      },
    });
    if (existing) {
      throw new BusinessRuleError('A workflow instance already exists for this entity');
    }

    const instance = await client.workflowInstance.create({
      data: {
        definitionId: definition.id,
        entityType: input.entityType,
        entityId: input.entityId,
        currentState: initial.code,
      },
    });

    // The initial state is not reached via a transition, so no approver applies.
    return {
      instanceId: instance.id,
      currentState: initial.code,
      approvalTasksCreated: 0,
    };
  }

  /**
   * Executes a named transition from the instance's current state.
   * Rejected while an approval decision is pending — the decision must come
   * through `act()`.
   */
  async executeTransition(
    input: ExecuteTransitionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ currentState: string; approvalTasksCreated: number; completed: boolean }> {
    const client = tx ?? this.prisma;
    const instance = await client.workflowInstance.findUnique({
      where: { id: input.instanceId },
    });
    if (!instance) throw new NotFoundError('Workflow instance not found');
    if (instance.completedAt) {
      throw new BusinessRuleError('Workflow instance already completed');
    }

    const pendingTask = await client.approvalTask.findFirst({
      where: { instanceId: instance.id, status: 'PENDING' },
    });
    if (pendingTask) {
      throw new BusinessRuleError('An approval decision is pending for this workflow step');
    }

    const states = await client.workflowState.findMany({
      where: { definitionId: instance.definitionId },
    });
    const byId = new Map(states.map((s) => [s.id, s]));
    const fromState = states.find((s) => s.code === instance.currentState);
    if (!fromState) {
      throw new BusinessRuleError(`Unknown current state ${instance.currentState}`);
    }

    const transitions = await client.workflowTransition.findMany({
      where: { definitionId: instance.definitionId, fromStateId: fromState.id },
    });
    const transition = transitions.find((t) => t.action === input.action);
    if (!transition) {
      throw new BusinessRuleError(
        `Action ${input.action} is not available from state ${instance.currentState}`,
      );
    }

    const toState = byId.get(transition.toStateId);
    if (!toState) throw new BusinessRuleError('Transition target state missing');

    if (tx) {
      return this.transitionWithin(instance, transition, toState, input.amount, tx);
    }
    return this.prisma.$transaction((txc) =>
      this.transitionWithin(instance, transition, toState, input.amount, txc),
    );
  }

  private async transitionWithin(
    instance: { id: string },
    transition: { condition: Prisma.JsonValue | null },
    toState: { code: string; isTerminal: boolean },
    amount: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ currentState: string; approvalTasksCreated: number; completed: boolean }> {
    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: {
        currentState: toState.code,
        ...(toState.isTerminal ? { completedAt: new Date() } : {}),
      },
    });
    const approver = parseApprover(transition.condition, amount);
    const tasksCreated = await this.maybeCreateApprovalTask(
      tx,
      instance.id,
      approver && !toState.isTerminal ? approver : null,
    );
    return {
      currentState: toState.code,
      approvalTasksCreated: tasksCreated,
      completed: toState.isTerminal,
    };
  }

  /** Records an approval decision and advances (or ends) the instance. */
  async act(
    taskId: string,
    decision: 'APPROVE' | 'REJECT' | 'CANCEL',
    actorUserId: string,
    options?: {
      comments?: string | undefined;
      rejectionReason?: string | undefined;
      /** Entity amount for threshold routing of the NEXT step's task. */
      amount?: string | undefined;
    },
  ): Promise<ActResult> {
    const task = await this.prisma.approvalTask.findUnique({
      where: { id: taskId },
      include: { instance: true },
    });
    if (!task) throw new NotFoundError('Approval task not found');
    if (task.status !== 'PENDING') {
      throw new BusinessRuleError(`Approval task already ${task.status.toLowerCase()}`);
    }

    await this.assertMayAct(task.approverType, task.approverId, actorUserId);

    if (decision === 'CANCEL') {
      await this.prisma.$transaction(async (tx) => {
        await tx.approvalTask.update({
          where: { id: task.id },
          data: {
            status: 'CANCELLED',
            actedAt: new Date(),
            actedBy: actorUserId,
            comments: options?.comments ?? null,
          },
        });
        await tx.workflowInstance.update({
          where: { id: task.instanceId },
          data: { completedAt: new Date() },
        });
      });
      return {
        currentState: task.instance.currentState,
        instanceStatus: 'CANCELLED',
        instanceId: task.instance.id,
        entityType: task.instance.entityType,
        entityId: task.instance.entityId,
      };
    }

    if (decision === 'REJECT') {
      if (!options?.rejectionReason) {
        throw new BusinessRuleError('A rejection reason is required');
      }
      // Follow the definition's `reject` transition when one exists so the
      // instance lands in the modeled rejection state; otherwise just end it.
      const currentStateRow = await this.prisma.workflowState.findFirst({
        where: { definitionId: task.instance.definitionId, code: task.instance.currentState },
      });
      const rejectTransition = currentStateRow
        ? await this.prisma.workflowTransition.findFirst({
            where: {
              definitionId: task.instance.definitionId,
              fromStateId: currentStateRow.id,
              action: 'reject',
            },
          })
        : null;
      let targetCode: string | null = null;
      if (rejectTransition) {
        const target = await this.prisma.workflowState.findUnique({
          where: { id: rejectTransition.toStateId },
        });
        if (target) targetCode = target.code;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.approvalTask.update({
          where: { id: task.id },
          data: {
            status: 'REJECTED',
            actedAt: new Date(),
            actedBy: actorUserId,
            comments: options.comments ?? null,
            rejectionReason: options.rejectionReason,
          },
        });
        await tx.workflowInstance.update({
          where: { id: task.instanceId },
          data: {
            ...(targetCode ? { currentState: targetCode } : {}),
            completedAt: new Date(),
          },
        });
      });
      return {
        currentState: targetCode ?? task.instance.currentState,
        instanceStatus: 'REJECTED',
        instanceId: task.instance.id,
        entityType: task.instance.entityType,
        entityId: task.instance.entityId,
      };
    }

    // APPROVE: mark the task satisfied, then follow the state's `approve`
    // transition if one is defined; otherwise the instance completes.
    const states = await this.prisma.workflowState.findMany({
      where: { definitionId: task.instance.definitionId },
    });
    const byId = new Map(states.map((s) => [s.id, s]));
    const currentState = states.find((s) => s.code === task.instance.currentState);
    if (!currentState) {
      throw new BusinessRuleError(`Unknown current state ${task.instance.currentState}`);
    }

    const approveTransition = await this.prisma.workflowTransition.findFirst({
      where: {
        definitionId: task.instance.definitionId,
        fromStateId: currentState.id,
        action: 'approve',
      },
    });

    if (!approveTransition) {
      await this.prisma.$transaction(async (tx) => {
        await tx.approvalTask.update({
          where: { id: task.id },
          data: {
            status: 'APPROVED',
            actedAt: new Date(),
            actedBy: actorUserId,
            comments: options?.comments ?? null,
          },
        });
        await tx.workflowInstance.update({
          where: { id: task.instanceId },
          data: { completedAt: new Date() },
        });
      });
      return {
        currentState: task.instance.currentState,
        instanceStatus: 'COMPLETED',
        instanceId: task.instance.id,
        entityType: task.instance.entityType,
        entityId: task.instance.entityId,
      };
    }

    const toState = byId.get(approveTransition.toStateId);
    if (!toState) throw new BusinessRuleError('Transition target state missing');

    const nextApprover = parseApprover(approveTransition.condition, options?.amount);
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalTask.update({
        where: { id: task.id },
        data: {
          status: 'APPROVED',
          actedAt: new Date(),
          actedBy: actorUserId,
          comments: options?.comments ?? null,
        },
      });
      await tx.workflowInstance.update({
        where: { id: task.instanceId },
        data: {
          currentState: toState.code,
          ...(toState.isTerminal ? { completedAt: new Date() } : {}),
        },
      });
      await this.maybeCreateApprovalTask(
        tx,
        task.instanceId,
        nextApprover && !toState.isTerminal ? nextApprover : null,
      );
    });

    return {
      currentState: toState.code,
      instanceStatus: toState.isTerminal ? 'COMPLETED' : 'IN_PROGRESS',
      instanceId: task.instance.id,
      entityType: task.instance.entityType,
      entityId: task.instance.entityId,
    };
  }

  /** Inbox: tasks assigned to the user directly or via one of their roles. */
  async inboxForUser(userId: string, status?: string): Promise<ApprovalTaskView[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { select: { roleId: true } } },
    });
    if (!user) throw new NotFoundError('User not found');
    const roleIds = user.roles.map((a) => a.roleId);

    const tasks = await this.prisma.approvalTask.findMany({
      where: {
        ...(status ? { status } : {}),
        OR: [
          { approverType: 'USER', approverId: userId },
          { approverType: 'ROLE', approverId: { in: roleIds } },
        ],
      },
      include: {
        instance: {
          select: {
            entityType: true,
            entityId: true,
            currentState: true,
            definition: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: 100,
    });

    const labels = await this.describeEntities(
      tasks.map((t) => ({ entityType: t.instance.entityType, entityId: t.instance.entityId })),
    );
    return tasks.map((t) => ({
      id: t.id,
      step: t.step,
      status: t.status,
      dueAt: t.dueAt,
      entityType: t.instance.entityType,
      entityId: t.instance.entityId,
      entityLabel: labels.get(`${t.instance.entityType}:${t.instance.entityId}`) ?? null,
      currentState: t.instance.currentState,
      workflow: t.instance.definition.name,
    }));
  }

  /**
   * Resolves the document number for each approval target. An approver decides
   * on "JE-2026-000004", never on a truncated id, so the inbox shows the label
   * when one exists and falls back to the raw id when the type has no number.
   */
  private async describeEntities(
    refs: Array<{ entityType: string; entityId: string }>,
  ): Promise<Map<string, string>> {
    const idsOf = (entityType: string): string[] => [
      ...new Set(refs.filter((r) => r.entityType === entityType).map((r) => r.entityId)),
    ];

    const [journalIds, poIds, prIds, soIds, quoteIds, leaveIds] = [
      idsOf('journal_entry'),
      idsOf('purchase_order'),
      idsOf('purchase_request'),
      idsOf('sales_order'),
      idsOf('sales_quotation'),
      idsOf('leave_request'),
    ];

    const [journals, purchaseOrders, purchaseRequests, salesOrders, quotations, leaveRequests] =
      await Promise.all([
        this.prisma.journalEntry.findMany({
          where: { id: { in: journalIds } },
          select: { id: true, journalNo: true },
        }),
        this.prisma.purchaseOrder.findMany({
          where: { id: { in: poIds } },
          select: { id: true, poNo: true },
        }),
        this.prisma.purchaseRequest.findMany({
          where: { id: { in: prIds } },
          select: { id: true, requestNo: true },
        }),
        this.prisma.salesOrder.findMany({
          where: { id: { in: soIds } },
          select: { id: true, orderNo: true },
        }),
        this.prisma.salesQuotation.findMany({
          where: { id: { in: quoteIds } },
          select: { id: true, quotationNo: true },
        }),
        // Leave requests carry no number; the dates identify one to a person.
        this.prisma.leaveRequest.findMany({
          where: { id: { in: leaveIds } },
          select: { id: true, startDate: true, endDate: true },
        }),
      ]);

    const labels = new Map<string, string>();
    const put = <T extends { id: string }>(
      entityType: string,
      rows: T[],
      label: (row: T) => string,
    ) => {
      for (const row of rows) labels.set(`${entityType}:${row.id}`, label(row));
    };
    put('journal_entry', journals, (r: { journalNo: string }) => r.journalNo);
    put('purchase_order', purchaseOrders, (r: { poNo: string }) => r.poNo);
    put('purchase_request', purchaseRequests, (r: { requestNo: string }) => r.requestNo);
    put('sales_order', salesOrders, (r: { orderNo: string }) => r.orderNo);
    put('sales_quotation', quotations, (r: { quotationNo: string }) => r.quotationNo);
    put(
      'leave_request',
      leaveRequests,
      (r: { startDate: Date; endDate: Date }) =>
        `${r.startDate.toISOString().slice(0, 10)} to ${r.endDate.toISOString().slice(0, 10)}`,
    );
    return labels;
  }

  // ---- Definition & instance management (admin surfaces) -------------------

  async listDefinitions(): Promise<unknown[]> {
    const definitions = await this.prisma.workflowDefinition.findMany({
      orderBy: [{ entityType: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        companyId: true,
        name: true,
        entityType: true,
        version: true,
        status: true,
        _count: { select: { states: true, transitions: true, instances: true } },
      },
    });
    return definitions.map(({ _count, ...d }) => ({ ...d, counts: _count }));
  }

  async createDefinition(input: CreateDefinitionInput): Promise<{ id: string; name: string }> {
    const initialCount = input.states.filter((s) => s.isInitial).length;
    if (initialCount !== 1) {
      throw new BusinessRuleError('A workflow definition must have exactly one initial state');
    }
    const codes = new Set(input.states.map((s) => s.code));
    for (const t of input.transitions) {
      if (!codes.has(t.from) || !codes.has(t.to)) {
        throw new BusinessRuleError(
          `Transition ${t.from} -> ${t.to} references unknown state codes`,
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const maxVersion = await tx.workflowDefinition.findFirst({
        where: { entityType: input.entityType, companyId: input.companyId },
        orderBy: [{ version: 'desc' }],
        select: { version: true },
      });
      const definition = await tx.workflowDefinition.create({
        data: {
          companyId: input.companyId,
          name: input.name,
          entityType: input.entityType,
          version: (maxVersion?.version ?? 0) + 1,
          status: 'ACTIVE',
        },
      });
      const stateIdByCode = new Map<string, string>();
      for (const s of input.states) {
        const state = await tx.workflowState.create({
          data: {
            definitionId: definition.id,
            code: s.code,
            name: s.name,
            isInitial: s.isInitial,
            isTerminal: s.isTerminal,
          },
        });
        stateIdByCode.set(s.code, state.id);
      }
      for (const t of input.transitions) {
        const condition =
          t.approverType === 'USER' || t.approverType === 'ROLE'
            ? { approverType: t.approverType, approverId: t.approverId ?? '' }
            : undefined;
        await tx.workflowTransition.create({
          data: {
            definitionId: definition.id,
            fromStateId: stateIdByCode.get(t.from) as string,
            toStateId: stateIdByCode.get(t.to) as string,
            action: t.action,
            ...(condition ? { condition } : {}),
          },
        });
      }
      return definition;
    });
    return { id: created.id, name: created.name };
  }

  async listInstances(): Promise<unknown[]> {
    return this.prisma.workflowInstance.findMany({
      orderBy: [{ startedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        currentState: true,
        startedAt: true,
        completedAt: true,
        definition: { select: { name: true, entityType: true, version: true } },
        _count: { select: { tasks: true } },
      },
    });
  }

  async getInstanceDetail(id: string): Promise<unknown> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id },
      include: {
        definition: { select: { id: true, name: true, entityType: true, version: true } },
        tasks: { orderBy: [{ step: 'asc' }] },
      },
    });
    if (!instance) throw new NotFoundError('Workflow instance not found');
    return instance;
  }

  private async assertMayAct(
    approverType: string,
    approverId: string,
    actorUserId: string,
  ): Promise<void> {
    if (approverType === 'USER') {
      if (approverId !== actorUserId) {
        throw new BusinessRuleError('You are not the designated approver for this task');
      }
      return;
    }
    const assignment = await this.prisma.userRoleAssignment.findFirst({
      where: {
        userId: actorUserId,
        roleId: approverId,
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
    });
    if (!assignment) {
      throw new BusinessRuleError('You are not the designated approver for this task');
    }
  }

  /** Creates one PENDING task; returns 1 when created, 0 otherwise. */
  private async maybeCreateApprovalTask(
    tx: Prisma.TransactionClient,
    instanceId: string,
    approver: ApproverSpec | null,
  ): Promise<number> {
    if (!approver) return 0;
    const existing = await tx.approvalTask.findFirst({
      where: { instanceId, status: 'PENDING' },
    });
    if (existing) return 0;
    const last = await tx.approvalTask.findFirst({
      where: { instanceId },
      orderBy: [{ step: 'desc' }],
      select: { step: true },
    });
    await tx.approvalTask.create({
      data: {
        instanceId,
        step: (last?.step ?? 0) + 1,
        approverType: approver.approverType,
        approverId: approver.approverId,
        status: 'PENDING',
      },
    });
    return 1;
  }
}
