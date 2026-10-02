import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { RequirePermissions, PermissionsGuard } from '../iam/permissions.guard.js';
import { JwtAuthGuard } from '../iam/jwt-auth.guard.js';
import { getRequestId } from '../common/api-envelope.interceptor.js';
import type { Request } from 'express';
import type { RequestPrincipal } from '../common/request-context.js';
import {
  unitCreateSchema,
  productCategoryCreateSchema,
  productCreateSchema,
  productUpdateSchema,
  stockTransferCreateSchema,
  stockAdjustmentCreateSchema,
  openingStockSchema,
} from '@erp/validation';

interface AuthedRequest extends Request {
  principal?: RequestPrincipal;
}

function requirePrincipal(req: AuthedRequest): RequestPrincipal {
  const principal = req.principal;
  if (!principal) {
    throw new Error('Authentication principal missing; auth guard misconfigured');
  }
  return principal;
}

function parsePagination(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const p = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const ps = Math.min(200, Math.max(1, Number.parseInt(pageSize ?? '50', 10) || 50));
  return { page: p, pageSize: ps };
}

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // ---- Units & categories -----------------------------------------------------

  @Post('units')
  @RequirePermissions('inventory.product.create')
  async createUnit(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = unitCreateSchema.parse(body);
    return this.inventory.createUnit(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('units')
  @RequirePermissions('inventory.product.view')
  async listUnits(@Query('companyId') companyId: string | undefined, @Req() req: AuthedRequest) {
    return this.inventory.listUnits(requirePrincipal(req), companyId ?? null);
  }

  @Post('categories')
  @RequirePermissions('inventory.product.create')
  async createCategory(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = productCategoryCreateSchema.parse(body);
    return this.inventory.createCategory(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('categories')
  @RequirePermissions('inventory.product.view')
  async listCategories(
    @Query('companyId') companyId: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.inventory.listCategories(requirePrincipal(req), companyId ?? null);
  }

  // ---- Products ---------------------------------------------------------------

  @Post('products')
  @RequirePermissions('inventory.product.create')
  async createProduct(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = productCreateSchema.parse(body);
    return this.inventory.createProduct(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('products')
  @RequirePermissions('inventory.product.view')
  async listProducts(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('search') search: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.inventory.listProducts(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      search,
      status,
    });
  }

  @Get('products/:id')
  @RequirePermissions('inventory.product.view')
  async getProduct(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.inventory.getProduct(requirePrincipal(req), id);
  }

  @Post('products/:id')
  @RequirePermissions('inventory.product.edit')
  async updateProduct(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = productUpdateSchema.parse(body);
    return this.inventory.updateProduct(requirePrincipal(req), id, input, getRequestId(req));
  }

  // ---- Opening stock ------------------------------------------------------------

  @Post('opening-stock')
  @RequirePermissions('inventory.stock_adjustment.create')
  async postOpeningStock(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = openingStockSchema.parse(body);
    return this.inventory.postOpeningStock(requirePrincipal(req), input, getRequestId(req));
  }

  // ---- Stock overview & ledger -----------------------------------------------------

  @Get('stock')
  @RequirePermissions('inventory.stock.view')
  async listStock(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.inventory.listStockBalances(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      warehouseId,
    });
  }

  @Get('movements')
  @RequirePermissions('inventory.stock.view')
  async listMovements(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('productId') productId: string | undefined,
    @Query('warehouseId') warehouseId: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.inventory.listMovements(requirePrincipal(req), {
      ...parsePagination(page, pageSize),
      productId,
      warehouseId,
    });
  }

  // ---- Transfers -----------------------------------------------------------------

  @Post('transfers')
  @RequirePermissions('inventory.stock_transfer.create')
  async createTransfer(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = stockTransferCreateSchema.parse(body);
    return this.inventory.createStockTransfer(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('transfers')
  @RequirePermissions('inventory.stock.view')
  async listTransfers(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.inventory.listStockTransfers(
      requirePrincipal(req),
      parsePagination(page, pageSize),
    );
  }

  // ---- Adjustments ------------------------------------------------------------------

  @Post('adjustments')
  @RequirePermissions('inventory.stock_adjustment.create')
  async createAdjustment(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = stockAdjustmentCreateSchema.parse(body);
    return this.inventory.createStockAdjustment(requirePrincipal(req), input, getRequestId(req));
  }

  @Get('adjustments')
  @RequirePermissions('inventory.stock.view')
  async listAdjustments(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.inventory.listStockAdjustments(
      requirePrincipal(req),
      parsePagination(page, pageSize),
    );
  }

  @Post('adjustments/:id/submit')
  @RequirePermissions('inventory.stock_adjustment.submit')
  async submitAdjustment(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.inventory.submitStockAdjustment(requirePrincipal(req), id, getRequestId(req));
  }

  @Post('adjustments/:id/post')
  @RequirePermissions('inventory.stock_adjustment.post')
  async postAdjustment(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.inventory.postStockAdjustment(requirePrincipal(req), id, getRequestId(req));
  }
}
