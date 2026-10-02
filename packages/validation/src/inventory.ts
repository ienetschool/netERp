import { z } from 'zod';
import { dateOnlySchema, moneyStringSchema, uuidSchema } from './common.js';

// ---- Units of measure --------------------------------------------------------

export const unitCreateSchema = z.object({
  companyId: uuidSchema,
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(80),
  symbol: z.string().min(1).max(10),
  precision: z.number().int().min(0).max(6).default(2),
});

// ---- Product categories ------------------------------------------------------

export const productCategoryCreateSchema = z.object({
  companyId: uuidSchema,
  parentCategoryId: uuidSchema.nullish(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
});

// ---- Products ----------------------------------------------------------------

export const productTypeSchema = z.enum(['STOCK', 'SERVICE', 'NON_STOCK', 'ASSET']);

export const productCreateSchema = z.object({
  companyId: uuidSchema,
  sku: z.string().min(1).max(40),
  barcode: z.string().min(1).max(60).optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  categoryId: uuidSchema.nullish(),
  productType: productTypeSchema.default('STOCK'),
  baseUnitId: uuidSchema.nullish(),
  trackBatch: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  inventoryItem: z.boolean().default(true),
  saleable: z.boolean().default(true),
  purchasable: z.boolean().default(true),
  standardCost: moneyStringSchema.default('0'),
  reorderLevel: moneyStringSchema.default('0'),
  reorderQty: moneyStringSchema.default('0'),
});

export const productUpdateSchema = productCreateSchema.partial().omit({ companyId: true });

// ---- Stock transfers ----------------------------------------------------------

export const stockTransferCreateSchema = z.object({
  companyId: uuidSchema,
  fromWarehouseId: uuidSchema,
  toWarehouseId: uuidSchema,
  transferDate: dateOnlySchema.optional(),
  reason: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: uuidSchema,
        quantity: moneyStringSchema,
      }),
    )
    .min(1),
});

// ---- Stock adjustments ---------------------------------------------------------

export const stockAdjustmentCreateSchema = z.object({
  companyId: uuidSchema,
  warehouseId: uuidSchema,
  reason: z.string().min(1).max(500),
  lines: z
    .array(
      z.object({
        productId: uuidSchema,
        countedQuantity: moneyStringSchema,
        unitCost: moneyStringSchema.optional(),
      }),
    )
    .min(1),
});

// ---- Opening stock (per warehouse/location, used by seed and by direct intake) --

export const openingStockLineSchema = z.object({
  productId: uuidSchema,
  warehouseId: uuidSchema,
  warehouseLocationId: uuidSchema.nullish(),
  quantity: moneyStringSchema,
  unitCost: moneyStringSchema.optional(),
});

export const openingStockSchema = z.object({
  companyId: uuidSchema,
  movementDate: dateOnlySchema.optional(),
  lines: z.array(openingStockLineSchema).min(1),
});
