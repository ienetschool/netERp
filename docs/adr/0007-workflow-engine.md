# ADR-0007: Workflow engine design — approver-in-condition, guarded transitions

**Status:** Accepted

## Context
PRD Stage 2 requires a workflow engine driving approvals across future modules
(procurement, HR, payroll…). DATA-MODEL §17 fixes the persistence shape
(Definition / State / Transition / Instance / ApprovalTask) and notes approval
rules may depend on user, role, branch, department, amount, document type. The
engine must work for Stage 2 without premature generality.

## Decision
1. **Execution reads definitions, never hard-codes graphs.** The engine resolves
   the newest ACTIVE definition per entity type (company override first), starts
   instances in the initial state, and executes named actions from the current
   state's transitions.
2. **Approvers are declared in `WorkflowTransition.condition` JSON** as
   `{ approverType: 'USER' | 'ROLE', approverId }` (DATA-MODEL §17: rules
   depend on user/role), with **optional amount-threshold routing**: an
   `amountRules` array of `{ minAmount?, maxAmount?, approverType, approverId }
   bands (first match wins, `[min, max)` semantics, compared exactly via the
   `Money` decimal type so binary-float rounding can never misroute) and an
   optional flat fallback approver used when no band matches or no amount is
   supplied. Transitions without any approver info are unguarded.
3. **Arriving at a non-terminal state through an approver-declaring transition
   creates one PENDING ApprovalTask** for that user/role. While any PENDING task
   exists, `executeTransition` is rejected — decisions must arrive via
   `act(APPROVE | REJECT | CANCEL)`, which verifies the actor is the designated
   approver (user match, or live role assignment).
4. **APPROVE** follows the current state's `approve` transition if one exists
   (multi-step chains fall out naturally), else completes the instance.
   **REJECT** requires a reason, follows the state's `reject` transition when
   modeled (landing in e.g. REJECTED), else completes the instance in place.
   **CANCEL** aborts in place. Terminal states set `completedAt`.
5. **Events:** instance start and approval decisions are written to the
   transactional outbox (`workflow.instance.started`,
   `workflow.approval.acted`) so the notification engine can react without
   coupling to the engine.

## Consequences
- Amount-threshold routing is implemented (bands + exact-decimal comparison,
  the caller supplies the entity amount on transition/act calls); branch/
  department-based routing extends the same condition JSON, evaluated at
  task-creation time — no schema change.
- Task creation is not yet a queue; notification fan-out happens via outbox
  consumers, so latency is bounded by relay polling.
- Definition CRUD is permission-gated
  (`workflow.workflow_definition.*`); acting on tasks requires being the
  designated approver — SUPER_ADMIN may act but scope checks still apply.
- Seeded demo definition (`purchase_request`, routed to BRANCH_MANAGER) makes
  the engine exercisable immediately after `db:seed`.
