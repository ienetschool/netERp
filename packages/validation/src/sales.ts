import { z } from 'zod';
import { dateOnlySchema, moneyStringSchema, uuidSchema } from './common.js';

// ---- Customers ---------------------------------------------------------------

export const customerCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  customerNo: z.string().min(1).max(30).optional(),
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  taxNumber: z.string().max(60).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(400).optional(),
  currencyId: uuidSchema,
  paymentTermsId: uuidSchema.nullish(),
  creditLimit: moneyStringSchema.optional(),
  receivableAccountId: uuidSchema.nullish(),
});

export const customerUpdateSchema = customerCreateSchema
  .partial()
  .omit({ companyId: true })
  .extend({ status: z.enum(['ACTIVE', 'ON_HOLD', 'INACTIVE']).optional() });

// ---- Quotation lines (shared by quotations and orders) -----------------------

export const salesLineSchema = z.object({
  productId: uuidSchema.nullish(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unitId: uuidSchema.nullish(),
  unitPrice: moneyStringSchema,
  discount: moneyStringSchema.optional(),
  taxAmount: moneyStringSchema.optional(),
});

// ---- Sales quotations ----------------------------------------------------------

export const salesQuotationCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  customerId: uuidSchema,
  quotationDate: dateOnlySchema,
  validUntil: dateOnlySchema.nullish(),
  currencyId: uuidSchema,
  lines: z.array(salesLineSchema).min(1, 'At least one line is required'),
});

export const salesQuotationSubmitSchema = z.object({
  /** Amount override for threshold-based approval routing; defaults to grand total. */
  amount: moneyStringSchema.optional(),
});

// ---- Sales orders ---------------------------------------------------------------

export const salesOrderCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  warehouseId: uuidSchema.nullish(),
  customerId: uuidSchema,
  quotationId: uuidSchema.nullish(),
  orderDate: dateOnlySchema,
  requestedDeliveryDate: dateOnlySchema.nullish(),
  currencyId: uuidSchema,
  lines: z.array(salesLineSchema).min(1, 'At least one line is required'),
});

export const salesOrderSubmitSchema = z.object({
  /** Amount override for threshold-based approval routing; defaults to grand total. */
  amount: moneyStringSchema.optional(),
});

// ---- Deliveries -----------------------------------------------------------------

export const deliveryLineSchema = z.object({
  salesOrderLineId: uuidSchema.nullish(),
  productId: uuidSchema.nullish(),
  warehouseLocationId: uuidSchema.nullish(),
  quantity: z.number().positive().max(1_000_000),
  unitId: uuidSchema.nullish(),
  batchNo: z.string().max(60).optional(),
  serialNo: z.string().max(60).optional(),
});

export const deliveryCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  warehouseId: uuidSchema,
  customerId: uuidSchema,
  salesOrderId: uuidSchema.nullish(),
  deliveryDate: dateOnlySchema,
  lines: z.array(deliveryLineSchema).min(1, 'At least one line is required'),
});

// ---- Customer invoices -----------------------------------------------------------

export const customerInvoiceLineSchema = z.object({
  salesOrderLineId: uuidSchema.nullish(),
  productId: uuidSchema.nullish(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(1_000_000),
  unitId: uuidSchema.nullish(),
  unitPrice: moneyStringSchema,
  discount: moneyStringSchema.optional(),
  taxAmount: moneyStringSchema.optional(),
});

export const customerInvoiceCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  customerId: uuidSchema,
  salesOrderId: uuidSchema.nullish(),
  deliveryId: uuidSchema.nullish(),
  invoiceDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currencyId: uuidSchema,
  lines: z.array(customerInvoiceLineSchema).min(1, 'At least one line is required'),
});

// ---- Customer receipts -----------------------------------------------------------

export const receiptAllocationSchema = z.object({
  invoiceId: uuidSchema,
  amount: moneyStringSchema,
});

export const customerReceiptCreateSchema = z.object({
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
  customerId: uuidSchema,
  receiptDate: dateOnlySchema,
  currencyId: uuidSchema,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD', 'OTHER']),
  bankAccountRef: z.string().max(120).optional(),
  reference: z.string().max(200).optional(),
  allocations: z.array(receiptAllocationSchema).min(1, 'Allocate to at least one invoice'),
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type SalesQuotationCreateInput = z.infer<typeof salesQuotationCreateSchema>;
export type SalesOrderCreateInput = z.infer<typeof salesOrderCreateSchema>;
export type DeliveryCreateInput = z.infer<typeof deliveryCreateSchema>;
export type CustomerInvoiceCreateInput = z.infer<typeof customerInvoiceCreateSchema>;
export type CustomerReceiptCreateInput = z.infer<typeof customerReceiptCreateSchema>;
