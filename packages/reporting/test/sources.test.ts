import { describe, expect, it } from 'vitest';
import { SOURCE_CATALOGUE, buildSelect, validateQueryDefinition } from '../src/index.js';
import type { ReportSource } from '../src/index.js';

/**
 * The catalogue names Prisma fields. A typo compiles cleanly, type-checks
 * (the engine types paths as strings) and only fails when a user runs that
 * report — as it did for `customer.customerName` and `journal.departmentId`.
 * These assertions pin the names that were wrong.
 *
 * Field names verified against prisma/schema.prisma; the live-database
 * execution check lives in scripts/verify-reporting-flow.mjs.
 */
const MODEL_FIELDS: Record<string, Set<string>> = {
  Account: new Set(['id', 'companyId', 'accountCode', 'accountName', 'accountType', 'normalBalance']),
  Customer: new Set(['id', 'companyId', 'displayName', 'customerNo']),
  Supplier: new Set(['id', 'companyId', 'displayName', 'supplierNo']),
  Product: new Set(['id', 'sku', 'name', 'categoryId']),
  JournalEntry: new Set([
    'id',
    'companyId',
    'branchId',
    'journalNo',
    'journalType',
    'journalDate',
    'status',
    'sourceType',
  ]),
  JournalLine: new Set([
    'id',
    'journalId',
    'accountId',
    'description',
    'debit',
    'credit',
    'customerId',
    'supplierId',
    'departmentId',
    'costCenterId',
  ]),
  CustomerInvoice: new Set([
    'id',
    'companyId',
    'branchId',
    'invoiceNo',
    'customerId',
    'invoiceDate',
    'dueDate',
    'grandTotal',
    'taxTotal',
    'paidAmount',
    'status',
  ]),
  SupplierInvoice: new Set([
    'id',
    'companyId',
    'branchId',
    'supplierInvoiceNo',
    'supplierId',
    'invoiceDate',
    'dueDate',
    'grandTotal',
    'taxTotal',
    'paidAmount',
    'status',
  ]),
  SalesOrder: new Set([
    'id',
    'companyId',
    'branchId',
    'warehouseId',
    'orderNo',
    'customerId',
    'orderDate',
    'grandTotal',
    'taxTotal',
    'discountTotal',
    'status',
  ]),
  PurchaseOrder: new Set([
    'id',
    'companyId',
    'branchId',
    'departmentId',
    'warehouseId',
    'poNo',
    'supplierId',
    'orderDate',
    'grandTotal',
    'taxTotal',
    'status',
  ]),
  StockBalance: new Set(['id', 'companyId', 'warehouseId', 'productId', 'onHand', 'reserved', 'avgCost']),
  PayrollRun: new Set([
    'id',
    'companyId',
    'branchId',
    'runNo',
    'paymentDate',
    'payGroupId',
    'status',
    'totalGross',
    'totalDeductions',
    'totalNet',
    'employeeCount',
  ]),
  Employee: new Set([
    'id',
    'companyId',
    'branchId',
    'departmentId',
    'employeeNo',
    'displayName',
    'jobTitle',
    'hireDate',
    'employmentStatus',
  ]),
};

const DELEGATE_MODEL: Record<string, string> = {
  journalLine: 'JournalLine',
  customerInvoice: 'CustomerInvoice',
  supplierInvoice: 'SupplierInvoice',
  salesOrder: 'SalesOrder',
  purchaseOrder: 'PurchaseOrder',
  stockBalance: 'StockBalance',
  payrollRun: 'PayrollRun',
  employee: 'Employee',
};

/** Fields declared on a nested relation of a model, when one applies. */
const RELATION_MODEL: Record<string, string> = {
  account: 'Account',
  customer: 'Customer',
  supplier: 'Supplier',
  product: 'Product',
  journal: 'JournalEntry',
};

describe('SOURCE_CATALOGUE field names', () => {
  for (const source of Object.values(SOURCE_CATALOGUE)) {
    it(`${source.source} names only real Prisma fields`, () => {
      const own = MODEL_FIELDS[DELEGATE_MODEL[source.delegate] ?? ''];
      expect(own, `no model map for delegate ${source.delegate}`).toBeDefined();

      const paths: string[] = [
        ...Object.values(source.dimensions).map((d) => d.path),
        ...Object.values(source.metrics).map((m) => m.path),
        ...source.detailFields.map((f) => f.path),
      ];
      for (const metric of Object.values(source.metrics)) {
        if (metric.derived) paths.push(metric.derived.left, metric.derived.right);
      }

      for (const path of paths) {
        const [head, ...rest] = path.split('.');
        if (rest.length === 0) {
          expect(own.has(head), `${source.source}: "${path}" is not a field of ${DELEGATE_MODEL[source.delegate]}`).toBe(true);
          continue;
        }
        const relation = RELATION_MODEL[head ?? ''];
        expect(relation, `${source.source}: unknown relation "${head}"`).toBeDefined();
        const nested = MODEL_FIELDS[relation ?? ''];
        expect(nested?.has(rest[0] ?? ''), `${source.source}: "${path}" is not a field of ${relation}`).toBe(true);
      }
    });

    it(`${source.source} scope fields are real`, () => {
      for (const field of [
        source.companyField,
        source.branchField,
        source.departmentField,
        source.warehouseField,
        source.costCenterField,
        source.customerField,
        source.supplierField,
        source.productField,
        source.statusField,
        source.dateField,
      ]) {
        if (!field) continue;
        const [head, ...rest] = field.split('.');
        const model = rest.length > 0 ? RELATION_MODEL[head ?? ''] : DELEGATE_MODEL[source.delegate];
        const known = rest.length > 0 ? MODEL_FIELDS[model ?? ''] : MODEL_FIELDS[DELEGATE_MODEL[source.delegate] ?? ''];
        expect(known?.has(rest.length > 0 ? rest[0] ?? '' : head ?? ''), `${source.source}: scope field "${field}"`).toBe(true);
      }
    });
  }

  it('derives invoice outstanding instead of reading a column that does not exist', () => {
    for (const key of ['CUSTOMER_INVOICE', 'SUPPLIER_INVOICE'] as ReportSource[]) {
      const metric = SOURCE_CATALOGUE[key].metrics['balance'];
      expect(metric?.derived).toEqual({ left: 'grandTotal', right: 'paidAmount' });
    }
  });

  it('pulls both operands of a derived metric into the select', () => {
    const source = SOURCE_CATALOGUE.CUSTOMER_INVOICE;
    const spec = validateQueryDefinition({
      source: 'CUSTOMER_INVOICE',
      metrics: ['balance'],
      dimensions: ['customer'],
      defaultGrouping: ['customer'],
    });
    const select = buildSelect(source, spec);
    expect(select).toMatchObject({ grandTotal: true, paidAmount: true });
  });

  it('never defaults a grouping to a raw foreign key when a label exists', () => {
    // A default grouping is the first thing a user sees. If it resolves to a
    // bare `*Id` column the report opens showing UUIDs; the readable
    // counterpart must be used instead.
    const offenders: string[] = [];
    for (const source of Object.values(SOURCE_CATALOGUE)) {
      for (const dimension of source.defaultGrouping) {
        const path = source.dimensions[dimension]?.path;
        if (!path) continue;
        const isForeignKey = /Id$/.test(path);
        const hasLabel = source.dimensions[`${dimension}Name`] !== undefined;
        if (isForeignKey && hasLabel) offenders.push(`${source.source}.${dimension} -> ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every default grouping resolvable to a real column', () => {
    const offenders: string[] = [];
    for (const source of Object.values(SOURCE_CATALOGUE)) {
      for (const dimension of source.defaultGrouping) {
        if (!source.dimensions[dimension]) offenders.push(`${source.source}.${dimension}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});