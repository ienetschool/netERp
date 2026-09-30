import { describe, expect, it, vi } from 'vitest';
import { HrService } from '../src/hr/hr.service.js';

/**
 * Unit tests for the workflow → leave request status bridge. The Prisma
 * client is faked; the DB-backed lifecycle is covered by integration tests
 * once a live PostgreSQL is available.
 */
function makeService(prisma: ConstructorParameters<typeof HrService>[0]) {
  return new HrService(
    prisma,
    {} as ConstructorParameters<typeof HrService>[1],
    {} as ConstructorParameters<typeof HrService>[2],
    {} as ConstructorParameters<typeof HrService>[3],
  );
}

function prismaWith(request: { id: string; status: string } | null) {
  return {
    leaveRequest: {
      findUnique: vi.fn().mockResolvedValue(request),
      update: vi.fn().mockResolvedValue({ ...request }),
    },
  } as unknown as ConstructorParameters<typeof HrService>[0];
}

describe('applyWorkflowOutcome', () => {
  it('maps COMPLETED to APPROVED and stamps approver', async () => {
    const prisma = prismaWith({ id: 'lr-1', status: 'PENDING_APPROVAL' });
    await makeService(prisma).applyWorkflowOutcome('wf-1', 'COMPLETED', 'user-1');
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'lr-1' },
      data: { status: 'APPROVED', approvedAt: expect.any(Date), approvedBy: 'user-1' },
    });
  });

  it('maps REJECTED straight through and stamps rejector', async () => {
    const prisma = prismaWith({ id: 'lr-2', status: 'PENDING_APPROVAL' });
    await makeService(prisma).applyWorkflowOutcome('wf-2', 'REJECTED', 'user-2');
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'lr-2' },
      data: { status: 'REJECTED', rejectedAt: expect.any(Date), rejectedBy: 'user-2' },
    });
  });

  it('maps CANCELLED straight through to the rejected-by path', async () => {
    const prisma = prismaWith({ id: 'lr-3', status: 'PENDING_APPROVAL' });
    await makeService(prisma).applyWorkflowOutcome('wf-3', 'CANCELLED', 'user-3');
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'lr-3' },
      data: { status: 'CANCELLED', rejectedAt: expect.any(Date), rejectedBy: 'user-3' },
    });
  });

  it('ignores IN_PROGRESS (intermediate approval; request stays pending)', async () => {
    const prisma = prismaWith({ id: 'lr-4', status: 'PENDING_APPROVAL' });
    await makeService(prisma).applyWorkflowOutcome('wf-4', 'IN_PROGRESS', 'user-4');
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('does nothing when the instance is not bound to a leave request', async () => {
    const prisma = prismaWith(null);
    await expect(
      makeService(prisma).applyWorkflowOutcome('wf-5', 'COMPLETED', 'user-5'),
    ).resolves.toBeUndefined();
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a request that already left PENDING_APPROVAL', async () => {
    const prisma = prismaWith({ id: 'lr-6', status: 'APPROVED' });
    await makeService(prisma).applyWorkflowOutcome('wf-6', 'REJECTED', 'user-6');
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
  });
});
