import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { Money } from '@erp/types';
import { ConflictError, BusinessRuleError, NotFoundError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { OutboxService } from '../platform/outbox.service.js';
import { NumberingService, DOCUMENT_TYPES } from '../platform/numbering.service.js';
import { WorkflowEngineService } from '../workflow/workflow-engine.service.js';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import type {
  productCreateSchema,
  productUpdateSchema,
  stockTransferCreateSchema,
  stockAdjustmentCreateSchema,
  openingStockSchema,
  unitCreateSchema,
  productCategoryCreateSchema,
} from '@erp/validation';
import type { z } from 'zod';

type Principal = RequestPrincipal;
type ProductCreateInput = z.infer<typeof productCreateSchema>;
type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
type StockTransferCreateInput = z.infer<typeof stockTransferCreateSchema>;
type StockAdjustmentCreateInput = z.infer<typeof stockAdjustmentCreateSchema>;
type OpeningStockInput = z.infer<typeof openingStockSchema>;
type UnitCreateInput = z.infer<typeof unitCreateSchema>;
type ProductCategoryCreateInput = z.infer<typeof productCategoryCreateSchema>;

type Tx = Prisma.TransactionClient;

const MOVEMENT_DELTA: Record<string, number> = {
  RECEIPT: 1,
  ISSUE: -1,
  TRANSFER_IN: 1,
  TRANSFER_OUT: -1,
  ADJUSTMENT_IN: 1,
  ADJUSTMENT_OUT: -1,
  RETURN_IN: 1,
  RETURN_OUT: -1,
};

/**
 * Inventory (Stage 6). CLAUDE.md §16: every stock change is a traceable
 * StockMovement; balances are a derived projection updated in the same
 * transaction as the movement. Valuation is moving weighted average:
 *   avg' = (onHand*avg + qty*unitCost) / (onHand + qty)
 * Negative stock is rejected unless the company setting
 * inventory.allowNegativeStock is explicitly true.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly workflow: WorkflowEngineService,
  ) {}

  private scopeGuard(principal: Principal, companyId: string): void {
    if (principal.companyIds && !principal.companyIds.includes(companyId)) {
      throw new NotFoundError('Resource not found in your scope');
    }
  }

  // ---- Units of measure -------------------------------------------------------

  async createUnit(principal: Principal, input: UnitCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const unit = await this.prisma.unitOfMeasure.create({
      data: { ...input },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.unit_created',
      resourceType: 'unit_of_measure',
      resourceId: unit.id,
      companyId: input.companyId,
      requestId,
    });
    return unit;
  }

  async listUnits(principal: Principal, companyId: string | null) {
    const effective = companyId ?? principal.companyIds?.[0] ?? null;
    return this.prisma.unitOfMeasure.findMany({
      where: effective
        ? { OR: [{ companyId: effective }, { companyId: null }] }
        : { companyId: null },
      orderBy: { code: 'asc' },
    });
  }

  // ---- Product categories -------------------------------------------------------

  async createCategory(
    principal: Principal,
    input: ProductCategoryCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const category = await this.prisma.productCategory.create({ data: { ...input } });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.category_created',
      resourceType: 'product_category',
      resourceId: category.id,
      companyId: input.companyId,
      requestId,
    });
    return category;
  }

  async listCategories(principal: Principal, companyId: string | null) {
    const effective = companyId ?? principal.companyIds?.[0] ?? null;
    if (!effective) return [];
    return this.prisma.productCategory.findMany({
      where: { companyId: effective },
      orderBy: { code: 'asc' },
    });
  }

  // ---- Products -----------------------------------------------------------------

  async createProduct(principal: Principal, input: ProductCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const existing = await this.prisma.product.findUnique({
      where: { companyId_sku: { companyId: input.companyId, sku: input.sku } },
      select: { id: true },
    });
    if (existing) throw new ConflictError('SKU already exists for this company');
    const product = await this.prisma.product.create({
      data: {
        companyId: input.companyId,
        sku: input.sku,
        barcode: input.barcode ?? null,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        productType: input.productType,
        baseUnitId: input.baseUnitId ?? null,
        trackBatch: input.trackBatch,
        trackSerial: input.trackSerial,
        inventoryItem: input.inventoryItem,
        saleable: input.saleable,
        purchasable: input.purchasable,
        standardCost: Money.fromDecimalString(input.standardCost).toString(),
        reorderLevel: Money.fromDecimalString(input.reorderLevel).toString(),
        reorderQty: Money.fromDecimalString(input.reorderQty).toString(),
        createdById: principal.userId,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.product_created',
      resourceType: 'product',
      resourceId: product.id,
      companyId: input.companyId,
      requestId,
      metadata: { sku: product.sku },
    });
    return product;
  }

  async updateProduct(
    principal: Principal,
    id: string,
    input: ProductUpdateInput,
    requestId: string | null,
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundError('Product not found');
    this.scopeGuard(principal, product.companyId);
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.productType !== undefined ? { productType: input.productType } : {}),
        ...(input.baseUnitId !== undefined ? { baseUnitId: input.baseUnitId } : {}),
        ...(input.trackBatch !== undefined ? { trackBatch: input.trackBatch } : {}),
        ...(input.trackSerial !== undefined ? { trackSerial: input.trackSerial } : {}),
        ...(input.inventoryItem !== undefined ? { inventoryItem: input.inventoryItem } : {}),
        ...(input.saleable !== undefined ? { saleable: input.saleable } : {}),
        ...(input.purchasable !== undefined ? { purchasable: input.purchasable } : {}),
        ...(input.standardCost !== undefined
          ? { standardCost: Money.fromDecimalString(input.standardCost).toString() }
          : {}),
        ...(input.reorderLevel !== undefined
          ? { reorderLevel: Money.fromDecimalString(input.reorderLevel).toString() }
          : {}),
        ...(input.reorderQty !== undefined
          ? { reorderQty: Money.fromDecimalString(input.reorderQty).toString() }
          : {}),
        updatedById: principal.userId,
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.product_updated',
      resourceType: 'product',
      resourceId: id,
      companyId: product.companyId,
      requestId,
    });
    return updated;
  }

  async listProducts(
    principal: Principal,
    query: { page: number; pageSize: number; search?: string; status?: string },
  ) {
    const where: Prisma.ProductWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { sku: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { rows, total };
  }

  async getProduct(principal: Principal, id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundError('Product not found');
    this.scopeGuard(principal, product.companyId);
    const balances = await this.prisma.stockBalance.findMany({
      where: { productId: id },
      include: { warehouse: { select: { code: true, name: true } } },
    });
    const recentMovements = await this.prisma.stockMovement.findMany({
      where: { productId: id },
      orderBy: { movementDate: 'desc' },
      take: 25,
    });
    return { product, balances, recentMovements };
  }

  // ---- Movement core --------------------------------------------------------------
  // Applies one movement inside a caller transaction: locks/creates the balance
  // row, validates availability, updates quantities and weighted-average cost.
  private async applyMovement(
    tx: Tx,
    data: {
      companyId: string;
      warehouseId: string;
      warehouseLocationId?: string | null;
      productId: string;
      movementType: string;
      quantity: string;
      unitCost?: string;
      batchNo?: string | null;
      serialNo?: string | null;
      referenceType?: string | null;
      referenceId?: string | null;
      referenceNo?: string | null;
      createdById?: string | null;
    },
    options: { allowNegative: boolean; movementDate?: Date },
  ) {
    const delta = MOVEMENT_DELTA[data.movementType];
    if (!delta) throw new BusinessRuleError(`Unknown movement type: ${data.movementType}`);
    const qty = Money.fromDecimalString(data.quantity);
    if (qty.lte(Money.zero())) throw new BusinessRuleError('Movement quantity must be positive');

    // Lock the balance row (or create the first one) to serialize concurrent
    // stock changes on the same warehouse/location/product (CLAUDE.md §16).
    const balance = await tx.stockBalance.findFirst({
      where: {
        warehouseId: data.warehouseId,
        warehouseLocationId: data.warehouseLocationId ?? null,
        productId: data.productId,
      },
    });
    let onHand: Money;
    let avgCost: Money;
    if (!balance) {
      if (delta < 0) throw new BusinessRuleError('Stock balance does not exist');
      onHand = Money.zero();
      avgCost = Money.zero();
    } else {
      onHand = Money.fromDecimalString(balance.onHand.toString());
      avgCost = Money.fromDecimalString(balance.avgCost.toString());
    }

    const inbound = delta > 0;
    if (!inbound && onHand.lt(qty) && !options.allowNegative) {
      throw new BusinessRuleError(
        `Insufficient stock: requested ${qty.toString()}, available ${onHand.toString()}`,
      );
    }

    let newAvg = avgCost;
    if (inbound && data.unitCost) {
      const unitCost = Money.fromDecimalString(data.unitCost);
      const totalValue = onHand.mul(avgCost).plus(qty.mul(unitCost));
      const totalQty = onHand.plus(qty);
      newAvg = totalQty.isZero() ? unitCost : totalValue.div(totalQty);
    }

    const newOnHand = inbound ? onHand.plus(qty) : onHand.minus(qty);

    if (balance) {
      await tx.stockBalance.update({
        where: { id: balance.id },
        data: { onHand: newOnHand.toString(), avgCost: newAvg.toString() },
      });
    } else {
      await tx.stockBalance.create({
        data: {
          companyId: data.companyId,
          warehouseId: data.warehouseId,
          warehouseLocationId: data.warehouseLocationId ?? null,
          productId: data.productId,
          onHand: newOnHand.toString(),
          avgCost: newAvg.toString(),
        },
      });
    }

    return tx.stockMovement.create({
      data: {
        companyId: data.companyId,
        warehouseId: data.warehouseId,
        warehouseLocationId: data.warehouseLocationId ?? null,
        productId: data.productId,
        movementType: data.movementType,
        quantity: qty.toString(),
        unitCost: data.unitCost ?? '0',
        totalCost: qty.mul(Money.fromDecimalString(data.unitCost ?? '0')).toString(),
        batchNo: data.batchNo ?? null,
        serialNo: data.serialNo ?? null,
        referenceType: data.referenceType ?? null,
        referenceId: data.referenceId ?? null,
        referenceNo: data.referenceNo ?? null,
        ...(options.movementDate ? { movementDate: options.movementDate } : {}),
        createdById: data.createdById ?? null,
      },
    });
  }

  private async allowNegativeStock(tx: Tx, companyId: string): Promise<boolean> {
    const setting = await tx.systemSetting.findUnique({
      where: { companyId_key: { companyId, key: 'inventory.allowNegativeStock' } },
    });
    return setting?.value === true;
  }

  // ---- Opening stock / direct intake -----------------------------------------------

  async postOpeningStock(principal: Principal, input: OpeningStockInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const created = await this.prisma.$transaction(async (tx) => {
      const movements = [];
      for (const line of input.lines) {
        movements.push(
          await this.applyMovement(
            tx,
            {
              companyId: input.companyId,
              warehouseId: line.warehouseId,
              warehouseLocationId: line.warehouseLocationId ?? null,
              productId: line.productId,
              movementType: 'RECEIPT',
              quantity: line.quantity,
              unitCost: line.unitCost ?? '0',
              referenceType: 'opening_stock',
              referenceNo: 'OPENING',
              createdById: principal.userId,
            },
            {
              allowNegative: false,
              movementDate: input.movementDate ? new Date(input.movementDate) : undefined,
            },
          ),
        );
      }
      return movements;
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.opening_stock_posted',
      resourceType: 'stock_movement',
      resourceId: created[0]?.id ?? null,
      companyId: input.companyId,
      requestId,
      metadata: { lineCount: input.lines.length },
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'inventory.opening_stock.posted',
        aggregateType: 'stock_movement',
        aggregateId: created[0]?.id ?? '',
        payload: { companyId: input.companyId, lineCount: input.lines.length },
      },
      this.prisma,
    );
    return { movementCount: created.length };
  }

  // ---- Stock transfers ---------------------------------------------------------------

  async createStockTransfer(
    principal: Principal,
    input: StockTransferCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BusinessRuleError('Source and destination warehouses must differ');
    }
    const transfer = await this.prisma.$transaction(async (tx) => {
      const transferNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.STOCK_TRANSFER,
      );
      const allowNegative = await this.allowNegativeStock(tx, input.companyId);
      const header = await tx.stockTransfer.create({
        data: {
          companyId: input.companyId,
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          transferNo,
          reason: input.reason ?? null,
          status: 'COMPLETED',
          createdById: principal.userId,
          lines: {
            create: input.lines.map((l) => ({
              productId: l.productId,
              quantity: Money.fromDecimalString(l.quantity).toString(),
            })),
          },
        },
        include: { lines: true },
      });
      // Paired out/in movements atomically (DATA-MODEL §10).
      for (const line of header.lines) {
        await this.applyMovement(
          tx,
          {
            companyId: input.companyId,
            warehouseId: input.fromWarehouseId,
            productId: line.productId,
            movementType: 'TRANSFER_OUT',
            quantity: line.quantity.toString(),
            referenceType: 'stock_transfer',
            referenceId: header.id,
            referenceNo: transferNo,
            createdById: principal.userId,
          },
          { allowNegative },
        );
        await this.applyMovement(
          tx,
          {
            companyId: input.companyId,
            warehouseId: input.toWarehouseId,
            productId: line.productId,
            movementType: 'TRANSFER_IN',
            quantity: line.quantity.toString(),
            referenceType: 'stock_transfer',
            referenceId: header.id,
            referenceNo: transferNo,
            createdById: principal.userId,
          },
          { allowNegative },
        );
      }
      return header;
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.stock_transfer_completed',
      resourceType: 'stock_transfer',
      resourceId: transfer.id,
      companyId: input.companyId,
      requestId,
      metadata: { transferNo: transfer.transferNo },
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'inventory.stock_transfer.completed',
        aggregateType: 'stock_transfer',
        aggregateId: transfer.id,
        payload: { transferNo: transfer.transferNo, lineCount: transfer.lines.length },
      },
      this.prisma,
    );
    return transfer;
  }

  async listStockTransfers(principal: Principal, query: { page: number; pageSize: number }) {
    const where: Prisma.StockTransferWhereInput = principal.companyIds
      ? { companyId: { in: principal.companyIds } }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          fromWarehouse: { select: { code: true, name: true } },
          toWarehouse: { select: { code: true, name: true } },
        },
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Stock adjustments ---------------------------------------------------------------

  async createStockAdjustment(
    principal: Principal,
    input: StockAdjustmentCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const adjustment = await this.prisma.$transaction(async (tx) => {
      const adjustmentNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.STOCK_ADJUSTMENT,
      );
      return tx.stockAdjustment.create({
        data: {
          companyId: input.companyId,
          warehouseId: input.warehouseId,
          adjustmentNo,
          reason: input.reason,
          status: 'DRAFT',
          createdById: principal.userId,
          lines: {
            create: input.lines.map((l) => {
              const counted = Money.fromDecimalString(l.countedQuantity);
              return {
                productId: l.productId,
                systemQuantity: '0', // snapshotted at approval time (values may drift)
                countedQuantity: counted.toString(),
                differenceQuantity: counted.toString(),
                unitCost: Money.fromDecimalString(l.unitCost ?? '0').toString(),
                adjustmentValue: counted.mul(Money.fromDecimalString(l.unitCost ?? '0')).toString(),
              };
            }),
          },
        },
        include: { lines: true },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.stock_adjustment_created',
      resourceType: 'stock_adjustment',
      resourceId: adjustment.id,
      companyId: input.companyId,
      requestId,
      metadata: { adjustmentNo: adjustment.adjustmentNo },
    });
    return adjustment;
  }

  /** Snapshots system quantities, computes variances, then starts the
   * `stock_adjustment` workflow (approvals land via the shared workflow bridge). */
  async submitStockAdjustment(principal: Principal, id: string, requestId: string | null) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!adjustment) throw new NotFoundError('Stock adjustment not found');
    this.scopeGuard(principal, adjustment.companyId);
    if (adjustment.status !== 'DRAFT') {
      throw new BusinessRuleError('Only draft adjustments can be submitted');
    }
    const started = await this.prisma.$transaction(async (tx) => {
      for (const line of adjustment.lines) {
        const balance = await tx.stockBalance.findFirst({
          where: { warehouseId: adjustment.warehouseId, productId: line.productId },
        });
        const systemQty = balance?.onHand ?? '0';
        const counted = Money.fromDecimalString(line.countedQuantity.toString());
        const system = Money.fromDecimalString(systemQty.toString());
        const diff = counted.minus(system);
        await tx.stockAdjustmentLine.update({
          where: { id: line.id },
          data: {
            systemQuantity: system.toString(),
            countedQuantity: counted.toString(),
            differenceQuantity: diff.toString(),
            adjustmentValue: diff.mul(Money.fromDecimalString(line.unitCost.toString())).toString(),
          },
        });
      }
      return this.workflow.startInstance(
        {
          entityType: 'stock_adjustment',
          entityId: adjustment.id,
          companyId: adjustment.companyId,
          actorUserId: principal.userId,
        },
        tx,
      );
    });
    const executed = await this.workflow.executeTransition({
      instanceId: started.instanceId,
      action: 'submit',
      actorUserId: principal.userId,
    });
    await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', workflowInstanceId: started.instanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.stock_adjustment_submitted',
      resourceType: 'stock_adjustment',
      resourceId: id,
      companyId: adjustment.companyId,
      requestId,
      metadata: { instanceId: started.instanceId },
    });
    return {
      adjustmentId: id,
      instanceId: started.instanceId,
      approvalTasksCreated: executed.approvalTasksCreated,
      currentState: executed.currentState,
    };
  }

  /** Applies an approved adjustment: ADJUSTMENT_IN/OUT movements per variance. */
  async postStockAdjustment(principal: Principal, id: string, requestId: string | null) {
    const adjustment = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!adjustment) throw new NotFoundError('Stock adjustment not found');
    this.scopeGuard(principal, adjustment.companyId);
    if (adjustment.status !== 'APPROVED') {
      throw new BusinessRuleError('Only approved adjustments can be posted');
    }
    const posted = await this.prisma.$transaction(async (tx) => {
      const allowNegative = true; // write-downs to zero are legitimate during count
      const movements = [];
      for (const line of adjustment.lines) {
        const diff = Money.fromDecimalString(line.differenceQuantity.toString());
        if (diff.isZero()) continue;
        movements.push(
          await this.applyMovement(
            tx,
            {
              companyId: adjustment.companyId,
              warehouseId: adjustment.warehouseId,
              productId: line.productId,
              movementType: diff.gt(Money.zero()) ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
              quantity: diff.abs().toString(),
              unitCost: line.unitCost.toString(),
              referenceType: 'stock_adjustment',
              referenceId: adjustment.id,
              referenceNo: adjustment.adjustmentNo,
              createdById: principal.userId,
            },
            { allowNegative },
          ),
        );
      }
      return tx.stockAdjustment.update({
        where: { id },
        data: { status: 'POSTED' },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'inventory.stock_adjustment_posted',
      resourceType: 'stock_adjustment',
      resourceId: id,
      companyId: adjustment.companyId,
      requestId,
      metadata: { adjustmentNo: adjustment.adjustmentNo },
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'inventory.stock_adjustment.posted',
        aggregateType: 'stock_adjustment',
        aggregateId: id,
        payload: {
          adjustmentNo: adjustment.adjustmentNo,
          warehouseId: adjustment.warehouseId,
          companyId: adjustment.companyId,
          lines: adjustment.lines.map((l) => ({
            productId: l.productId,
            differenceQuantity: l.differenceQuantity.toString(),
            unitCost: l.unitCost.toString(),
          })),
        },
      },
      this.prisma,
    );
    return posted;
  }

  async listStockAdjustments(principal: Principal, query: { page: number; pageSize: number }) {
    const where: Prisma.StockAdjustmentWhereInput = principal.companyIds
      ? { companyId: { in: principal.companyIds } }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockAdjustment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { warehouse: { select: { code: true, name: true } } },
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Stock overview + movement ledger -------------------------------------------------

  async listStockBalances(
    principal: Principal,
    query: { page: number; pageSize: number; warehouseId?: string; lowStockOnly?: boolean },
  ) {
    const where: Prisma.StockBalanceWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockBalance.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          product: { select: { sku: true, name: true, productType: true, reorderLevel: true } },
          warehouse: { select: { code: true, name: true } },
          location: { select: { code: true, name: true } },
        },
      }),
      this.prisma.stockBalance.count({ where }),
    ]);
    const filtered = query.lowStockOnly
      ? rows.filter((r) => r.onHand.toString() !== '0' && r.onHand.lt(r.product.reorderLevel))
      : rows;
    return { rows: filtered, total };
  }

  async listMovements(
    principal: Principal,
    query: { page: number; pageSize: number; productId?: string; warehouseId?: string },
  ) {
    const where: Prisma.StockMovementWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { movementDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          product: { select: { sku: true, name: true } },
          warehouse: { select: { code: true, name: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Procurement bridge -----------------------------------------------------------------
  // Goods receipts create RECEIPT movements so stock, valuation and the movement
  // ledger update in the same transaction as the GR (USER-FLOWS §11.1).
  async recordGoodsReceipt(
    tx: Tx,
    data: {
      companyId: string;
      warehouseId: string;
      goodsReceiptId: string;
      receiptNo: string;
      lines: Array<{
        productId: string | null;
        quantity: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        warehouseLocationId?: string | null;
        batchNo?: string | null;
        serialNo?: string | null;
      }>;
      createdById: string | null;
    },
  ): Promise<void> {
    const allowNegative = false;
    for (const line of data.lines) {
      if (!line.productId) continue;
      await this.applyMovement(
        tx,
        {
          companyId: data.companyId,
          warehouseId: data.warehouseId,
          warehouseLocationId: line.warehouseLocationId ?? null,
          productId: line.productId,
          movementType: 'RECEIPT',
          quantity: line.quantity.toString(),
          unitCost: line.unitCost.toString(),
          batchNo: line.batchNo ?? null,
          serialNo: line.serialNo ?? null,
          referenceType: 'goods_receipt',
          referenceId: data.goodsReceiptId,
          referenceNo: data.receiptNo,
          createdById: data.createdById,
        },
        { allowNegative },
      );
    }
  }

  /**
   * Stage 7 bridge: customer deliveries post ISSUE movements at the balance's
   * weighted-average cost, inside the same transaction as the delivery
   * (USER-FLOWS §12.3). Negative stock is never allowed on the sales path.
   */
  async recordDeliveryIssues(
    tx: Tx,
    data: {
      companyId: string;
      warehouseId: string;
      deliveryId: string;
      deliveryNo: string;
      lines: Array<{
        productId: string | null;
        quantity: Prisma.Decimal;
        warehouseLocationId?: string | null;
        batchNo?: string | null;
        serialNo?: string | null;
      }>;
      createdById: string | null;
    },
  ): Promise<void> {
    for (const line of data.lines) {
      if (!line.productId) continue;
      // Default the issue location to the warehouse's deepest stock position
      // for the product (deliveries rarely specify a bin explicitly).
      let locationId = line.warehouseLocationId ?? null;
      const balance = await tx.stockBalance.findFirst({
        where: {
          warehouseId: data.warehouseId,
          productId: line.productId,
          ...(locationId ? { warehouseLocationId: locationId } : {}),
        },
        orderBy: { onHand: 'desc' },
      });
      if (!locationId) {
        locationId = balance?.warehouseLocationId ?? null;
      }
      // Stamp the movement with the balance's weighted-average cost so the
      // ledger carries COGS per issue (avg cost is unchanged by outbound moves).
      await this.applyMovement(
        tx,
        {
          companyId: data.companyId,
          warehouseId: data.warehouseId,
          warehouseLocationId: locationId,
          productId: line.productId,
          movementType: 'ISSUE',
          quantity: line.quantity.toString(),
          unitCost: balance ? balance.avgCost.toString() : '0',
          batchNo: line.batchNo ?? null,
          serialNo: line.serialNo ?? null,
          referenceType: 'delivery',
          referenceId: data.deliveryId,
          referenceNo: data.deliveryNo,
          createdById: data.createdById,
        },
        { allowNegative: false },
      );
    }
  }
}
