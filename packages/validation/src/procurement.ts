import { z } from 'zod';
import { dateOnlySchema, moneyStringSchema, uuidSchema } from './common.js';

// ---- Suppliers -------------------------------------------------------------

export const supplierCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  supplierNo: z.string().min(1).max(30).optional(),
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  taxNumber: z.string().max(60).optional(),
  registrationNumber: z.string().max(60).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(400).optional(),
  currencyId: uuidSchema,
  paymentTermsId: uuidSchema.nullish(),
  defaultPayableAccountId: uuidSchema.nullish(),
});

export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .omit({ companyId: true })
  .extend({ status: z.enum(['ACTIVE', 'ON_HOLD', 'BLACKLISTED', 'INACTIVE']).optional() });

export const supplierBankAccountSchema = z.object({
  supplierId: uuidSchema,
  bankName: z.string().min(1).max(120),
  accountName: z.string().min(1).max(120),
  accountNumber: z.string().min(1).max(60),
  routingRef: z.string().max(60).optional(),
  currencyId: uuidSchema,
  isDefault: z.boolean().default(false),
});

// ---- Purchase requests -----------------------------------------------------

export const purchaseRequestLineSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  estimatedUnitCost: moneyStringSchema.optional(),
  preferredSupplierId: uuidSchema.nullish(),
});

export const purchaseRequestCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  departmentId: uuidSchema.nullish(),
  requiredDate: dateOnlySchema,
  purpose: z.string().max(500).optional(),
  lines: z.array(purchaseRequestLineSchema).min(1, 'At least one line is required'),
});

export const purchaseRequestSubmitSchema = z.object({
  /** Amount override for threshold-based approval routing; defaults to estimated total. */
  amount: moneyStringSchema.optional(),
});

// ---- RFQs and quotations ---------------------------------------------------

export const rfqCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  purchaseRequestId: uuidSchema.nullish(),
  issueDate: dateOnlySchema,
  responseDueDate: dateOnlySchema,
  supplierIds: z.array(uuidSchema).min(1, 'Select at least one supplier'),
});

export const quotationLineSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: moneyStringSchema,
  taxAmount: moneyStringSchema.optional(),
});

export const quotationCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  supplierId: uuidSchema,
  rfqId: uuidSchema.nullish(),
  quotationDate: dateOnlySchema,
  validUntil: dateOnlySchema.nullish(),
  currencyId: uuidSchema,
  lines: z.array(quotationLineSchema).min(1, 'At least one line is required'),
});

export const quotationSelectSchema = z.object({ quotationId: uuidSchema });

// ---- Purchase orders -------------------------------------------------------

export const purchaseOrderLineSchema = z.object({
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: moneyStringSchema,
  discount: moneyStringSchema.optional(),
  taxAmount: moneyStringSchema.optional(),
});

export const purchaseOrderCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  departmentId: uuidSchema.nullish(),
  warehouseId: uuidSchema.nullish(),
  supplierId: uuidSchema,
  quotationId: uuidSchema.nullish(),
  orderDate: dateOnlySchema,
  expectedDate: dateOnlySchema.nullish(),
  lines: z.array(purchaseOrderLineSchema).min(1, 'At least one line is required'),
  /** Amount override for threshold-based approval routing; defaults to grand total. */
  amount: moneyStringSchema.optional(),
});

// ---- Goods receipts --------------------------------------------------------

export const goodsReceiptLineSchema = z.object({
  purchaseOrderLineId: uuidSchema,
  quantity: z.number().positive().max(1_000_000),
  batchNo: z.string().max(60).optional(),
  serialNo: z.string().max(60).optional(),
  unitCost: moneyStringSchema.optional(),
});

export const goodsReceiptCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  warehouseId: uuidSchema.nullish(),
  purchaseOrderId: uuidSchema,
  receiptDate: dateOnlySchema,
  lines: z.array(goodsReceiptLineSchema).min(1, 'At least one line is required'),
});

// ---- Supplier invoices and payments -----------------------------------------

export const invoiceLineSchema = z.object({
  purchaseOrderLineId: uuidSchema.nullish(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: moneyStringSchema,
  taxAmount: moneyStringSchema.optional(),
});

export const invoiceCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  supplierId: uuidSchema,
  supplierInvoiceNo: z.string().min(1).max(60),
  purchaseOrderId: uuidSchema.nullish(),
  goodsReceiptId: uuidSchema.nullish(),
  invoiceDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  lines: z.array(invoiceLineSchema).min(1, 'At least one line is required'),
});

export const paymentCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  supplierId: uuidSchema,
  paymentDate: dateOnlySchema,
  method: z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE']).default('BANK_TRANSFER'),
  bankAccountRef: z.string().max(120).optional(),
  reference: z.string().max(120).optional(),
  allocations: z
    .array(z.object({ supplierInvoiceId: uuidSchema, amount: moneyStringSchema }))
    .min(1, 'Allocate at least one invoice'),
});

export const procurementListSchema = z.object({
  status: z.string().max(40).optional(),
  supplierId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type PurchaseRequestCreateInput = z.infer<typeof purchaseRequestCreateSchema>;
export type RfqCreateInput = z.infer<typeof rfqCreateSchema>;
export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;
export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type GoodsReceiptCreateInput = z.infer<typeof goodsReceiptCreateSchema>;
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
