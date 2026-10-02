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
  CustomerCreateInput,
  CustomerUpdateInput,
  SalesQuotationCreateInput,
  SalesOrderCreateInput,
  DeliveryCreateInput,
  CustomerInvoiceCreateInput,
  CustomerReceiptCreateInput,
} from '@erp/validation';

type Principal = RequestPrincipal & { isSuperAdmin?: boolean };

/**
 * Sales module (PRD Stage 7): quote to cash.
 *
 * Quotations and sales orders run through the workflow engine (entity types
 * `sales_quotation` / `sales_order`, outcomes applied via applyWorkflowOutcome,
 * threshold-routed on grand total like procurement). Deliveries post ISSUE
 * stock movements at weighted-average cost through the inventory bridge inside
 * the delivery transaction (USER-FLOWS §12.3) and update order fulfillment
 * quantities. Invoices reduce nothing by themselves — they create open AR;
 * receipts allocate across invoices and drive POSTED → PARTIALLY_PAID → PAID.
 * AR/Revenue/Tax/GL effects are emitted on the outbox for the accounting slice.
 */
@Injectable()
export class SalesService {
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

  // ---- Customers -----------------------------------------------------------

  async createCustomer(principal: Principal, input: CustomerCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const customer = await this.prisma.$transaction(async (tx) => {
      const customerNo =
        input.customerNo ??
        (await this.numbering.nextDocumentNumber(tx, input.companyId, DOCUMENT_TYPES.CUSTOMER));
      return tx.customer.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          customerNo,
          legalName: input.legalName,
          displayName: input.displayName,
          taxNumber: input.taxNumber ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          currencyId: input.currencyId,
          paymentTermsId: input.paymentTermsId ?? null,
          creditLimit: Money.fromDecimalString(input.creditLimit ?? '0').toString(),
          receivableAccountId: input.receivableAccountId ?? null,
          createdById: principal.userId,
        },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.customer_created',
      resourceType: 'customer',
      resourceId: customer.id,
      companyId: customer.companyId,
      requestId,
    });
    return customer;
  }

  async listCustomers(
    principal: Principal,
    query: { page: number; pageSize: number; search?: string; status?: string },
  ) {
    const where: Prisma.CustomerWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { customerNo: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { legalName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: [{ customerNo: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { currency: { select: { code: true } } },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { rows, total };
  }

  async updateCustomer(
    principal: Principal,
    id: string,
    input: CustomerUpdateInput,
    requestId: string | null,
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundError('Customer not found');
    this.scopeGuard(principal, customer.companyId);
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.creditLimit !== undefined
          ? { creditLimit: Money.fromDecimalString(input.creditLimit).toString() }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.customer_updated',
      resourceType: 'customer',
      resourceId: id,
      companyId: customer.companyId,
      requestId,
    });
    return updated;
  }

  // ---- Sales quotations --------------------------------------------------------

  async createSalesQuotation(
    principal: Principal,
    input: SalesQuotationCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.companyId !== input.companyId) {
      throw new NotFoundError('Customer not found');
    }
    if (customer.status !== 'ACTIVE') {
      throw new BusinessRuleError(`Customer is ${customer.status.toLowerCase()}; not quotable`);
    }
    const quotation = await this.prisma.$transaction(async (tx) => {
      const quotationNo = await this.numbering.nextDocumentNumber(
        tx,
        input.companyId,
        DOCUMENT_TYPES.SALES_QUOTATION,
      );
      const lineTotals = input.lines.map((l) =>
        Money.fromDecimalString(l.unitPrice)
          .multiplyByFactor(l.quantity)
          .minus(Money.fromDecimalString(l.discount ?? '0')),
      );
      const subtotal = sumMoney(lineTotals);
      const taxTotal = sumMoney(
        input.lines.map((l) => Money.fromDecimalString(l.taxAmount ?? '0')),
      );
      const grandTotal = subtotal.plus(taxTotal);
      return tx.salesQuotation.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          quotationNo,
          customerId: customer.id,
          quotationDate: new Date(`${input.quotationDate}T00:00:00Z`),
          validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00Z`) : null,
          currencyId: input.currencyId,
          subtotal: subtotal.toString(),
          discountTotal: sumMoney(
            input.lines.map((l) => Money.fromDecimalString(l.discount ?? '0')),
          ).toString(),
          taxTotal: taxTotal.toString(),
          grandTotal: grandTotal.toString(),
          createdById: principal.userId,
          lines: {
            create: input.lines.map((l, i) => ({
              productId: l.productId ?? null,
              description: l.description,
              quantity: l.quantity,
              unitId: l.unitId ?? null,
              unitPrice: Money.fromDecimalString(l.unitPrice).toString(),
              discount: Money.fromDecimalString(l.discount ?? '0').toString(),
              taxAmount: Money.fromDecimalString(l.taxAmount ?? '0').toString(),
              lineTotal: (lineTotals[i] as Money).toString(),
            })),
          },
        },
        include: { lines: true },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.quotation_created',
      resourceType: 'sales_quotation',
      resourceId: quotation.id,
      companyId: quotation.companyId,
      requestId,
    });
    return quotation;
  }

  async listSalesQuotations(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.SalesQuotationWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salesQuotation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          customer: { select: { customerNo: true, displayName: true } },
          lines: { select: { quantity: true } },
        },
      }),
      this.prisma.salesQuotation.count({ where }),
    ]);
    return { rows, total };
  }

  async getSalesQuotation(principal: Principal, id: string) {
    const quotation = await this.prisma.salesQuotation.findUnique({
      where: { id },
      include: {
        customer: { select: { customerNo: true, displayName: true, email: true } },
        lines: true,
        salesOrders: { select: { orderNo: true, status: true } },
      },
    });
    if (!quotation) throw new NotFoundError('Quotation not found');
    this.scopeGuard(principal, quotation.companyId);
    return quotation;
  }

  async submitSalesQuotation(
    principal: Principal,
    id: string,
    amountOverride: string | undefined,
    requestId: string | null,
  ) {
    const quotation = await this.prisma.salesQuotation.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundError('Quotation not found');
    this.scopeGuard(principal, quotation.companyId);
    if (quotation.status !== 'DRAFT') {
      throw new BusinessRuleError(`Quotation is ${quotation.status.toLowerCase()}, not DRAFT`);
    }
    const amount = amountOverride ?? quotation.grandTotal.toString();
    const started = await this.workflow.startInstance({
      entityType: 'sales_quotation',
      entityId: quotation.id,
      companyId: quotation.companyId,
      actorUserId: principal.userId,
    });
    await this.workflow.executeTransition({
      instanceId: started.instanceId,
      action: 'submit',
      actorUserId: principal.userId,
      amount,
    });
    const updated = await this.prisma.salesQuotation.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', workflowInstanceId: started.instanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.quotation_submitted',
      resourceType: 'sales_quotation',
      resourceId: id,
      companyId: quotation.companyId,
      requestId,
      metadata: { amount },
    });
    return updated;
  }

  /** Bridges workflow terminal states back onto the quotation. */
  async applyQuotationOutcome(instanceId: string, outcome: string, actorUserId: string) {
    if (outcome === 'IN_PROGRESS') return;
    const quotation = await this.prisma.salesQuotation.findUnique({
      where: { workflowInstanceId: instanceId },
    });
    if (!quotation || quotation.status !== 'PENDING_APPROVAL') return;

    if (outcome === 'COMPLETED') {
      await this.prisma.salesQuotation.update({
        where: { id: quotation.id },
        data: { status: 'APPROVED', decidedBy: actorUserId, decidedAt: new Date() },
      });
      return;
    }
    await this.prisma.salesQuotation.update({
      where: { id: quotation.id },
      data: {
        status: outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED',
        decidedBy: actorUserId,
        decidedAt: new Date(),
      },
    });
  }

  // ---- Sales orders --------------------------------------------------------------

  async createSalesOrder(
    principal: Principal,
    input: SalesOrderCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.companyId !== input.companyId) {
      throw new NotFoundError('Customer not found');
    }
    if (customer.status !== 'ACTIVE') {
      throw new BusinessRuleError(`Customer is ${customer.status.toLowerCase()}; not orderable`);
    }
    if (input.quotationId) {
      const quotation = await this.prisma.salesQuotation.findUnique({
        where: { id: input.quotationId },
      });
      if (!quotation || quotation.companyId !== input.companyId) {
        throw new NotFoundError('Quotation not found');
      }
      if (quotation.customerId !== customer.id) {
        throw new BusinessRuleError('Quotation belongs to a different customer');
      }
      if (!['APPROVED', 'SENT', 'ACCEPTED'].includes(quotation.status)) {
        throw new BusinessRuleError(
          `Quotation ${quotation.quotationNo} is ${quotation.status.toLowerCase()}; not convertible`,
        );
      }
    }

    // Credit limit guard (USER-FLOWS §12.2): open AR + this order may not
    // exceed the customer's limit when a positive limit is configured.
    const creditLimit = Money.fromDecimalString(customer.creditLimit.toString());
    if (!creditLimit.isZero()) {
      const openInvoices = await this.prisma.customerInvoice.aggregate({
        where: {
          customerId: customer.id,
          status: { in: ['POSTED', 'PARTIALLY_PAID'] },
        },
        _sum: { grandTotal: true },
      });
      const paidSum = await this.prisma.customerInvoice.aggregate({
        where: {
          customerId: customer.id,
          status: { in: ['POSTED', 'PARTIALLY_PAID'] },
        },
        _sum: { paidAmount: true },
      });
      const openAr = Money.fromDecimalString(
        (openInvoices._sum.grandTotal ?? '0').toString(),
      ).minus(Money.fromDecimalString((paidSum._sum.paidAmount ?? '0').toString()));
      const orderTotal = sumMoney(
        input.lines.map((l) =>
          Money.fromDecimalString(l.unitPrice)
            .multiplyByFactor(l.quantity)
            .minus(Money.fromDecimalString(l.discount ?? '0'))
            .plus(Money.fromDecimalString(l.taxAmount ?? '0')),
        ),
      );
      if (openAr.plus(orderTotal).gt(creditLimit)) {
        throw new BusinessRuleError(
          `Credit limit exceeded: open AR ${openAr.toString()} + order ${orderTotal.toString()} > limit ${creditLimit.toString()}`,
        );
      }
    }

    const order = await this.prisma.$transaction(
      async (tx) => {
        const orderNo = await this.numbering.nextDocumentNumber(
          tx,
          input.companyId,
          DOCUMENT_TYPES.SALES_ORDER,
        );
        const lineTotals = input.lines.map((l) =>
          Money.fromDecimalString(l.unitPrice)
            .multiplyByFactor(l.quantity)
            .minus(Money.fromDecimalString(l.discount ?? '0')),
        );
        const subtotal = sumMoney(lineTotals);
        const taxTotal = sumMoney(
          input.lines.map((l) => Money.fromDecimalString(l.taxAmount ?? '0')),
        );
        const grandTotal = subtotal.plus(taxTotal);
        return tx.salesOrder.create({
          data: {
            companyId: input.companyId,
            branchId: input.branchId ?? null,
            warehouseId: input.warehouseId ?? null,
            orderNo,
            customerId: customer.id,
            quotationId: input.quotationId ?? null,
            orderDate: new Date(`${input.orderDate}T00:00:00Z`),
            requestedDeliveryDate: input.requestedDeliveryDate
              ? new Date(`${input.requestedDeliveryDate}T00:00:00Z`)
              : null,
            currencyId: input.currencyId,
            subtotal: subtotal.toString(),
            discountTotal: sumMoney(
              input.lines.map((l) => Money.fromDecimalString(l.discount ?? '0')),
            ).toString(),
            taxTotal: taxTotal.toString(),
            grandTotal: grandTotal.toString(),
            createdById: principal.userId,
            lines: {
              create: input.lines.map((l, i) => ({
                productId: l.productId ?? null,
                description: l.description,
                quantity: l.quantity,
                unitId: l.unitId ?? null,
                unitPrice: Money.fromDecimalString(l.unitPrice).toString(),
                discount: Money.fromDecimalString(l.discount ?? '0').toString(),
                taxAmount: Money.fromDecimalString(l.taxAmount ?? '0').toString(),
                lineTotal: (lineTotals[i] as Money).toString(),
              })),
            },
          },
          include: { lines: true, customer: { select: { displayName: true } } },
        });
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.sales_order_created',
      resourceType: 'sales_order',
      resourceId: order.id,
      companyId: order.companyId,
      requestId,
    });
    return order;
  }

  async listSalesOrders(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.SalesOrderWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          customer: { select: { displayName: true } },
          lines: { select: { quantity: true, deliveredQuantity: true } },
        },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return { rows, total };
  }

  async getSalesOrder(principal: Principal, id: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { customerNo: true, displayName: true } },
        lines: true,
        deliveries: { select: { deliveryNo: true, status: true, deliveryDate: true } },
        invoices: { select: { invoiceNo: true, status: true, grandTotal: true } },
      },
    });
    if (!order) throw new NotFoundError('Sales order not found');
    this.scopeGuard(principal, order.companyId);
    return order;
  }

  async submitSalesOrder(
    principal: Principal,
    id: string,
    amountOverride: string | undefined,
    requestId: string | null,
  ) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundError('Sales order not found');
    this.scopeGuard(principal, order.companyId);
    if (order.status !== 'DRAFT') {
      throw new BusinessRuleError(`Sales order is ${order.status.toLowerCase()}, not DRAFT`);
    }
    const amount = amountOverride ?? order.grandTotal.toString();
    const started = await this.workflow.startInstance({
      entityType: 'sales_order',
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
    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', workflowInstanceId: started.instanceId },
    });
    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.sales_order_submitted',
      resourceType: 'sales_order',
      resourceId: id,
      companyId: order.companyId,
      requestId,
      metadata: { amount },
    });
    return updated;
  }

  /** Bridges workflow terminal states back onto the sales order. */
  async applySalesOrderOutcome(instanceId: string, outcome: string, actorUserId: string) {
    if (outcome === 'IN_PROGRESS') return;
    const order = await this.prisma.salesOrder.findUnique({
      where: { workflowInstanceId: instanceId },
    });
    if (!order || order.status !== 'PENDING_APPROVAL') return;

    if (outcome === 'COMPLETED') {
      await this.prisma.salesOrder.update({
        where: { id: order.id },
        data: { status: 'APPROVED', decidedBy: actorUserId, decidedAt: new Date() },
      });
      await this.outbox.emitAndWait(
        {
          eventType: 'sales.sales_order.approved',
          aggregateType: 'sales_order',
          aggregateId: order.id,
          payload: { orderNo: order.orderNo, grandTotal: order.grandTotal.toString() },
        },
        this.prisma,
      );
      return;
    }
    await this.prisma.salesOrder.update({
      where: { id: order.id },
      data: {
        status: outcome === 'REJECTED' ? 'REJECTED' : 'CANCELLED',
        decidedBy: actorUserId,
        decidedAt: new Date(),
      },
    });
  }

  // ---- Deliveries ------------------------------------------------------------

  async createDelivery(principal: Principal, input: DeliveryCreateInput, requestId: string | null) {
    this.scopeGuard(principal, input.companyId);
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.companyId !== input.companyId) {
      throw new NotFoundError('Customer not found');
    }
    let order: Prisma.SalesOrderGetPayload<{ include: { lines: true } }> | null = null;
    if (input.salesOrderId) {
      const found = await this.prisma.salesOrder.findUnique({
        where: { id: input.salesOrderId },
        include: { lines: true },
      });
      if (!found || found.companyId !== input.companyId) {
        throw new NotFoundError('Sales order not found');
      }
      if (!['APPROVED', 'PARTIALLY_DELIVERED'].includes(found.status)) {
        throw new BusinessRuleError(`Sales order is ${found.status.toLowerCase()}; cannot deliver`);
      }
      if (found.customerId !== customer.id) {
        throw new BusinessRuleError('Sales order belongs to a different customer');
      }
      order = found;
    }

    // Over-delivery guard against ordered quantities when tied to an order.
    if (order) {
      const lineById = new Map(order.lines.map((l) => [l.id, l]));
      for (const line of input.lines) {
        if (!line.salesOrderLineId) continue;
        const soLine = lineById.get(line.salesOrderLineId);
        if (!soLine || soLine.salesOrderId !== order.id) {
          throw new BusinessRuleError('Delivery line references a line from another sales order');
        }
        const ordered = Number(soLine.quantity.toString());
        const already = Number(soLine.deliveredQuantity.toString());
        if (already + line.quantity > ordered + 1e-9) {
          throw new BusinessRuleError(
            `Delivery exceeds ordered quantity for line ${soLine.description}`,
          );
        }
      }
    }

    const delivery = await this.prisma.$transaction(
      async (tx) => {
        const deliveryNo = await this.numbering.nextDocumentNumber(
          tx,
          input.companyId,
          DOCUMENT_TYPES.DELIVERY,
        );
        // Snapshot product/unit from the sales-order line when the caller only
        // references the line (mirrors the goods-receipt bridge).
        const soLineById = new Map((order?.lines ?? []).map((l) => [l.id, l]));
        const created = await tx.delivery.create({
          data: {
            companyId: input.companyId,
            branchId: input.branchId ?? null,
            warehouseId: input.warehouseId,
            deliveryNo,
            customerId: customer.id,
            salesOrderId: input.salesOrderId ?? null,
            deliveryDate: new Date(`${input.deliveryDate}T00:00:00Z`),
            deliveredBy: principal.userId,
            status: 'POSTED',
            lines: {
              create: input.lines.map((l) => {
                const soLine = l.salesOrderLineId ? soLineById.get(l.salesOrderLineId) : undefined;
                return {
                  salesOrderLineId: l.salesOrderLineId ?? null,
                  productId: l.productId ?? soLine?.productId ?? null,
                  warehouseLocationId: l.warehouseLocationId ?? null,
                  quantity: l.quantity,
                  unitId: l.unitId ?? soLine?.unitId ?? null,
                  batchNo: l.batchNo ?? null,
                  serialNo: l.serialNo ?? null,
                };
              }),
            },
          },
          include: { lines: true },
        });
        // Stage 7 bridge: ISSUE movements at weighted-average cost, same tx.
        await this.inventory.recordDeliveryIssues(tx, {
          companyId: input.companyId,
          warehouseId: input.warehouseId,
          deliveryId: created.id,
          deliveryNo,
          createdById: principal.userId,
          lines: created.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            warehouseLocationId: l.warehouseLocationId,
            batchNo: l.batchNo,
            serialNo: l.serialNo,
          })),
        });
        // Update order fulfillment quantities and derive order status.
        if (order) {
          for (const line of input.lines) {
            if (!line.salesOrderLineId) continue;
            await tx.salesOrderLine.update({
              where: { id: line.salesOrderLineId },
              data: { deliveredQuantity: { increment: line.quantity } },
            });
          }
          const refreshed = await tx.salesOrderLine.findMany({
            where: { salesOrderId: order.id },
            select: { quantity: true, deliveredQuantity: true },
          });
          const fullyDelivered = refreshed.every(
            (l) => Number(l.deliveredQuantity.toString()) >= Number(l.quantity.toString()) - 1e-9,
          );
          const anyDelivered = refreshed.some((l) => Number(l.deliveredQuantity.toString()) > 0);
          await tx.salesOrder.update({
            where: { id: order.id },
            data: {
              status: fullyDelivered
                ? 'DELIVERED'
                : anyDelivered
                  ? 'PARTIALLY_DELIVERED'
                  : order.status,
            },
          });
        }
        return created;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.delivery_posted',
      resourceType: 'delivery',
      resourceId: delivery.id,
      companyId: delivery.companyId,
      requestId,
      metadata: input.salesOrderId ? { salesOrderId: input.salesOrderId } : {},
    });
    return delivery;
  }

  async listDeliveries(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.DeliveryWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.delivery.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          customer: { select: { displayName: true } },
          warehouse: { select: { code: true, name: true } },
          lines: { select: { quantity: true } },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);
    return { rows, total };
  }

  // ---- Customer invoices --------------------------------------------------------

  async createCustomerInvoice(
    principal: Principal,
    input: CustomerInvoiceCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.companyId !== input.companyId) {
      throw new NotFoundError('Customer not found');
    }

    // Over-invoicing guard against ordered quantities when tied to an order.
    if (input.salesOrderId) {
      const order = await this.prisma.salesOrder.findUnique({
        where: { id: input.salesOrderId },
        include: { lines: true },
      });
      if (!order || order.companyId !== input.companyId) {
        throw new NotFoundError('Sales order not found');
      }
      const lineById = new Map(order.lines.map((l) => [l.id, l]));
      for (const line of input.lines) {
        if (!line.salesOrderLineId) continue;
        const soLine = lineById.get(line.salesOrderLineId);
        if (!soLine || soLine.salesOrderId !== order.id) {
          throw new BusinessRuleError('Invoice line references a line from another sales order');
        }
        const ordered = Number(soLine.quantity.toString());
        const already = Number(soLine.invoicedQuantity.toString());
        if (already + line.quantity > ordered + 1e-9) {
          throw new BusinessRuleError(
            `Invoice exceeds ordered quantity for line ${soLine.description}`,
          );
        }
      }
    }

    const invoice = await this.prisma.$transaction(
      async (tx) => {
        const invoiceNo = await this.numbering.nextDocumentNumber(
          tx,
          input.companyId,
          DOCUMENT_TYPES.CUSTOMER_INVOICE,
        );
        const lineTotals = input.lines.map((l) =>
          Money.fromDecimalString(l.unitPrice)
            .multiplyByFactor(l.quantity)
            .minus(Money.fromDecimalString(l.discount ?? '0')),
        );
        const subtotal = sumMoney(lineTotals);
        const taxTotal = sumMoney(
          input.lines.map((l) => Money.fromDecimalString(l.taxAmount ?? '0')),
        );
        const grandTotal = subtotal.plus(taxTotal);
        // Snapshot product/unit from the referenced sales-order line.
        const soLineById = input.salesOrderId
          ? new Map(
              (
                await tx.salesOrderLine.findMany({ where: { salesOrderId: input.salesOrderId } })
              ).map((l) => [l.id, l]),
            )
          : new Map();
        const created = await tx.customerInvoice.create({
          data: {
            companyId: input.companyId,
            branchId: input.branchId ?? null,
            invoiceNo,
            customerId: customer.id,
            salesOrderId: input.salesOrderId ?? null,
            deliveryId: input.deliveryId ?? null,
            invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
            dueDate: new Date(`${input.dueDate}T00:00:00Z`),
            currencyId: input.currencyId,
            subtotal: subtotal.toString(),
            discountTotal: sumMoney(
              input.lines.map((l) => Money.fromDecimalString(l.discount ?? '0')),
            ).toString(),
            taxTotal: taxTotal.toString(),
            grandTotal: grandTotal.toString(),
            status: 'DRAFT',
            createdById: principal.userId,
            lines: {
              create: input.lines.map((l, i) => {
                const soLine = l.salesOrderLineId ? soLineById.get(l.salesOrderLineId) : undefined;
                return {
                  salesOrderLineId: l.salesOrderLineId ?? null,
                  productId: l.productId ?? soLine?.productId ?? null,
                  description: l.description,
                  quantity: l.quantity,
                  unitId: l.unitId ?? soLine?.unitId ?? null,
                  unitPrice: Money.fromDecimalString(l.unitPrice).toString(),
                  discount: Money.fromDecimalString(l.discount ?? '0').toString(),
                  taxAmount: Money.fromDecimalString(l.taxAmount ?? '0').toString(),
                  lineTotal: (lineTotals[i] as Money).toString(),
                };
              }),
            },
          },
          include: { lines: true },
        });
        if (input.salesOrderId) {
          for (const line of input.lines) {
            if (!line.salesOrderLineId) continue;
            await tx.salesOrderLine.update({
              where: { id: line.salesOrderLineId },
              data: { invoicedQuantity: { increment: line.quantity } },
            });
          }
        }
        return created;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.invoice_created',
      resourceType: 'customer_invoice',
      resourceId: invoice.id,
      companyId: invoice.companyId,
      requestId,
    });
    return invoice;
  }

  async listCustomerInvoices(
    principal: Principal,
    query: { status?: string; page: number; pageSize: number },
  ) {
    const where: Prisma.CustomerInvoiceWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customerInvoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          customer: { select: { displayName: true } },
        },
      }),
      this.prisma.customerInvoice.count({ where }),
    ]);
    return { rows, total };
  }

  async getCustomerInvoice(principal: Principal, id: string) {
    const invoice = await this.prisma.customerInvoice.findUnique({
      where: { id },
      include: {
        customer: { select: { customerNo: true, displayName: true } },
        lines: true,
        allocations: true,
      },
    });
    if (!invoice) throw new NotFoundError('Invoice not found');
    this.scopeGuard(principal, invoice.companyId);
    return invoice;
  }

  /**
   * Posts a DRAFT/APPROVED invoice (USER-FLOWS §12.4): validates the open
   * period and emits the AR journal payload on the outbox for the accounting
   * slice (Stage 8 consumes it). Status stays POSTED until receipts pay it.
   */
  async postCustomerInvoice(principal: Principal, id: string, requestId: string | null) {
    const invoice = await this.prisma.customerInvoice.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundError('Invoice not found');
    this.scopeGuard(principal, invoice.companyId);
    if (!['DRAFT', 'APPROVED'].includes(invoice.status)) {
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
    const receivableAccount = await this.prisma.account.findFirst({
      where: { companyId: invoice.companyId, accountCode: '1200' },
    });
    const revenueAccount = await this.prisma.account.findFirst({
      where: { companyId: invoice.companyId, accountCode: '4000' },
    });
    if (!receivableAccount || !revenueAccount) {
      throw new BusinessRuleError('AR posting accounts missing from the chart of accounts');
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
        accountCode: receivableAccount.accountCode,
        accountId: receivableAccount.id,
        side: 'DEBIT',
        amount: grandTotal.toString(),
        description: `AR ${invoice.invoiceNo}`,
      },
      {
        accountCode: revenueAccount.accountCode,
        accountId: revenueAccount.id,
        side: 'CREDIT',
        amount: net.toString(),
        description: 'Sales revenue',
      },
    ];
    if (!taxTotal.isZero()) {
      lines.push({
        accountCode: revenueAccount.accountCode,
        accountId: revenueAccount.id,
        side: 'CREDIT',
        amount: taxTotal.toString(),
        description: 'Output tax',
      });
    }
    const debits = sumMoney(
      lines.filter((l) => l.side === 'DEBIT').map((l) => Money.fromDecimalString(l.amount)),
    );
    const credits = sumMoney(
      lines.filter((l) => l.side === 'CREDIT').map((l) => Money.fromDecimalString(l.amount)),
    );
    if (!debits.eq(credits)) throw new BusinessRuleError('AR journal does not balance');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.customerInvoice.update({
        where: { id },
        data: { status: 'POSTED', postingDate: new Date() },
      });
      await this.outbox.emit(
        {
          eventType: 'sales.customer_invoice.posted',
          aggregateType: 'customer_invoice',
          aggregateId: id,
          payload: {
            journal: {
              journalDate: invoice.invoiceDate.toISOString().slice(0, 10),
              currencyId: invoice.currencyId,
              sourceType: 'customer_invoice',
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
      action: 'sales.customer_invoice_posted',
      resourceType: 'customer_invoice',
      resourceId: id,
      companyId: invoice.companyId,
      requestId,
    });
    return updated;
  }

  // ---- Customer receipts ----------------------------------------------------------

  async createCustomerReceipt(
    principal: Principal,
    input: CustomerReceiptCreateInput,
    requestId: string | null,
  ) {
    this.scopeGuard(principal, input.companyId);
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.companyId !== input.companyId) {
      throw new NotFoundError('Customer not found');
    }
    const payment = await this.prisma.$transaction(
      async (tx) => {
        const receiptNo = await this.numbering.nextDocumentNumber(
          tx,
          input.companyId,
          DOCUMENT_TYPES.CUSTOMER_RECEIPT,
        );
        const allocatedTotal = sumMoney(
          input.allocations.map((a) => Money.fromDecimalString(a.amount)),
        );
        const created = await tx.customerReceipt.create({
          data: {
            companyId: input.companyId,
            branchId: input.branchId ?? null,
            customerId: customer.id,
            receiptNo,
            receiptDate: new Date(`${input.receiptDate}T00:00:00Z`),
            currencyId: input.currencyId,
            amount: allocatedTotal.toString(),
            method: input.method,
            bankAccountRef: input.bankAccountRef ?? null,
            reference: input.reference ?? null,
            status: 'POSTED',
            postedBy: principal.userId,
            postedAt: new Date(),
            allocations: {
              create: input.allocations.map((a) => ({
                invoiceId: a.invoiceId,
                allocatedAmount: Money.fromDecimalString(a.amount).toString(),
              })),
            },
          },
          include: { allocations: true },
        });
        // Apply allocations to invoices: POSTED -> PARTIALLY_PAID -> PAID.
        for (const allocation of created.allocations) {
          const invoice = await tx.customerInvoice.findUnique({
            where: { id: allocation.invoiceId },
          });
          if (!invoice || invoice.companyId !== input.companyId) {
            throw new BusinessRuleError('Allocation references an invoice from another company');
          }
          if (!['POSTED', 'PARTIALLY_PAID'].includes(invoice.status)) {
            throw new BusinessRuleError(
              `Invoice ${invoice.invoiceNo} is ${invoice.status.toLowerCase()}; not receivable`,
            );
          }
          const alreadyPaid = Money.fromDecimalString(invoice.paidAmount.toString());
          const allocating = Money.fromDecimalString(allocation.allocatedAmount.toString());
          const grandTotal = Money.fromDecimalString(invoice.grandTotal.toString());
          if (alreadyPaid.plus(allocating).gt(grandTotal)) {
            throw new BusinessRuleError(`Allocation overpays invoice ${invoice.invoiceNo}`);
          }
          const newPaid = alreadyPaid.plus(allocating);
          await tx.customerInvoice.update({
            where: { id: invoice.id },
            data: {
              paidAmount: newPaid.toString(),
              status: newPaid.eq(grandTotal) ? 'PAID' : 'PARTIALLY_PAID',
            },
          });
        }
        return created;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );

    await this.audit.record({
      actorUserId: principal.userId,
      action: 'sales.customer_receipt_posted',
      resourceType: 'customer_receipt',
      resourceId: payment.id,
      companyId: payment.companyId,
      requestId,
    });
    await this.outbox.emitAndWait(
      {
        eventType: 'sales.customer_receipt.posted',
        aggregateType: 'customer_receipt',
        aggregateId: payment.id,
        payload: {
          customerId: customer.id,
          amount: payment.amount.toString(),
          method: payment.method,
        },
      },
      this.prisma,
    );
    return payment;
  }

  async listCustomerReceipts(principal: Principal, query: { page: number; pageSize: number }) {
    const where: Prisma.CustomerReceiptWhereInput = {
      ...(principal.companyIds ? { companyId: { in: principal.companyIds } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customerReceipt.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { customer: { select: { displayName: true } } },
      }),
      this.prisma.customerReceipt.count({ where }),
    ]);
    return { rows, total };
  }
}
