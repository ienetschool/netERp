import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '@erp/prisma';
import { SearchController, SEARCH_BATCH_SIZE } from '../src/platform/search.controller.js';
import type { RequestPrincipal } from '../src/common/request-context.js';

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return {
    userId: 'user-1',
    email: 'user@example.test',
    permissions: [],
    companyIds: ['company-1'],
    branchIds: ['branch-1'],
    departmentIds: ['department-1'],
    warehouseIds: [],
    ...overrides,
  };
}

function request(p: RequestPrincipal) {
  return { principal: p, headers: {} } as never;
}

/**
 * A Prisma stub whose `findMany` records how many queries are in flight at once
 * and resolves on the next macrotask, so a test can observe real concurrency
 * rather than just the arguments each source received.
 */
function trackingPrisma() {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const findMany = () => {
    state.calls += 1;
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    return new Promise<[]>((resolve) => {
      setTimeout(() => {
        state.inFlight -= 1;
        resolve([]);
      }, 1);
    });
  };
  const models = [
    'employee',
    'supplier',
    'customer',
    'product',
    'purchaseRequest',
    'purchaseOrder',
    'salesOrder',
    'delivery',
    'customerInvoice',
    'journalEntry',
    'document',
    'visitor',
    'callLog',
    'correspondence',
    'fileRecord',
    'conversation',
    'reportDefinition',
  ].reduce<Record<string, unknown>>((acc, model) => {
    acc[model] = { findMany };
    return acc;
  }, {});
  return { prisma: models as unknown as PrismaService, state, findMany };
}

const ALL_SEARCH_PERMISSIONS = [
  'hr.employee.view',
  'procurement.supplier.view',
  'sales.customer.view',
  'inventory.product.view',
  'procurement.purchase_request.view',
  'procurement.purchase_order.view',
  'sales.sales_order.view',
  'sales.delivery.view',
  'sales.invoice.view',
  'accounting.journal.view',
  'documents.document.view',
  'office.visitor.view',
  'office.call.view',
  'office.correspondence.view',
  'office.file_room.view',
  'communication.chat.view',
  'reporting.report.view',
];

describe('SearchController', () => {
  it('does not query any records without a matching view permission', async () => {
    const findMany = vi.fn();
    const controller = new SearchController(
      { employee: { findMany } } as unknown as PrismaService,
    );

    const response = await controller.search('Ada', request(principal()));

    expect(findMany).not.toHaveBeenCalled();
    expect(response).toMatchObject({ data: {}, meta: { total: 0 } });
  });

  it('applies company, branch, and department scopes within the employee query', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = new SearchController(
      { employee: { findMany } } as unknown as PrismaService,
    );

    await controller.search(
      'Ada',
      request(
        principal({
          permissions: ['hr.employee.view'],
        }),
      ),
    );

    const { where } = findMany.mock.calls[0]![0];
    expect(where.companyId).toEqual({ in: ['company-1'] });
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ branchId: null }, { branchId: { in: ['branch-1'] } }] },
        { departmentId: { in: ['department-1'] } },
      ]),
    );
  });

  it('treats empty branch and department scope arrays as no narrower scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = new SearchController(
      { employee: { findMany } } as unknown as PrismaService,
    );

    await controller.search(
      'Ada',
      request(
        principal({
          permissions: ['hr.employee.view'],
          branchIds: [],
          departmentIds: [],
        }),
      ),
    );

    const { where } = findMany.mock.calls[0]![0];
    expect(where.companyId).toEqual({ in: ['company-1'] });
    expect(where.AND).toHaveLength(1);
    expect(JSON.stringify(where)).not.toContain('in":[]');
  });

  it('limits report search to active, in-company reports requiring an allowed permission', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'report-1',
        code: 'HR-01',
        name: 'Headcount',
        permission: 'reporting.report.view',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'report-2',
        code: 'FIN-01',
        name: 'Payroll',
        permission: 'payroll.payroll_run.view',
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);
    const controller = new SearchController(
      { reportDefinition: { findMany } } as unknown as PrismaService,
    );

    const response = (await controller.search(
      'report',
      request(principal({ permissions: ['reporting.report.view'] })),
    )) as { data: Record<string, Array<{ entityId: string }>> };

    const { where } = findMany.mock.calls[0]![0];
    expect(where.status).toBe('ACTIVE');
    expect(where.companyId).toEqual({ in: ['company-1'] });
    expect(where.AND[1].OR).toContainEqual({ permission: 'reporting.report.view' });
    expect(response.data.report?.map((item) => item.entityId)).toEqual(['report-1']);
  });

  it('runs sources in bounded batches instead of opening every connection at once', async () => {
    const { prisma, state } = trackingPrisma();
    const controller = new SearchController(prisma);

    await controller.search(
      'report',
      request(principal({ permissions: ALL_SEARCH_PERMISSIONS })),
    );

    // All 17 sources are consulted...
    expect(state.calls).toBe(17);
    // ...but never all at once: the pooler allows a handful of sessions, and an
    // unbounded fan-out is what returned EMAXCONNSESSION in production.
    expect(state.peak).toBeLessThanOrEqual(SEARCH_BATCH_SIZE);
    expect(state.peak).toBeGreaterThan(1);
  });

  it('still returns the healthy sources when one of them fails', async () => {
    const employee = vi.fn().mockResolvedValue([
      {
        id: 'employee-1',
        displayName: 'Ada Lovelace',
        employeeNo: 'E-0001',
        employmentStatus: 'ACTIVE',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    const { prisma: models, findMany } = trackingPrisma();
    const controller = new SearchController({
      ...models,
      employee: { findMany: employee },
      supplier: {
        findMany: () => Promise.reject(new Error('EMAXCONNSESSION')),
      },
    } as unknown as PrismaService);
    expect(typeof findMany).toBe('function');

    const response = (await controller.search(
      'Ada',
      request(principal({ permissions: ALL_SEARCH_PERMISSIONS })),
    )) as { data: Record<string, Array<{ entityId: string }>> };

    expect(response.data.employee?.map((item) => item.entityId)).toEqual(['employee-1']);
  });

  it('surfaces an outage when every source fails', async () => {
    const failing = { findMany: () => Promise.reject(new Error('EMAXCONNSESSION')) };
    const controller = new SearchController({
      employee: failing,
      supplier: failing,
    } as unknown as PrismaService);

    await expect(
      controller.search('Ada', request(principal({ permissions: ['hr.employee.view', 'procurement.supplier.view'] }))),
    ).rejects.toThrow(/All search sources failed/);
  });
});
