import { Money, sumMoney } from '@erp/types';
import type { ReportFilters, ReportScheduleSpec } from '@erp/validation';
import { ReportRuleError } from './errors.js';

/**
 * Report engine (Stage 11; USER-FLOWS §21.1, DATA-MODEL §23).
 *
 * A report definition carries a declarative `queryDefinition`. The engine
 * interprets it against a fixed catalogue of sources — it NEVER builds or runs
 * SQL from caller input. A definition may only reference dimensions, metrics
 * and filters that its source declares, and the caller's filters are AND-ed
 * with the principal's company scope, so a caller cannot widen a report.
 *
 * This module is pure (no Prisma) so the rules are unit-testable; the DB-facing
 * half lives in reporting.service.ts.
 */

export const REPORT_SOURCES = [
  'JOURNAL_LINE',
  'CUSTOMER_INVOICE',
  'SUPPLIER_INVOICE',
  'SALES_ORDER',
  'PURCHASE_ORDER',
  'STOCK_BALANCE',
  'PAYROLL_RUN',
  'EMPLOYEE',
] as const;

export type ReportSource = (typeof REPORT_SOURCES)[number];

/** Hard cap on rows pulled from one source before aggregation. */
export const MAX_SOURCE_ROWS = 50_000;

export interface FieldSpec {
  /** Prisma select path, dotted for relations (e.g. "journal.companyId"). */
  path: string;
  label: string;
}

export interface MetricSpec extends FieldSpec {
  agg: 'SUM' | 'COUNT';
  /**
   * Computed as `left - right` from two real columns, for measures the schema
   * does not store (an invoice's outstanding amount is grandTotal - paidAmount).
   */
  derived?: { left: string; right: string };
}

export interface SourceSpec {
  source: ReportSource;
  delegate:
    | 'journalLine'
    | 'customerInvoice'
    | 'supplierInvoice'
    | 'salesOrder'
    | 'purchaseOrder'
    | 'stockBalance'
    | 'payrollRun'
    | 'employee';
  /** Fixed constraints every run inherits (e.g. posted journals only). */
  baseWhere: Record<string, unknown>;
  companyField: string;
  branchField?: string;
  departmentField?: string;
  warehouseField?: string;
  costCenterField?: string;
  customerField?: string;
  supplierField?: string;
  productField?: string;
  statusField?: string;
  dateField?: string;
  dimensions: Record<string, FieldSpec>;
  metrics: Record<string, MetricSpec>;
  defaultGrouping: string[];
  /** Columns shown when drilling into a group (UI-UX §21). */
  detailFields: FieldSpec[];
}

/**
 * The catalogue. Financial reports read POSTED accounting data only, as
 * UI-UX §21 requires ("authoritative posted accounting data").
 */
export const SOURCE_CATALOGUE: Record<ReportSource, SourceSpec> = {
  JOURNAL_LINE: {
    source: 'JOURNAL_LINE',
    delegate: 'journalLine',
    baseWhere: { journal: { status: 'POSTED' } },
    companyField: 'journal.companyId',
    branchField: 'journal.branchId',
    departmentField: 'departmentId',
    statusField: 'journal.sourceType',
    dateField: 'journal.journalDate',
    customerField: 'customerId',
    supplierField: 'supplierId',
    dimensions: {
      account: { path: 'account.accountCode', label: 'Account' },
      accountName: { path: 'account.accountName', label: 'Account name' },
      accountType: { path: 'account.accountType', label: 'Account type' },
      branch: { path: 'journal.branchId', label: 'Branch' },
      customer: { path: 'customerId', label: 'Customer' },
      supplier: { path: 'supplierId', label: 'Supplier' },
      department: { path: 'departmentId', label: 'Department' },
    },
    metrics: {
      debit: { path: 'debit', label: 'Debit', agg: 'SUM' },
      credit: { path: 'credit', label: 'Credit', agg: 'SUM' },
    },
    defaultGrouping: ['account'],
    detailFields: [
      { path: 'journal.journalNo', label: 'Journal' },
      { path: 'journal.journalDate', label: 'Date' },
      { path: 'account.accountCode', label: 'Account' },
      { path: 'description', label: 'Description' },
      { path: 'debit', label: 'Debit' },
      { path: 'credit', label: 'Credit' },
    ],
  },
  CUSTOMER_INVOICE: {
    source: 'CUSTOMER_INVOICE',
    delegate: 'customerInvoice',
    baseWhere: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    companyField: 'companyId',
    branchField: 'branchId',
    customerField: 'customerId',
    statusField: 'status',
    dateField: 'invoiceDate',
    dimensions: {
      customer: { path: 'customerId', label: 'Customer' },
      customerName: { path: 'customer.displayName', label: 'Customer name' },
      branch: { path: 'branchId', label: 'Branch' },
      status: { path: 'status', label: 'Status' },
      dueMonth: { path: 'dueDate', label: 'Due date' },
    },
    metrics: {
      grandTotal: { path: 'grandTotal', label: 'Invoiced', agg: 'SUM' },
      taxTotal: { path: 'taxTotal', label: 'Tax', agg: 'SUM' },
      balance: {
        path: 'grandTotal',
        label: 'Outstanding',
        agg: 'SUM',
        derived: { left: 'grandTotal', right: 'paidAmount' },
      },
      invoiceCount: { path: 'id', label: 'Invoices', agg: 'COUNT' },
    },
    defaultGrouping: ['customerName'],
    detailFields: [
      { path: 'invoiceNo', label: 'Invoice' },
      { path: 'invoiceDate', label: 'Date' },
      { path: 'dueDate', label: 'Due' },
      { path: 'status', label: 'Status' },
      { path: 'grandTotal', label: 'Invoiced' },
      { path: 'paidAmount', label: 'Paid' },
    ],
  },
  SUPPLIER_INVOICE: {
    source: 'SUPPLIER_INVOICE',
    delegate: 'supplierInvoice',
    baseWhere: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    companyField: 'companyId',
    branchField: 'branchId',
    supplierField: 'supplierId',
    statusField: 'status',
    dateField: 'invoiceDate',
    dimensions: {
      supplier: { path: 'supplierId', label: 'Supplier' },
      supplierName: { path: 'supplier.displayName', label: 'Supplier name' },
      branch: { path: 'branchId', label: 'Branch' },
      status: { path: 'status', label: 'Status' },
    },
    metrics: {
      grandTotal: { path: 'grandTotal', label: 'Invoiced', agg: 'SUM' },
      taxTotal: { path: 'taxTotal', label: 'Tax', agg: 'SUM' },
      balance: {
        path: 'grandTotal',
        label: 'Outstanding',
        agg: 'SUM',
        derived: { left: 'grandTotal', right: 'paidAmount' },
      },
      invoiceCount: { path: 'id', label: 'Invoices', agg: 'COUNT' },
    },
    defaultGrouping: ['supplierName'],
    detailFields: [
      { path: 'supplierInvoiceNo', label: 'Supplier invoice' },
      { path: 'invoiceDate', label: 'Date' },
      { path: 'status', label: 'Status' },
      { path: 'grandTotal', label: 'Invoiced' },
      { path: 'paidAmount', label: 'Paid' },
    ],
  },
  SALES_ORDER: {
    source: 'SALES_ORDER',
    delegate: 'salesOrder',
    baseWhere: {},
    companyField: 'companyId',
    branchField: 'branchId',
    warehouseField: 'warehouseId',
    customerField: 'customerId',
    statusField: 'status',
    dateField: 'orderDate',
    dimensions: {
      customer: { path: 'customerId', label: 'Customer' },
      customerName: { path: 'customer.displayName', label: 'Customer name' },
      branch: { path: 'branchId', label: 'Branch' },
      warehouse: { path: 'warehouseId', label: 'Warehouse' },
      status: { path: 'status', label: 'Status' },
    },
    metrics: {
      grandTotal: { path: 'grandTotal', label: 'Order value', agg: 'SUM' },
      taxTotal: { path: 'taxTotal', label: 'Tax', agg: 'SUM' },
      discountTotal: { path: 'discountTotal', label: 'Discount', agg: 'SUM' },
      orderCount: { path: 'id', label: 'Orders', agg: 'COUNT' },
    },
    defaultGrouping: ['customerName'],
    detailFields: [
      { path: 'orderNo', label: 'Order' },
      { path: 'orderDate', label: 'Date' },
      { path: 'status', label: 'Status' },
      { path: 'grandTotal', label: 'Order value' },
    ],
  },
  PURCHASE_ORDER: {
    source: 'PURCHASE_ORDER',
    delegate: 'purchaseOrder',
    baseWhere: {},
    companyField: 'companyId',
    branchField: 'branchId',
    departmentField: 'departmentId',
    warehouseField: 'warehouseId',
    supplierField: 'supplierId',
    statusField: 'status',
    dateField: 'orderDate',
    dimensions: {
      supplier: { path: 'supplierId', label: 'Supplier' },
      supplierName: { path: 'supplier.displayName', label: 'Supplier name' },
      branch: { path: 'branchId', label: 'Branch' },
      department: { path: 'departmentId', label: 'Department' },
      warehouse: { path: 'warehouseId', label: 'Warehouse' },
      status: { path: 'status', label: 'Status' },
    },
    metrics: {
      grandTotal: { path: 'grandTotal', label: 'Order value', agg: 'SUM' },
      taxTotal: { path: 'taxTotal', label: 'Tax', agg: 'SUM' },
      orderCount: { path: 'id', label: 'Orders', agg: 'COUNT' },
    },
    defaultGrouping: ['supplierName'],
    detailFields: [
      { path: 'poNo', label: 'PO' },
      { path: 'orderDate', label: 'Date' },
      { path: 'status', label: 'Status' },
      { path: 'grandTotal', label: 'Order value' },
    ],
  },
  STOCK_BALANCE: {
    source: 'STOCK_BALANCE',
    delegate: 'stockBalance',
    baseWhere: {},
    companyField: 'companyId',
    warehouseField: 'warehouseId',
    productField: 'productId',
    dimensions: {
      product: { path: 'productId', label: 'Product' },
      productName: { path: 'product.name', label: 'Product name' },
      warehouse: { path: 'warehouseId', label: 'Warehouse' },
      category: { path: 'product.categoryId', label: 'Category' },
    },
    metrics: {
      onHand: { path: 'onHand', label: 'On hand', agg: 'SUM' },
      reserved: { path: 'reserved', label: 'Reserved', agg: 'SUM' },
      avgCost: { path: 'avgCost', label: 'Avg cost', agg: 'SUM' },
      balanceCount: { path: 'id', label: 'Lines', agg: 'COUNT' },
    },
    defaultGrouping: ['productName'],
    detailFields: [
      { path: 'productId', label: 'Product' },
      { path: 'warehouseId', label: 'Warehouse' },
      { path: 'onHand', label: 'On hand' },
      { path: 'reserved', label: 'Reserved' },
      { path: 'avgCost', label: 'Avg cost' },
    ],
  },
  PAYROLL_RUN: {
    source: 'PAYROLL_RUN',
    delegate: 'payrollRun',
    baseWhere: {},
    companyField: 'companyId',
    branchField: 'branchId',
    statusField: 'status',
    dateField: 'paymentDate',
    dimensions: {
      branch: { path: 'branchId', label: 'Branch' },
      status: { path: 'status', label: 'Status' },
      payGroup: { path: 'payGroupId', label: 'Pay group' },
    },
    metrics: {
      totalGross: { path: 'totalGross', label: 'Gross', agg: 'SUM' },
      totalDeductions: { path: 'totalDeductions', label: 'Deductions', agg: 'SUM' },
      totalNet: { path: 'totalNet', label: 'Net', agg: 'SUM' },
      employeeCount: { path: 'employeeCount', label: 'Employees', agg: 'SUM' },
      runCount: { path: 'id', label: 'Runs', agg: 'COUNT' },
    },
    defaultGrouping: ['branch'],
    detailFields: [
      { path: 'runNo', label: 'Run' },
      { path: 'paymentDate', label: 'Pay date' },
      { path: 'status', label: 'Status' },
      { path: 'totalGross', label: 'Gross' },
      { path: 'totalNet', label: 'Net' },
    ],
  },
  EMPLOYEE: {
    source: 'EMPLOYEE',
    delegate: 'employee',
    baseWhere: {},
    companyField: 'companyId',
    branchField: 'branchId',
    departmentField: 'departmentId',
    statusField: 'employmentStatus',
    dateField: 'hireDate',
    dimensions: {
      branch: { path: 'branchId', label: 'Branch' },
      department: { path: 'departmentId', label: 'Department' },
      status: { path: 'employmentStatus', label: 'Employment status' },
      jobTitle: { path: 'jobTitle', label: 'Job title' },
    },
    metrics: {
      headcount: { path: 'id', label: 'Employees', agg: 'COUNT' },
    },
    defaultGrouping: ['department'],
    detailFields: [
      { path: 'employeeNo', label: 'Employee' },
      { path: 'displayName', label: 'Name' },
      { path: 'hireDate', label: 'Hired' },
      { path: 'employmentStatus', label: 'Status' },
    ],
  },
};

export interface ReportQueryDefinition {
  source: ReportSource;
  metrics: string[];
  dimensions: string[];
  defaultGrouping: string[];
  defaultSorting?: { field: string; direction: 'asc' | 'desc' };
}

export interface AggregatedRow {
  group: Record<string, string>;
  metrics: Record<string, string>;
}

export interface AggregateResult {
  rows: AggregatedRow[];
  totals: Record<string, string>;
  sourceRowCount: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Definition validation
// ---------------------------------------------------------------------------

/**
 * Validates a stored query definition against its source. A definition that
 * names an unknown source, dimension or metric is rejected outright rather
 * than silently ignored, so a bad definition fails loudly at run time.
 */
export function validateQueryDefinition(spec: unknown): ReportQueryDefinition {
  if (typeof spec !== 'object' || spec === null) {
    throw new ReportRuleError('Report query definition must be an object');
  }
  const candidate = spec as Partial<ReportQueryDefinition>;
  const source = candidate.source;
  if (!source || !(source in SOURCE_CATALOGUE)) {
    throw new ReportRuleError(`Unknown report source: ${String(source)}`);
  }
  const catalogue = SOURCE_CATALOGUE[source];

  const metrics = requireStringArray(candidate.metrics, 'metrics');
  const dimensions = requireStringArray(candidate.dimensions, 'dimensions');
  if (metrics.length === 0) {
    throw new ReportRuleError('Report definition must declare at least one metric');
  }
  for (const metric of metrics) {
    if (!catalogue.metrics[metric]) {
      throw new ReportRuleError(`Unknown metric "${metric}" for source ${source}`);
    }
  }
  for (const dimension of dimensions) {
    if (!catalogue.dimensions[dimension]) {
      throw new ReportRuleError(`Unknown dimension "${dimension}" for source ${source}`);
    }
  }

  const defaultGrouping = requireStringArray(candidate.defaultGrouping, 'defaultGrouping');
  for (const dimension of defaultGrouping) {
    if (!dimensions.includes(dimension)) {
      throw new ReportRuleError(
        `Default grouping "${dimension}" is not among the report dimensions`,
      );
    }
  }

  let defaultSorting: { field: string; direction: 'asc' | 'desc' } | undefined;
  // The stored definition is JSON of unknown shape, so narrow it explicitly.
  const rawSorting = candidate.defaultSorting as
    { field?: unknown; direction?: unknown } | null | undefined;
  if (rawSorting !== undefined && rawSorting !== null) {
    const field = typeof rawSorting.field === 'string' ? rawSorting.field : '';
    const direction = rawSorting.direction;
    if (!metrics.includes(field) && !dimensions.includes(field)) {
      throw new ReportRuleError(`Default sorting field "${field}" is not part of the report`);
    }
    if (direction !== 'asc' && direction !== 'desc') {
      throw new ReportRuleError('Default sorting direction must be asc or desc');
    }
    defaultSorting = { field, direction: direction };
  }

  return {
    source: source,
    metrics,
    dimensions,
    defaultGrouping,
    ...(defaultSorting ? { defaultSorting } : {}),
  };
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ReportRuleError(`Report definition "${label}" must be an array of strings`);
  }
  return value as string[];
}

// ---------------------------------------------------------------------------
// Filters -> Prisma where
// ---------------------------------------------------------------------------

/** Writes a value at a dotted path, creating intermediate objects. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) throw new ReportRuleError('Empty field path');
  let cursor = target;
  for (const key of parts.slice(0, -1)) {
    const existing = cursor[key];
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last !== undefined) cursor[last] = value;
}

/** The filter keys a source can honour, derived from the fields it declares. */
export function supportedFilters(source: SourceSpec): string[] {
  const keys: Array<[string, string | undefined]> = [
    ['companyId', source.companyField],
    ['branchId', source.branchField],
    ['departmentId', source.departmentField],
    ['warehouseId', source.warehouseField],
    ['costCenterId', source.costCenterField],
    ['customerId', source.customerField],
    ['supplierId', source.supplierField],
    ['productId', source.productField],
    ['status', source.statusField],
  ];
  const supported = keys.filter(([, field]) => field !== undefined).map(([key]) => key);
  if (source.dateField) supported.push('from', 'to');
  return supported;
}

/**
 * Builds the Prisma where clause: the source's fixed constraints, the
 * principal's company scope, and only the caller's supported filters.
 *
 * `companyScope` is the principal's scope: an array restricts the report to
 * those companies, and `null` means platform scope (every company), which
 * leaves the company field unconstrained rather than matching nothing.
 */
export function buildWhere(
  spec: ReportQueryDefinition,
  filters: ReportFilters | undefined,
  companyScope: string[] | null,
): Record<string, unknown> {
  const source = SOURCE_CATALOGUE[spec.source];
  const where = structuredClone(source.baseWhere);

  // Scope first: it is never overridable by caller input.
  if (companyScope) setPath(where, source.companyField, { in: companyScope });
  else if (filters?.companyId) setPath(where, source.companyField, filters.companyId);

  if (!filters) return where;

  const allowed = new Set(supportedFilters(source));
  for (const [key, raw] of Object.entries(filters) as Array<[string, string | undefined]>) {
    if (raw === undefined) continue;
    // The scope clause above is authoritative. Applying a caller-supplied
    // companyId here would overwrite it and let a caller read another
    // company's rows, so it is consumed above and never re-applied.
    if (key === 'companyId') continue;
    if (key === 'from' || key === 'to') {
      const dateField = source.dateField;
      if (!dateField) throw new ReportRuleError(`Report does not support ${key}`);
      const date = new Date(`${raw}T${key === 'from' ? '00:00:00' : '23:59:59'}Z`);
      const existing = readPath(where, dateField);
      const range = (typeof existing === 'object' && existing !== null ? existing : {}) as Record<
        string,
        unknown
      >;
      setPath(where, dateField, { ...range, [key === 'from' ? 'gte' : 'lte']: date });
      continue;
    }
    if (!allowed.has(key)) {
      throw new ReportRuleError(`Report does not support the "${key}" filter`);
    }
    const field = filterFieldFor(source, key);
    setPath(where, field, raw);
  }
  return where;
}

function filterFieldFor(source: SourceSpec, key: string): string {
  const map: Record<string, string | undefined> = {
    companyId: source.companyField,
    branchId: source.branchField,
    departmentId: source.departmentField,
    warehouseId: source.warehouseField,
    costCenterId: source.costCenterField,
    customerId: source.customerField,
    supplierId: source.supplierField,
    productId: source.productField,
    status: source.statusField,
  };
  const field = map[key];
  if (!field) throw new ReportRuleError(`Report does not support the "${key}" filter`);
  return field;
}

function readPath(target: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        typeof acc === 'object' && acc !== null ? (acc as Record<string, unknown>)[key] : undefined,
      target,
    );
}

/**
 * Builds the Prisma `select` for a validated definition — exactly the columns
 * the report needs, never `select: *`.
 *
 * Prisma requires nested relation selections to use the explicit
 * `{ select: { ... } }` shape; the shorthand `{ relation: { field: true } }` is
 * rejected at runtime with "Unknown argument". Every dotted segment except the
 * last is therefore wrapped, which is also correct because a multi-segment
 * path always crosses a relation.
 */
export function buildSelect(
  source: SourceSpec,
  spec: ReportQueryDefinition,
  options: { includeDetailFields?: boolean } = {},
): Record<string, unknown> {
  const select: Record<string, unknown> = {};
  const add = (path: string): void => {
    const parts = path.split('.').filter((part) => part.length > 0);
    let cursor = select;
    for (const key of parts.slice(0, -1)) {
      const existing = cursor[key];
      if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
        cursor[key] = { select: {} };
      }
      cursor = (cursor[key] as { select: Record<string, unknown> }).select;
    }
    const last = parts[parts.length - 1];
    if (last !== undefined) cursor[last] = true;
  };

  for (const dimension of spec.dimensions) {
    const path = source.dimensions[dimension]?.path;
    if (path) add(path);
  }
  for (const metric of spec.metrics) {
    const metricSpec = source.metrics[metric];
    if (!metricSpec) continue;
    if (metricSpec.path) add(metricSpec.path);
    // A derived measure needs both operands in the result set.
    if (metricSpec.derived) {
      add(metricSpec.derived.left);
      add(metricSpec.derived.right);
    }
  }
  // Drill-down reads source.detailFields, so those columns must be fetched
  // too or every detail cell renders blank.
  if (options.includeDetailFields) {
    for (const field of source.detailFields) add(field.path);
  }
  return select;
}

/** Flattens a selected row so dotted select paths can be read by name. */
export function flattenRow(row: Record<string, unknown>, paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const value = readPath(row, path);
    out[path] = formatCell(value);
  }
  return out;
}

interface DecimalLike {
  toFixed(): string;
}

function isDecimalLike(value: unknown): value is DecimalLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DecimalLike).toFixed === 'function'
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return value.toString();
  // Prisma Decimal: toFixed() gives exact plain notation (no exponent form).
  if (isDecimalLike(value)) return value.toFixed();
  return '';
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Dimension and metric lookups. Definitions are validated before a run, so a
 * miss here is a programming error rather than user input — surface it loudly
 * instead of indexing into undefined.
 */
function dimensionSpec(source: SourceSpec, dimension: string): FieldSpec {
  const spec = source.dimensions[dimension];
  if (!spec)
    throw new ReportRuleError(`Unknown dimension "${dimension}" for source ${source.source}`);
  return spec;
}

function dimensionPath(source: SourceSpec, dimension: string): string {
  return dimensionSpec(source, dimension).path;
}

function metricSpec(source: SourceSpec, metric: string): MetricSpec {
  const spec = source.metrics[metric];
  if (!spec) throw new ReportRuleError(`Unknown metric "${metric}" for source ${source.source}`);
  return spec;
}

/**
 * Groups source rows by the requested dimensions and sums the metrics with
 * exact money arithmetic (never floats).
 */
export function aggregate(
  spec: ReportQueryDefinition,
  rows: Array<Record<string, unknown>>,
  options: { grouping: string[]; sorting?: { field: string; direction: 'asc' | 'desc' } | null },
): AggregateResult {
  const source = SOURCE_CATALOGUE[spec.source];
  const grouping = resolveGrouping(spec, options.grouping);

  for (const dimension of grouping) {
    if (!spec.dimensions.includes(dimension)) {
      throw new ReportRuleError(`"${dimension}" is not a dimension of this report`);
    }
  }

  const dimensionPaths = grouping.map((dimension) => dimensionPath(source, dimension));
  const metricEntries = spec.metrics.map((name) => {
    const entry = { name, spec: metricSpec(source, name) };
    // Every column a metric reads, including a derived measure's operands.
    const paths = [entry.spec.path];
    if (entry.spec.derived) paths.push(entry.spec.derived.left, entry.spec.derived.right);
    return { ...entry, paths };
  });
  const allMetricPaths = metricEntries.flatMap((m) => m.paths);

  const buckets = new Map<
    string,
    { group: Record<string, string>; values: Map<string, Money>; count: Map<string, number> }
  >();

  for (const row of rows) {
    const flat = flattenRow(row, [...dimensionPaths, ...allMetricPaths]);
    const group: Record<string, string> = {};
    for (const dimension of grouping) {
      const path = dimensionPath(source, dimension);
      group[dimension] = flat[path] ?? '';
    }
    const key = grouping.map((d) => group[d]).join('\u0000');

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { group, values: new Map(), count: new Map() };
      buckets.set(key, bucket);
    }
    for (const metric of metricEntries) {
      if (metric.spec.agg === 'COUNT') {
        bucket.count.set(metric.name, (bucket.count.get(metric.name) ?? 0) + 1);
        continue;
      }
      const current = bucket.values.get(metric.name) ?? Money.zero();
      bucket.values.set(metric.name, current.plus(metricValue(flat, metric)));
    }
  }

  const aggregated: AggregatedRow[] = [...buckets.values()].map((bucket) => {
    const metrics: Record<string, string> = {};
    for (const metric of metricEntries) {
      metrics[metric.name] =
        metric.spec.agg === 'COUNT'
          ? String(bucket.count.get(metric.name) ?? 0)
          : (bucket.values.get(metric.name) ?? Money.zero()).toString();
    }
    return { group: bucket.group, metrics };
  });

  const totals: Record<string, string> = {};
  for (const metric of metricEntries) {
    totals[metric.name] =
      metric.spec.agg === 'COUNT'
        ? String(rows.length)
        : sumMoney(
            rows.map((row) => metricValue(flattenRow(row, metric.paths), metric)),
          ).toString();
  }

  const sort = resolveSorting(spec, options.sorting);
  sortAggregated(aggregated, sort, spec);

  return {
    rows: aggregated,
    totals,
    sourceRowCount: rows.length,
    truncated: false,
  };
}

/** The exact money value of one metric on one row (derived or plain column). */
function metricValue(
  flat: Record<string, string>,
  metric: { spec: MetricSpec; paths: string[] },
): Money {
  if (metric.spec.derived) {
    const left = Money.fromDecimalString(flat[metric.spec.derived.left] || '0');
    const right = Money.fromDecimalString(flat[metric.spec.derived.right] || '0');
    return left.minus(right);
  }
  return Money.fromDecimalString(flat[metric.spec.path] || '0');
}

/**
 * A caller-supplied sort field must belong to the report. Silently sorting on
 * nothing would hand back rows in an arbitrary order that looks intentional.
 */
function resolveSorting(
  spec: ReportQueryDefinition,
  requested: { field: string; direction: 'asc' | 'desc' } | null | undefined,
): { field: string; direction: 'asc' | 'desc' } | null {
  const sort = requested ?? spec.defaultSorting ?? null;
  if (!sort) return null;
  if (!spec.metrics.includes(sort.field) && !spec.dimensions.includes(sort.field)) {
    throw new ReportRuleError(`Cannot sort by "${sort.field}": it is not a column of this report`);
  }
  return sort;
}

function resolveGrouping(spec: ReportQueryDefinition, requested: string[]): string[] {
  if (requested.length > 0) return requested;
  if (spec.defaultGrouping.length > 0) return spec.defaultGrouping;
  return spec.dimensions;
}

function sortAggregated(
  rows: AggregatedRow[],
  sorting: { field: string; direction: 'asc' | 'desc' } | null,
  spec: ReportQueryDefinition,
): void {
  if (!sorting) {
    rows.sort((a, b) => compareGroupKeys(a, b, spec));
    return;
  }
  const factor = sorting.direction === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const left = a.metrics[sorting.field] ?? a.group[sorting.field] ?? '';
    const right = b.metrics[sorting.field] ?? b.group[sorting.field] ?? '';
    const numericA = Number(left);
    const numericB = Number(right);
    if (!Number.isNaN(numericA) && !Number.isNaN(numericB) && left !== '' && right !== '') {
      return (numericA - numericB) * factor;
    }
    return left.localeCompare(right) * factor;
  });
}

function compareGroupKeys(a: AggregatedRow, b: AggregatedRow, spec: ReportQueryDefinition): number {
  for (const dimension of spec.dimensions) {
    const left = a.group[dimension] ?? '';
    const right = b.group[dimension] ?? '';
    if (left !== right) return left.localeCompare(right);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** RFC 4180 CSV with a header row; formulas are neutralised on export. */
export function toCsv(columns: string[], rows: AggregatedRow[]): string {
  const escape = (value: string): string => {
    const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escape(row.group[column] ?? row.metrics[column] ?? '')).join(','),
  );
  return [header, ...body].join('\r\n');
}

export function columnLabels(spec: ReportQueryDefinition, grouping: string[]): string[] {
  const source = SOURCE_CATALOGUE[spec.source];
  const resolved = resolveGrouping(spec, grouping);
  return [
    ...resolved.map((dimension) => dimensionSpec(source, dimension).label),
    ...spec.metrics.map((metric) => metricSpec(source, metric).label),
  ];
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Minutes offset of `timeZone` from UTC at the given instant. */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return (asUtc - date.getTime()) / 60000;
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new ReportRuleError(`Unknown time zone: ${timeZone}`);
  }
}

/**
 * Next occurrence of a structured schedule, evaluated in the schedule's own
 * time zone. Returns a UTC instant.
 */
export function nextRunAt(
  schedule: ReportScheduleSpec,
  timeZone: string,
  from: Date = new Date(),
): Date {
  assertValidTimeZone(timeZone);
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number];

  const localNow = new Date(from.getTime() + timeZoneOffsetMinutes(from, timeZone) * 60000);
  const startYear = localNow.getUTCFullYear();
  const startMonth = localNow.getUTCMonth();
  const startDay = localNow.getUTCDate();

  for (let dayOffset = 0; dayOffset <= 400; dayOffset += 1) {
    const candidateLocal = new Date(
      Date.UTC(startYear, startMonth, startDay + dayOffset, hour, minute, 0, 0),
    );
    if (!matchesSchedule(schedule, candidateLocal)) continue;
    if (candidateLocal.getTime() <= localNow.getTime()) continue;
    // Convert the local wall-clock candidate back to UTC, correcting the offset
    // once (DST transitions can move it).
    let instant = new Date(
      candidateLocal.getTime() - timeZoneOffsetMinutes(from, timeZone) * 60000,
    );
    instant = new Date(candidateLocal.getTime() - timeZoneOffsetMinutes(instant, timeZone) * 60000);
    return instant;
  }
  throw new ReportRuleError('Could not resolve the next run for this schedule');
}

function matchesSchedule(schedule: ReportScheduleSpec, candidateLocal: Date): boolean {
  switch (schedule.frequency) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return candidateLocal.getUTCDay() === schedule.dayOfWeek;
    case 'MONTHLY':
      return (
        candidateLocal.getUTCDate() === Math.min(schedule.dayOfMonth ?? 1, 31) &&
        candidateLocal.getUTCDate() <=
          daysInMonth(candidateLocal.getUTCFullYear(), candidateLocal.getUTCMonth())
      );
    default:
      return false;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
