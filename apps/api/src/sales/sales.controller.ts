import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SalesService } from './sales.service.js';
import { RequirePermissions, PermissionsGuard } from '../iam/permissions.guard.js';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { NotFoundError } from '../common/errors.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import {
  customerCreateSchema,
  customerUpdateSchema,
  salesQuotationCreateSchema,
  salesOrderCreateSchema,
  deliveryCreateSchema,
  customerInvoiceCreateSchema,
  customerReceiptCreateSchema,
} from '@erp/validation';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal & { isSuperAdmin?: boolean };
}

function requirePrincipal(req: AuthedRequest): RequestPrincipal & { isSuperAdmin?: boolean } {
  if (!req.principal) throw new NotFoundError('Principal missing');
  return req.principal;
}

function parsePagination(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize ?? '50', 10) || 50));
  return { page: p, pageSize: ps };
}

/**
 * Sales endpoints (PRD Stage 7): quote to cash.
 */
@Controller('sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // ---- Customers -----------------------------------------------------------

  @Post('customers')
  @RequirePermissions('sales.customer.create')
  async createCustomer(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = customerCreateSchema.parse(body);
    return this.sales.createCustomer(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('customers')
  @RequirePermissions('sales.customer.view')
  async listCustomers(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.sales.listCustomers(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    });
  }

  @Post('customers/:id')
  @RequirePermissions('sales.customer.edit')
  async updateCustomer(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = customerUpdateSchema.parse(body);
    return this.sales.updateCustomer(requirePrincipal(req), id, input, getRequestId(req));
  }

  // ---- Quotations ----------------------------------------------------------

  @Post('quotations')
  @RequirePermissions('sales.quotation.create')
  async createQuotation(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = salesQuotationCreateSchema.parse(body);
    return this.sales.createSalesQuotation(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('quotations')
  @RequirePermissions('sales.quotation.view')
  async listQuotations(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.sales.listSalesQuotations(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
    });
  }

  @Get('quotations/:id')
  @RequirePermissions('sales.quotation.view')
  async getQuotation(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.sales.getSalesQuotation(requirePrincipal(req), id);
  }

  @Post('quotations/:id/submit')
  @RequirePermissions('sales.quotation.submit')
  async submitQuotation(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const amount = (body as { amount?: string } | null)?.amount;
    return this.sales.submitSalesQuotation(requirePrincipal(req), id, amount, getRequestId(req));
  }

  // ---- Sales orders ------------------------------------------------------------

  @Post('orders')
  @RequirePermissions('sales.sales_order.create')
  async createOrder(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = salesOrderCreateSchema.parse(body);
    return this.sales.createSalesOrder(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('orders')
  @RequirePermissions('sales.sales_order.view')
  async listOrders(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.sales.listSalesOrders(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
    });
  }

  @Get('orders/:id')
  @RequirePermissions('sales.sales_order.view')
  async getOrder(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.sales.getSalesOrder(requirePrincipal(req), id);
  }

  @Post('orders/:id/submit')
  @RequirePermissions('sales.sales_order.submit')
  async submitOrder(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const amount = (body as { amount?: string } | null)?.amount;
    return this.sales.submitSalesOrder(requirePrincipal(req), id, amount, getRequestId(req));
  }

  // ---- Deliveries ----------------------------------------------------------------

  @Post('deliveries')
  @RequirePermissions('sales.delivery.create')
  async createDelivery(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = deliveryCreateSchema.parse(body);
    return this.sales.createDelivery(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('deliveries')
  @RequirePermissions('sales.delivery.view')
  async listDeliveries(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.sales.listDeliveries(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
    });
  }

  // ---- Invoices --------------------------------------------------------------------

  @Post('invoices')
  @RequirePermissions('sales.invoice.create')
  async createInvoice(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = customerInvoiceCreateSchema.parse(body);
    return this.sales.createCustomerInvoice(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('invoices')
  @RequirePermissions('sales.invoice.view')
  async listInvoices(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.sales.listCustomerInvoices(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      ...(status ? { status } : {}),
    });
  }

  @Get('invoices/:id')
  @RequirePermissions('sales.invoice.view')
  async getInvoice(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.sales.getCustomerInvoice(requirePrincipal(req), id);
  }

  @Post('invoices/:id/post')
  @RequirePermissions('sales.invoice.post')
  async postInvoice(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.sales.postCustomerInvoice(requirePrincipal(req), id, getRequestId(req));
  }

  // ---- Receipts -----------------------------------------------------------------------

  @Post('receipts')
  @RequirePermissions('sales.receipt.create')
  async createReceipt(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = customerReceiptCreateSchema.parse(body);
    return this.sales.createCustomerReceipt(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('receipts')
  @RequirePermissions('sales.receipt.view')
  async listReceipts(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.sales.listCustomerReceipts(requirePrincipal(req), parsePagination(page, pageSize));
  }
}
