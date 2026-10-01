import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { RequirePermissions } from '../iam/permissions.guard.js';
import { ProcurementService } from './procurement.service.js';
import { NotFoundError, ValidationError } from '../common/errors.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  supplierBankAccountSchema,
  purchaseRequestCreateSchema,
  purchaseRequestSubmitSchema,
  rfqCreateSchema,
  quotationCreateSchema,
  quotationSelectSchema,
  purchaseOrderCreateSchema,
  goodsReceiptCreateSchema,
  invoiceCreateSchema,
  paymentCreateSchema,
  procurementListSchema,
} from '@erp/validation';
import type { ZodTypeAny, z } from 'zod';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

type Principal = RequestPrincipal & { isSuperAdmin?: boolean };

function requirePrincipal(req: AuthedRequest): Principal {
  if (!req.principal) throw new NotFoundError('Principal missing');
  return req.principal;
}

function parseOrThrow<T extends ZodTypeAny>(schema: T, body: unknown, label: string): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`Invalid ${label}`, {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

/**
 * Procurement endpoints (PRD Stage 5): procure-to-pay.
 */
@Controller('procurement')
@UseGuards(JwtAuthGuard)
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  // ---- Suppliers -----------------------------------------------------------

  @Post('suppliers')
  @RequirePermissions('procurement.supplier.create')
  async createSupplier(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(supplierCreateSchema, body, 'supplier');
    return { data: await this.procurement.createSupplier(principal, input, getRequestId(req)) };
  }

  @Get('suppliers')
  @RequirePermissions('procurement.supplier.view')
  async listSuppliers(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = procurementListSchema.safeParse({ page: page ?? 1, pageSize: pageSize ?? 25 });
    if (!parsed.success) throw new ValidationError('Invalid pagination');
    return {
      data: await this.procurement.listSuppliers(principal, {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }

  @Post('suppliers/:id')
  @RequirePermissions('procurement.supplier.edit')
  async updateSupplier(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(supplierUpdateSchema, body, 'supplier update');
    return { data: await this.procurement.updateSupplier(principal, id, input, getRequestId(req)) };
  }

  @Post('suppliers/:id/bank-accounts')
  @RequirePermissions('procurement.supplier.edit', 'procurement.supplier.view')
  async addBankAccount(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const principal = requirePrincipal(req);
    const parsed = supplierBankAccountSchema.safeParse({
      ...(body ?? {}),
      supplierId: id,
    });
    if (!parsed.success) {
      throw new ValidationError('Invalid bank account', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (parsed.data.supplierId !== id) throw new ValidationError('supplierId mismatch');
    return {
      data: await this.procurement.addBankAccount(principal, parsed.data, getRequestId(req)),
    };
  }

  // ---- Purchase requests -----------------------------------------------------

  @Post('purchase-requests')
  @RequirePermissions('procurement.purchase_request.create')
  async createPurchaseRequest(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(purchaseRequestCreateSchema, body, 'purchase request');
    return {
      data: await this.procurement.createPurchaseRequest(principal, input, getRequestId(req)),
    };
  }

  @Get('purchase-requests')
  @RequirePermissions('procurement.purchase_request.view')
  async listPurchaseRequests(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = procurementListSchema.safeParse({
      status,
      page: page ?? 1,
      pageSize: pageSize ?? 25,
    });
    if (!parsed.success) throw new ValidationError('Invalid query');
    return {
      data: await this.procurement.listPurchaseRequests(principal, {
        status: parsed.data.status,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }

  @Post('purchase-requests/:id/submit')
  @RequirePermissions('procurement.purchase_request.submit')
  async submitPurchaseRequest(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = purchaseRequestSubmitSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid submit request');
    return {
      data: await this.procurement.submitPurchaseRequest(
        principal,
        id,
        parsed.data.amount,
        getRequestId(req),
      ),
    };
  }

  // ---- RFQs and quotations -----------------------------------------------------

  @Post('rfqs')
  @RequirePermissions('procurement.rfq.create')
  async createRfq(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(rfqCreateSchema, body, 'RFQ');
    return { data: await this.procurement.createRfq(principal, input, getRequestId(req)) };
  }

  @Get('rfqs')
  @RequirePermissions('procurement.rfq.view')
  async listRfqs(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = procurementListSchema.safeParse({ page: page ?? 1, pageSize: pageSize ?? 25 });
    if (!parsed.success) throw new ValidationError('Invalid pagination');
    return {
      data: await this.procurement.listRfqs(principal, {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }

  @Post('quotations')
  @RequirePermissions('procurement.quotation.create')
  async createQuotation(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(quotationCreateSchema, body, 'quotation');
    return { data: await this.procurement.createQuotation(principal, input, getRequestId(req)) };
  }

  @Post('quotations/select')
  @RequirePermissions('procurement.quotation.edit')
  async selectQuotation(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = quotationSelectSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid quotation selection');
    return {
      data: await this.procurement.selectQuotation(
        principal,
        parsed.data.quotationId,
        getRequestId(req),
      ),
    };
  }

  // ---- Purchase orders ---------------------------------------------------------

  @Post('purchase-orders')
  @RequirePermissions('procurement.purchase_order.create')
  async createPurchaseOrder(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(purchaseOrderCreateSchema, body, 'purchase order');
    return {
      data: await this.procurement.createPurchaseOrder(principal, input, getRequestId(req)),
    };
  }

  @Get('purchase-orders')
  @RequirePermissions('procurement.purchase_order.view')
  async listPurchaseOrders(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = procurementListSchema.safeParse({
      status,
      page: page ?? 1,
      pageSize: pageSize ?? 25,
    });
    if (!parsed.success) throw new ValidationError('Invalid query');
    return {
      data: await this.procurement.listPurchaseOrders(principal, {
        status: parsed.data.status,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }

  @Get('purchase-orders/:id')
  @RequirePermissions('procurement.purchase_order.view')
  async getPurchaseOrder(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    return { data: await this.procurement.getPurchaseOrder(requirePrincipal(req), id) };
  }

  @Post('purchase-orders/:id/submit')
  @RequirePermissions('procurement.purchase_order.submit')
  async submitPurchaseOrder(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = purchaseRequestSubmitSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid submit request');
    return {
      data: await this.procurement.submitPurchaseOrder(
        principal,
        id,
        parsed.data.amount,
        getRequestId(req),
      ),
    };
  }

  // ---- Goods receipts -------------------------------------------------------------

  @Post('goods-receipts')
  @RequirePermissions('procurement.goods_receipt.create')
  async createGoodsReceipt(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(goodsReceiptCreateSchema, body, 'goods receipt');
    return {
      data: await this.procurement.createGoodsReceipt(principal, input, getRequestId(req)),
    };
  }

  // ---- Supplier invoices -------------------------------------------------------------

  @Post('invoices')
  @RequirePermissions('procurement.supplier_invoice.create')
  async createSupplierInvoice(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(invoiceCreateSchema, body, 'supplier invoice');
    return {
      data: await this.procurement.createSupplierInvoice(principal, input, getRequestId(req)),
    };
  }

  @Get('invoices')
  @RequirePermissions('procurement.supplier_invoice.view')
  async listSupplierInvoices(
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = procurementListSchema.safeParse({
      status,
      page: page ?? 1,
      pageSize: pageSize ?? 25,
    });
    if (!parsed.success) throw new ValidationError('Invalid query');
    return {
      data: await this.procurement.listSupplierInvoices(principal, {
        status: parsed.data.status,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }

  @Post('invoices/:id/post')
  @RequirePermissions('procurement.supplier_invoice.post')
  async postSupplierInvoice(@Param('id') id: string, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    return {
      data: await this.procurement.postSupplierInvoice(principal, id, getRequestId(req)),
    };
  }

  // ---- Supplier payments ---------------------------------------------------------------

  @Post('payments')
  @RequirePermissions('procurement.supplier_payment.create')
  async createSupplierPayment(@Body() body: unknown, @Req() req: AuthedRequest): Promise<unknown> {
    const principal = requirePrincipal(req);
    const input = parseOrThrow(paymentCreateSchema, body, 'supplier payment');
    return {
      data: await this.procurement.createSupplierPayment(principal, input, getRequestId(req)),
    };
  }

  @Get('payments')
  @RequirePermissions('procurement.supplier_payment.view')
  async listSupplierPayments(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<unknown> {
    const principal = requirePrincipal(req);
    const parsed = procurementListSchema.safeParse({ page: page ?? 1, pageSize: pageSize ?? 25 });
    if (!parsed.success) throw new ValidationError('Invalid pagination');
    return {
      data: await this.procurement.listSupplierPayments(principal, {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      }),
    };
  }
}
