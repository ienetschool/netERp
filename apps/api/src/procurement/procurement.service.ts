import { Injectable } from '@nestjs/common';
import { PrismaService } from '@erp/prisma';
import { Money, sumMoney } from '@erp/types';
import { BusinessRuleError, NotFoundError } from '../common/errors.js';
import { AuditService } from '../common/audit.service.js';
import { OutboxService } from '../platform/outbox.service.js';
import { WorkflowEngineService } from '../workflow/workflow-engine.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { NumberingService, DOCUMENT_TYPES } from '../platform/numbering.service.js';
import type { Prisma } from '@erp/prisma';
import type { RequestPrincipal } from '../common/request-context.js';
import type {
  SupplierCreateInput,
  SupplierUpdateInput,
  PurchaseRequestCreateInput,
  RfqCreateInput,
  QuotationCreateInput,
  PurchaseOrderCreateInput,
  GoodsReceiptCreateInput,
  InvoiceCreateInput,
  PaymentCreateInput,
} from '@erp/validation';

type Principal = RequestPrincipal & { isSuperAdmin?: boolean };

/**
 * Procurement module (PRD Stage 5): procure-to-pay.
 *
 * Purchase requests and purchase orders run through the workflow engine
 * (entity types `purchase_request` / `purchase_order`, outcomes applied via
 * applyWorkflowOutcome). Goods receipts update PO received quantities.
 * Supplier invoices run a three-way match against PO + goods receipt
 * (CLAUDE.md §41: variance becomes an explicit exception). Payments allocate
 * against invoices and drive OPEN -> PARTIALLY_PAID -> PAID. Accounting
 * effects (AP journal) are emitted on the outbox for the accounting slice.
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowEngineService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly inventory: InventoryService,
  ) {}

  private scopeGuard(principal: Principal, companyId: string): void {
    if (principal.companyIds && !principal.companyIds.includes(companyId)) {
      throw new NotFoundError('Record not found');
    }
  }

  // ---- Suppliers -----------------------------------------------------------

  async createSupplier(principal: Principal, input: SupplierCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const supplier = await this.prisma.$transaction(async (tx) => {
      const supplierNo =
        input.supplierNo ??
        (await this.numbering.nextDocumentNumber(tx, input.companyId, DOCUMENT_TYPES.SUPPLIER));
      return tx.supplier.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          supplierNo,
          legalName: input.legalName,
          displayName: input.displayName,
          taxNumber: input.taxNumber ?? null,
          registrationNumber: input.registrationNumber ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          currencyId: input.currencyId,
          paymentTermsId: input.paymentTermsId ?? null,
          defaultPayableAccountId: input.defaultPayableAccountId ?? null,
          createdById: principal.userId,
        },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.supplier_created',
      resourceType: 'supplier',
      resourceId: supplier.id,
      companyId: supplier.companyId,
      requestId,
    });
    return supplier;
  }

  async listSuppliers(principal: Principal, query: { page: number; pageSize: number }) {
    const where: Prisma.SupplierWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: [{ supplierNo: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { currency: { select: { code: true } } },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return { rows, total };
  }

  async updateSupplier(
    principal: Principal,
    id: string,
    input: SupplierUpdateInput,
    requestId: string | null,
  ) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundError('Supplier not found');
    this.scopeGuard(principal, supplier.companyId);
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber } : {}),
        ...(input.registrationNumber !== undefined
          ? { registrationNumber: input.registrationNumber }
          : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.currencyId !== undefined ? { currencyId: input.currencyId } : {}),
        ...(input.paymentTermsId !== undefined ? { paymentTermsId: input.paymentTermsId } : {}),
        ...(input.defaultPayableAccountId !== undefined
          ? { defaultPayableAccountId: input.defaultPayableAccountId }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.supplier_updated',
      resourceType: 'supplier',
      resourceId: id,
      companyId: supplier.companyId,
      requestId,
    });
    return updated;
  }

  async addBankAccount(
    principal: Principal,
    input: {
      supplierId: string;
      bankName: string;
      accountName: string;
      accountNumber: string;
      routingRef?: string | undefined;
      currencyId: string;
      isDefault: boolean;
    },
    requestId: string | null,
  ) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new NotFoundError('Supplier not found');
    this.scopeGuard(principal, supplier.companyId);
    // Banking information is restricted (DATA-MODEL §9): write-scoped here, and
    // reads of bank accounts require the dedicated permission in the controller.
    const account = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.supplierBankAccount.updateMany({
          where: { supplierId: input.supplierId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.supplierBankAccount.create({
        data: {
          supplierId: input.supplierId,
          bankName: input.bankName,
          accountName: input.accountName,
          accountNumber: input.accountNumber,
          routingRef: input.routingRef ?? null,
          currencyId: input.currencyId,
          isDefault: input.isDefault,
        },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.supplier_bank_account_added',
      resourceType: 'supplier_bank_account',
      resourceId: account.id,
      companyId: supplier.companyId,
      requestId,
    });
    return account;
  }

  // ---- Purchase requests ---------------------------------------------------

  async createPurchaseRequest(
    principal: Principal,
    input: PurchaseRequestCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const request = await this.prisma.$transaction(async (tx) => {
      const requestNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.PURCHASE_REQUEST,
      );
      return tx.purchaseRequest.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          departmentId: input.departmentId ?? null,
          requestNo,
          requestedBy: principal.userId,
          requiredDate: new Date(`${input.requiredDate}T00:00:00Z`),
          purpose: input.purpose ?? null,
          lines: {
            create: input.lines.map((line) => {
              const unitCost = Money.fromDecimalString(line.estimatedUnitCost ?? '0');
              const total = unitCost.multiplyByFactor(line.quantity);
              return {
                description: line.description,
                quantity: line.quantity,
                estimatedUnitCost: unitCost.toString(),
                estimatedTotal: total.toString(),
                preferredSupplierId: line.preferredSupplierId ?? null,
              };
            }),
          },
        },
        include: { lines: true },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.purchase_request_created',
      resourceType: 'purchase_request',
      resourceId: request.id,
      companyId: request.companyId,
      requestId,
    });
    return request;
  }

  async listPurchaseRequests(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.PurchaseRequestWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { lines: true },
      }),
      this.prisma.purchaseRequest.count({ where }),
    ]);
    return { rows, total };
  }

  /** Estimated total of a request, used as the default routing amount. */
  private requestTotal(lines: Array<{ estimatedTotal: Prisma.Decimal }>): string {
    return sumMoney(
      lines.map((l) => Money.fromDecimalString(l.estimatedTotal.toString())),
    ).toString();
  }

  async submitPurchaseRequest(
    principal: Principal,
    id: string,
    amountOverride: string | undefined,
    requestId: string | null,
  ) {
    const request = await this.prisma.purchaseRequest.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!request) throw new NotFoundError('Purchase request not found');
    this.scopeGuard(principal, request.companyId);
    if (request.status !== 'DRAFT') {
      throw new BusinessRuleError(`Purchase request is ${request.status.toLowerCase()}, not DRAFT`);
    }

    const amount = amountOverride ?? this.requestTotal(request.lines);
    const started = await this.workflow.startInstance({
      entityType: 'purchase_request',
      entityId: request.id,
      companyId: request.companyId,
      actorUserId: principal.userId,
    });
    await this.workflow.executeTransition({
      instanceId: started.instanceId,
      action: 'submit',
      actorUserId: principal.userId,
      amount,
    });
    const updated = await this.prisma.purchaseRequest.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', workflowInstanceId: started.instanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.purchase_request_submitted',
      resourceType: 'purchase_request',
      resourceId: id,
      companyId: request.companyId,
      requestId,
      metadata: { amount },
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'procurement.purchase_request.submitted',
        aggregateType: 'purchase_request',
        aggregateId: id,
        payload: { workflowInstanceId: started.instanceId, amount },
      },
      this.prisma,
    );
    return updated;
  }

  /** Bridges workflow terminal states back onto the purchase request. */
  async applyPurchaseRequestOutcome(
    instanceId: string,
    outcome: string,
    actorUserId: string,
  ): Promise<void> {
    if (outcome === 'IN_PROGRESS') return;
    const request = await this.prisma.purchaseRequest.findUnique({
      where: { workflowInstanceId: instanceId },
    });
    if (!request || request.status !== 'PENDING_APPROVAL') return;

    const status =
      outcome === 'COMPLETED' ? 'APPROVED' : outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
    await this.prisma.purchaseRequest.update({
      where: { id: request.id },
      data: {
        status,
        decidedBy: actorUserId,
        decidedAt: new Date(),
      },
    });
  }

  // ---- RFQs and quotations ---------------------------------------------------

  async createRfq(principal: Principal, input: RfqCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const rfq = await this.prisma.$transaction(async (tx) => {
      const rfqNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.RFQ,
      );
      return tx.rfq.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          rfqNo,
          purchaseRequestId: input.purchaseRequestId ?? null,
          issueDate: new Date(`${input.issueDate}T00:00:00Z`),
          responseDueDate: new Date(`${input.responseDueDate}T00:00:00Z`),
          status: 'SENT',
          suppliers: { create: input.supplierIds.map((supplierId) => ({ supplierId })) },
        },
        include: {
          suppliers: { include: { supplier: { select: { supplierNo: true, displayName: true } } } },
        },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.rfq_created',
      resourceType: 'rfq',
      resourceId: rfq.id,
      companyId: rfq.companyId,
      requestId,
    });
    return rfq;
  }

  async listRfqs(principal: Principal, query: { page: number; pageSize: number }) {
    const where: Prisma.RfqWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.rfq.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          suppliers: { include: { supplier: { select: { displayName: true } } } },
          quotations: { select: { quotationNo: true, grandTotal: true, status: true } },
        },
      }),
      this.prisma.rfq.count({ where }),
    ]);
    return { rows, total };
  }

  async createQuotation(
    principal: Principal,
    input: QuotationCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const quotation = await this.prisma.$transaction(async (tx) => {
      const quotationNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.SUPPLIER_QUOTATION,
      );
      const subtotal = sumMoney(
        input.lines.map((l) => Money.fromDecimalString(l.unitPrice).multiplyByFactor(l.quantity)),
      );
      const taxTotal = sumMoney(
        input.lines.map((l) => Money.fromDecimalString(l.taxAmount ?? '0')),
      );
      const grandTotal = subtotal.plus(taxTotal);
      return tx.supplierQuotation.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          quotationNo,
          supplierId: input.supplierId,
          rfqId: input.rfqId ?? null,
          quotationDate: new Date(`${input.quotationDate}T00:00:00Z`),
          validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00Z`) : null,
          currencyId: input.currencyId,
          subtotal: subtotal.toString(),
          taxTotal: taxTotal.toString(),
          grandTotal: grandTotal.toString(),
          lines: {
            create: input.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: Money.fromDecimalString(l.unitPrice).toString(),
              taxAmount: Money.fromDecimalString(l.taxAmount ?? '0').toString(),
              lineTotal: Money.fromDecimalString(l.unitPrice)
                .multiplyByFactor(l.quantity)
                .toString(),
            })),
          },
        },
        include: { lines: true, supplier: { select: { displayName: true } } },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.quotation_recorded',
      resourceType: 'supplier_quotation',
      resourceId: quotation.id,
      companyId: quotation.companyId,
      requestId,
    });
    return quotation;
  }

  /** Selects a winning quotation (comparison history preserved on siblings). */
  async selectQuotation(
    principal: Principal,
    quotationId: string,
    requestId: string | null,
  ): Promise<unknown> {
    const quotation = await this.prisma.supplierQuotation.findUnique({
      where: { id: quotationId },
    });
    if (!quotation) throw new NotFoundError('Quotation not found');
    this.scopeGuard(principal, quotation.companyId);
    if (quotation.status !== 'RECEIVED') {
      throw new BusinessRuleError(`Quotation is ${quotation.status.toLowerCase()}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (quotation.rfqId) {
        await tx.supplierQuotation.updateMany({
          where: { rfqId: quotation.rfqId, status: 'RECEIVED' },
          data: { status: 'REJECTED' },
        });
        await tx.rfq.update({ where: { id: quotation.rfqId }, data: { status: 'CLOSED' } });
      }
      return tx.supplierQuotation.update({
        where: { id: quotationId },
        data: { status: 'SELECTED', selectedBy: principal.userId, selectedAt: new Date() },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.quotation_selected',
      resourceType: 'supplier_quotation',
      resourceId: quotationId,
      companyId: quotation.companyId,
      requestId,
    });
    return updated;
  }

  // ---- Purchase orders -------------------------------------------------------

  async createPurchaseOrder(
    principal: Principal,
    input: PurchaseOrderCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.companyId !== input.companyId) {
      throw new NotFoundError('Supplier not found');
    }
    if (supplier.status !== 'ACTIVE') {
      throw new BusinessRuleError(`Supplier is ${supplier.status.toLowerCase()}; not orderable`);
    }
    const order = await this.prisma.$transaction(async (tx) => {
      const poNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.PURCHASE_ORDER,
      );
      const subtotal = sumMoney(
        input.lines.map((l) =>
          Money.fromDecimalString(l.unitPrice)
            .multiplyByFactor(l.quantity)
            .minus(Money.fromDecimalString(l.discount ?? '0')),
        ),
      );
      const taxTotal = sumMoney(
        input.lines.map((l) => Money.fromDecimalString(l.taxAmount ?? '0')),
      );
      const grandTotal = subtotal.plus(taxTotal);
      return tx.purchaseOrder.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          departmentId: input.departmentId ?? null,
          warehouseId: input.warehouseId ?? null,
          poNo,
          supplierId: supplier.id,
          quotationId: input.quotationId ?? null,
          orderDate: new Date(`${input.orderDate}T00:00:00Z`),
          expectedDate: input.expectedDate ? new Date(`${input.expectedDate}T00:00:00Z`) : null,
          currencyId: supplier.currencyId,
          subtotal: subtotal.toString(),
          discountTotal: sumMoney(
            input.lines.map((l) => Money.fromDecimalString(l.discount ?? '0')),
          ).toString(),
          taxTotal: taxTotal.toString(),
          grandTotal: grandTotal.toString(),
          createdById: principal.userId,
          lines: {
            create: input.lines.map((l) => {
              const lineTotal = Money.fromDecimalString(l.unitPrice)
                .multiplyByFactor(l.quantity)
                .minus(Money.fromDecimalString(l.discount ?? '0'));
              return {
                description: l.description,
                quantity: l.quantity,
                unitPrice: Money.fromDecimalString(l.unitPrice).toString(),
                discount: Money.fromDecimalString(l.discount ?? '0').toString(),
                taxAmount: Money.fromDecimalString(l.taxAmount ?? '0').toString(),
                lineTotal: lineTotal.toString(),
              };
            }),
          },
        },
        include: { lines: true, supplier: { select: { displayName: true } } },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.purchase_order_created',
      resourceType: 'purchase_order',
      resourceId: order.id,
      companyId: order.companyId,
      requestId,
    });
    return order;
  }

  async listPurchaseOrders(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          supplier: { select: { displayName: true } },
          lines: { select: { quantity: true, receivedQuantity: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { rows, total };
  }

  async getPurchaseOrder(principal: Principal, id: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { supplierNo: true, displayName: true } },
        lines: true,
        receipts: { select: { receiptNo: true, status: true, receiptDate: true } },
        invoices: { select: { internalInvoiceNo: true, status: true, matchStatus: true } },
      },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    this.scopeGuard(principal, order.companyId);
    return order;
  }

  async submitPurchaseOrder(
    principal: Principal,
    id: string,
    amountOverride: string | undefined,
    requestId: string | null,
  ) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    this.scopeGuard(principal, order.companyId);
    if (order.status !== 'DRAFT') {
      throw new BusinessRuleError(`Purchase order is ${order.status.toLowerCase()}, not DRAFT`);
    }
    const amount = amountOverride ?? order.grandTotal.toString();
    const started = await this.workflow.startInstance({
      entityType: 'purchase_order',
      entityId: order.id,
      companyId: order.companyId,
      actorUserId: principal.userId,
    });
    await this.workflow.executeTransition({
      instanceId: started.instanceId,
      action: 'submit',
      actorUserId: principal.userId,
      amount,
    });
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', workflowInstanceId: started.instanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.purchase_order_submitted',
      resourceType: 'purchase_order',
      resourceId: id,
      companyId: order.companyId,
      requestId,
      metadata: { amount },
    });
    return updated;
  }

  /** Bridges workflow terminal states back onto the purchase order. */
  async applyPurchaseOrderOutcome(
    instanceId: string,
    outcome: string,
    actorUserId: string,
  ): Promise<void> {
    if (outcome === 'IN_PROGRESS') return;
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { workflowInstanceId: instanceId },
    });
    if (!order || order.status !== 'PENDING_APPROVAL') return;

    if (outcome === 'COMPLETED') {
      await this.prisma.purchaseOrder.update({
        where: { id: order.id },
        data: { status: 'APPROVED', decidedBy: actorUserId, decidedAt: new Date() },
      });
      await this.outbox.emitAndWait(
        {
          eventType: 'procurement.purchase_order.approved',
          aggregateType: 'purchase_order',
          aggregateId: order.id,
          payload: { poNo: order.poNo, grandTotal: order.grandTotal.toString() },
        },
        this.prisma,
      );
      return;
    }
    await this.prisma.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED',
        decidedBy: actorUserId,
        decidedAt: new Date(),
      },
    });
  }

  // ---- Goods receipts --------------------------------------------------------

  async createGoodsReceipt(
    principal: Principal,
    input: GoodsReceiptCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { lines: true },
    });
    if (!order) throw new NotFoundError('Purchase order not found');
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
      throw new BusinessRuleError(
        `Purchase order is ${order.status.toLowerCase()}; cannot receive`,
      );
    }

    // Over-receipt guard: cumulative received quantity may not exceed ordered.
    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      const poLine = lineById.get(line.purchaseOrderLineId);
      if (!poLine || poLine.purchaseOrderId !== order.id) {
        throw new BusinessRuleError('Receipt line references a line from another purchase order');
      }
      const ordered = Number(poLine.quantity.toString());
      const already = Number(poLine.receivedQuantity.toString());
      if (already + line.quantity > ordered + 1e-9) {
        throw new BusinessRuleError(
          `Receipt exceeds ordered quantity for line ${poLine.description}`,
        );
      }
    }

    const receipt = await this.prisma.$transaction(async (tx) => {
      const receiptNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.GOODS_RECEIPT,
      );
      const created = await tx.goodsReceipt.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? order.branchId,
          warehouseId: input.warehouseId ?? order.warehouseId,
          receiptNo,
          supplierId: order.supplierId,
          purchaseOrderId: order.id,
          receiptDate: new Date(`${input.receiptDate}T00:00:00Z`),
          receivedBy: principal.userId,
          status: 'POSTED',
          lines: {
            create: input.lines.map((l) => {
              const poLine = lineById.get(l.purchaseOrderLineId) as {
                unitPrice: Prisma.Decimal;
                productId: string | null;
                unitId: string | null;
              };
              return {
                purchaseOrderLineId: l.purchaseOrderLineId,
                productId: poLine.productId,
                warehouseLocationId: null,
                quantity: l.quantity,
                unitId: poLine.unitId,
                batchNo: l.batchNo ?? null,
                serialNo: l.serialNo ?? null,
                unitCost: Money.fromDecimalString(
                  l.unitCost ?? poLine.unitPrice.toString(),
                ).toString(),
              };
            }),
          },
        },
        include: { lines: true },
      });
      // Stage 6 bridge: stock movements + weighted-average valuation for this
      // receipt, inside the same transaction as the GR itself.
      await this.inventory.recordGoodsReceipt(tx, {
        companyId: input.companyId,
        warehouseId: created.warehouseId as string,
        goodsReceiptId: created.id,
        receiptNo,
        createdById: principal.userId,
        lines: created.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          warehouseLocationId: l.warehouseLocationId,
          batchNo: l.batchNo,
          serialNo: l.serialNo,
        })),
      });
      // Update PO received quantities and derive the PO status.
      for (const line of input.lines) {
        const poLine = lineById.get(line.purchaseOrderLineId) as { id: string };
        await tx.purchaseOrderLine.update({
          where: { id: poLine.id },
          data: { receivedQuantity: { increment: line.quantity } },
        });
      }
      const refreshed = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: order.id },
        select: { quantity: true, receivedQuantity: true },
      });
      const fullyReceived = refreshed.every(
        (l) => Number(l.receivedQuantity.toString()) >= Number(l.quantity.toString()) - 1e-9,
      );
      const anyReceived = refreshed.some((l) => Number(l.receivedQuantity.toString()) > 0);
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : order.status,
        },
      });
      return created;
    });

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.goods_receipt_posted',
      resourceType: 'goods_receipt',
      resourceId: receipt.id,
      companyId: receipt.companyId,
      requestId,
      metadata: { purchaseOrderId: order.id, poNo: order.poNo },
    });
    // Inventory effects (stock movements/valuation) arrive with Stage 6; the
    // event carries what that slice needs.
    await this.outbox.emitAndWait(
      {
        eventType: 'procurement.goods_receipt.posted',
        aggregateType: 'goods_receipt',
        aggregateId: receipt.id,
        payload: {
          purchaseOrderId: order.id,
          poNo: order.poNo,
          warehouseId: receipt.warehouseId,
          lines: input.lines.map((l) => ({
            purchaseOrderLineId: l.purchaseOrderLineId,
            quantity: l.quantity,
          })),
        },
      },
      this.prisma,
    );
    return receipt;
  }

  // ---- Supplier invoices (three-way match) ------------------------------------

  async createSupplierInvoice(
    principal: Principal,
    input: InvoiceCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.companyId !== input.companyId) {
      throw new NotFoundError('Supplier not found');
    }

    let matchStatus = 'UNMATCHED';
    let matchDetail: Prisma.InputJsonValue | undefined;
    if (input.purchaseOrderId) {
      const order = await this.prisma.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        include: { lines: true, receipts: { include: { lines: true } } },
      });
      if (!order || order.companyId !== input.companyId) {
        throw new NotFoundError('Purchase order not found');
      }
      // Three-way match: invoice quantity vs received quantity per PO line,
      // and invoice price vs PO price within tolerance (USER-FLOWS §10.7).
      const poLines = new Map(order.lines.map((l) => [l.id, l]));
      const receivedByLine = new Map<string, number>();
      for (const receipt of order.receipts) {
        for (const rl of receipt.lines) {
          receivedByLine.set(
            rl.purchaseOrderLineId,
            (receivedByLine.get(rl.purchaseOrderLineId) ?? 0) + Number(rl.quantity.toString()),
          );
        }
      }
      const variances: Array<{ line: string; kind: string; detail: string }> = [];
      for (const line of input.lines) {
        if (!line.purchaseOrderLineId) continue;
        const poLine = poLines.get(line.purchaseOrderLineId);
        if (!poLine) {
          variances.push({ line: line.description, kind: 'UNKNOWN_LINE', detail: 'Not on PO' });
          continue;
        }
        const received = receivedByLine.get(line.purchaseOrderLineId) ?? 0;
        if (line.quantity > received + 1e-9) {
          variances.push({
            line: line.description,
            kind: 'QUANTITY',
            detail: `Invoiced ${line.quantity} > received ${received}`,
          });
        }
        const poPrice = Number(poLine.unitPrice.toString());
        const invoicePrice = Number(Money.fromDecimalString(line.unitPrice).toString());
        if (Math.abs(invoicePrice - poPrice) > 0.01) {
          variances.push({
            line: line.description,
            kind: 'PRICE',
            detail: `Invoiced ${invoicePrice} vs PO ${poPrice}`,
          });
        }
      }
      matchStatus = variances.length === 0 ? 'MATCHED' : 'VARIANCE';
      matchDetail = { variances };
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const internalInvoiceNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.SUPPLIER_INVOICE,
      );
      const subtotal = sumMoney(
        input.lines.map((l) => Money.fromDecimalString(l.unitPrice).multiplyByFactor(l.quantity)),
      );
      const taxTotal = sumMoney(
        input.lines.map((l) => Money.fromDecimalString(l.taxAmount ?? '0')),
      );
      const grandTotal = subtotal.plus(taxTotal);
      return tx.supplierInvoice.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          supplierId: supplier.id,
          supplierInvoiceNo: input.supplierInvoiceNo,
          internalInvoiceNo,
          purchaseOrderId: input.purchaseOrderId ?? null,
          goodsReceiptId: input.goodsReceiptId ?? null,
          invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
          dueDate: new Date(`${input.dueDate}T00:00:00Z`),
          currencyId: supplier.currencyId,
          subtotal: subtotal.toString(),
          taxTotal: taxTotal.toString(),
          grandTotal: grandTotal.toString(),
          matchStatus,
          ...(matchDetail ? { matchDetail } : {}),
          status: matchStatus === 'MATCHED' ? 'MATCHED' : 'DRAFT',
          lines: {
            create: input.lines.map((l) => ({
              purchaseOrderLineId: l.purchaseOrderLineId ?? null,
              description: l.description,
              quantity: l.quantity,
              unitPrice: Money.fromDecimalString(l.unitPrice).toString(),
              taxAmount: Money.fromDecimalString(l.taxAmount ?? '0').toString(),
              lineTotal: Money.fromDecimalString(l.unitPrice)
                .multiplyByFactor(l.quantity)
                .toString(),
            })),
          },
        },
        include: { lines: true },
      });
    });

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.supplier_invoice_created',
      resourceType: 'supplier_invoice',
      resourceId: invoice.id,
      companyId: invoice.companyId,
      requestId,
      metadata: { matchStatus },
    });
    return invoice;
  }

  async listSupplierInvoices(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.SupplierInvoiceWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplierInvoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { supplier: { select: { displayName: true } } },
      }),
      this.prisma.supplierInvoice.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Posts a MATCHED invoice (USER-FLOWS §10.8): validates the open period and
   * emits the AP journal payload on the outbox for the accounting slice.
   */
  async postSupplierInvoice(principal: Principal, id: string, requestId: string | null) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundError('Supplier invoice not found');
    this.scopeGuard(principal, invoice.companyId);
    if (invoice.matchStatus === 'VARIANCE') {
      throw new BusinessRuleError('Invoice has match variances; resolve before posting');
    }
    if (!['MATCHED', 'APPROVED'].includes(invoice.status)) {
      throw new BusinessRuleError(`Invoice is ${invoice.status.toLowerCase()}; cannot post`);
    }
    const openPeriod = await this.prisma.financialPeriod.findFirst({
      where: {
        companyId: invoice.companyId,
        status: 'OPEN',
        startDate: { lte: invoice.invoiceDate },
        endDate: { gte: invoice.invoiceDate },
      },
    });
    if (!openPeriod) {
      throw new BusinessRuleError('No open financial period covers the invoice date');
    }
    const payableAccount = await this.prisma.account.findFirst({
      where: { companyId: invoice.companyId, accountCode: '2100' },
    });
    const expenseAccount = await this.prisma.account.findFirst({
      where: { companyId: invoice.companyId, accountCode: '5000' },
    });
    if (!payableAccount || !expenseAccount) {
      throw new BusinessRuleError('AP posting accounts missing from the chart of accounts');
    }
    const grandTotal = Money.fromDecimalString(invoice.grandTotal.toString());
    const taxTotal = Money.fromDecimalString(invoice.taxTotal.toString());
    const net = grandTotal.minus(taxTotal);
    const lines: Array<{
      accountCode: string;
      accountId: string;
      side: 'DEBIT' | 'CREDIT';
      amount: string;
      description: string;
    }> = [
      {
        accountCode: expenseAccount.accountCode,
        accountId: expenseAccount.id,
        side: 'DEBIT',
        amount: net.toString(),
        description: 'Procurement expense',
      },
    ];
    if (!taxTotal.isZero()) {
      lines.push({
        accountCode: expenseAccount.accountCode,
        accountId: expenseAccount.id,
        side: 'DEBIT',
        amount: taxTotal.toString(),
        description: 'Input tax',
      });
    }
    lines.push({
      accountCode: payableAccount.accountCode,
      accountId: payableAccount.id,
      side: 'CREDIT',
      amount: grandTotal.toString(),
      description: `AP ${invoice.internalInvoiceNo}`,
    });
    const debits = sumMoney(
      lines.filter((l) => l.side === 'DEBIT').map((l) => Money.fromDecimalString(l.amount)),
    );
    const credits = sumMoney(
      lines.filter((l) => l.side === 'CREDIT').map((l) => Money.fromDecimalString(l.amount)),
    );
    if (!debits.eq(credits)) throw new BusinessRuleError('AP journal does not balance');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.supplierInvoice.update({
        where: { id },
        data: { status: 'POSTED', postingDate: new Date() },
      });
      this.outbox.emit(
        {
          eventType: 'procurement.supplier_invoice.posted',
          aggregateType: 'supplier_invoice',
          aggregateId: id,
          payload: {
            journal: {
              journalDate: invoice.invoiceDate.toISOString().slice(0, 10),
              currencyId: invoice.currencyId,
              sourceType: 'supplier_invoice',
              sourceId: id,
              lines,
              totals: { debits: debits.toString(), credits: credits.toString() },
            },
          },
        },
        tx,
      );
      return row;
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.supplier_invoice_posted',
      resourceType: 'supplier_invoice',
      resourceId: id,
      companyId: invoice.companyId,
      requestId,
    });
    return updated;
  }

  // ---- Supplier payments -------------------------------------------------------

  async createSupplierPayment(
    principal: Principal,
    input: PaymentCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.companyId !== input.companyId) {
      throw new NotFoundError('Supplier not found');
    }
    const payment = await this.prisma.$transaction(async (tx) => {
      const paymentNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.SUPPLIER_PAYMENT,
      );
      const allocatedTotal = sumMoney(
        input.allocations.map((a) => Money.fromDecimalString(a.amount)),
      );
      const created = await tx.supplierPayment.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          supplierId: supplier.id,
          paymentNo,
          paymentDate: new Date(`${input.paymentDate}T00:00:00Z`),
          currencyId: supplier.currencyId,
          amount: allocatedTotal.toString(),
          method: input.method,
          bankAccountRef: input.bankAccountRef ?? null,
          reference: input.reference ?? null,
          status: 'POSTED',
          postedBy: principal.userId,
          postedAt: new Date(),
          allocations: {
            create: input.allocations.map((a) => ({
              supplierInvoiceId: a.supplierInvoiceId,
              amount: Money.fromDecimalString(a.amount).toString(),
            })),
          },
        },
        include: { allocations: true },
      });
      // Apply allocations to invoices: OPEN -> PARTIALLY_PAID -> PAID.
      for (const allocation of created.allocations) {
        const invoice = await tx.supplierInvoice.findUnique({
          where: { id: allocation.supplierInvoiceId },
        });
        if (!invoice || invoice.companyId !== input.companyId) {
          throw new BusinessRuleError('Allocation references an invoice from another company');
        }
        if (!['APPROVED', 'POSTED', 'PARTIALLY_PAID'].includes(invoice.status)) {
          throw new BusinessRuleError(
            `Invoice ${invoice.internalInvoiceNo} is ${invoice.status.toLowerCase()}; not payable`,
          );
        }
        const alreadyPaid = Money.fromDecimalString(invoice.paidAmount.toString());
        const allocating = Money.fromDecimalString(allocation.amount.toString());
        const grandTotal = Money.fromDecimalString(invoice.grandTotal.toString());
        if (alreadyPaid.plus(allocating).gt(grandTotal)) {
          throw new BusinessRuleError(`Allocation overpays invoice ${invoice.internalInvoiceNo}`);
        }
        const newPaid = alreadyPaid.plus(allocating);
        await tx.supplierInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaid.toString(),
            status: newPaid.eq(grandTotal) ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      }
      return created;
    });

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'procurement.supplier_payment_posted',
      resourceType: 'supplier_payment',
      resourceId: payment.id,
      companyId: payment.companyId,
      requestId,
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'procurement.supplier_payment.posted',
        aggregateType: 'supplier_payment',
        aggregateId: payment.id,
        payload: {
          supplierId: supplier.id,
          amount: payment.amount.toString(),
          method: payment.method,
        },
      },
      this.prisma,
    );
    return payment;
  }

  async listSupplierPayments(principal: Principal, query: { page: number; pageSize: number }) {
    const where: Prisma.SupplierPaymentWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplierPayment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { supplier: { select: { displayName: true } } },
      }),
      this.prisma.supplierPayment.count({ where }),
    ]);
    return { rows, total };
  }
}
