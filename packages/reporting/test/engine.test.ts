import { describe, expect, it } from 'vitest';
import {
  REPORT_SOURCES,
  SOURCE_CATALOGUE,
  aggregate,
  buildSelect,
  buildWhere,
  columnLabels,
  flattenRow,
  isReportRuleError,
  nextRunAt,
  setPath,
  supportedFilters,
  timeZoneOffsetMinutes,
  toCsv,
  validateQueryDefinition,
} from '../src/index.js';

const trialBalance = {
  source: 'JOURNAL_LINE',
  metrics: ['debit', 'credit'],
  dimensions: ['account', 'accountType'],
  defaultGrouping: ['accountType'],
};

/** A journal line as the engine sees it after `select`. */
function journalLine(accountCode: string, accountType: string, debit: string, credit: string) {
  return {
    debit,
    credit,
    customerId: null,
    supplierId: null,
    description: `line ${accountCode}`,
    journal: { journalNo: 'JE-1', journalDate: new Date('2026-03-01T00:00:00Z'), companyId: 'c1' },
    account: { accountCode, accountName: `Account ${accountCode}`, accountType },
  };
}

describe('validateQueryDefinition', () => {
  it('accepts a well-formed definition', () => {
    const spec = validateQueryDefinition(trialBalance);
    expect(spec.source).toBe('JOURNAL_LINE');
    expect(spec.metrics).toEqual(['debit', 'credit']);
    expect(spec.defaultGrouping).toEqual(['accountType']);
  });

  it('rejects unknown sources, metrics and dimensions', () => {
    expect(() => validateQueryDefinition({ ...trialBalance, source: 'RAW_SQL' })).toThrow(
      /Unknown report source/,
    );
    expect(() => validateQueryDefinition({ ...trialBalance, metrics: ['netWorth'] })).toThrow(
      /Unknown metric/,
    );
    expect(() => validateQueryDefinition({ ...trialBalance, dimensions: ['phaseOfMoon'] })).toThrow(
      /Unknown dimension/,
    );
  });

  it('requires at least one metric', () => {
    expect(() => validateQueryDefinition({ ...trialBalance, metrics: [] })).toThrow(
      /at least one metric/,
    );
  });

  it('requires default grouping to be among the declared dimensions', () => {
    expect(() =>
      validateQueryDefinition({ ...trialBalance, defaultGrouping: ['branch'] }),
    ).toThrow(/not among the report dimensions/);
  });

  it('rejects default sorting that points outside the report', () => {
    expect(() =>
      validateQueryDefinition({ ...trialBalance, defaultSorting: { field: 'secret', direction: 'asc' } }),
    ).toThrow(/not part of the report/);
    expect(() =>
      validateQueryDefinition({ ...trialBalance, defaultSorting: { field: 'debit', direction: 'sideways' } }),
    ).toThrow(/asc or desc/);
  });

  it('rejects non-object definitions', () => {
    expect(() => validateQueryDefinition('SELECT * FROM journal_line')).toThrow(/must be an object/);
    expect(() => validateQueryDefinition(null)).toThrow(/must be an object/);
  });

  it('raises the package-local rule error, never a framework error', () => {
    try {
      validateQueryDefinition({ source: 'NOPE' });
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect(isReportRuleError(error)).toBe(true);
    }
  });

  it('covers every declared source in the catalogue', () => {
    for (const source of REPORT_SOURCES) {
      const spec = SOURCE_CATALOGUE[source];
      expect(Object.keys(spec.metrics).length).toBeGreaterThan(0);
      expect(Object.keys(spec.dimensions).length).toBeGreaterThan(0);
    }
  });

  it('constrains financial sources to posted data', () => {
    const posted = JSON.stringify(SOURCE_CATALOGUE.JOURNAL_LINE.baseWhere);
    expect(posted).toContain('POSTED');
  });
});

describe('buildWhere', () => {
  const spec = validateQueryDefinition(trialBalance);

  // Scope is a two-way contract: a scoped principal must be confined to its
  // own companies, and a platform-scoped principal (null = every company) must
  // not be narrowed to nothing. Both directions are load-bearing.
  it('confines a scoped principal to its own companies', () => {
    const where = buildWhere(spec, undefined, ['c1', 'c2']);
    expect(where['journal']).toMatchObject({ companyId: { in: ['c1', 'c2'] } });
  });

  it('does not let caller input widen a scoped principal', () => {
    const where = buildWhere(spec, { companyId: 'attacker-company' }, ['c1', 'c2']);
    expect(where['journal']).toMatchObject({ companyId: { in: ['c1', 'c2'] } });
  });

  it('leaves the company field unconstrained for a platform-scoped principal', () => {
    // null means "every company". An empty `in: []` here would silently return
    // zero rows for every super-admin report.
    const where = buildWhere(spec, undefined, null);
    expect(where['journal']).toEqual({ status: 'POSTED' });
  });

  it('narrows a platform-scoped principal only to the company they asked for', () => {
    const where = buildWhere(spec, { companyId: 'c9' }, null);
    expect(where['journal']).toMatchObject({ companyId: 'c9' });
  });

  it('reads posted-only journals even without filters', () => {
    const where = buildWhere(spec, undefined, ['c1']);
    expect(where['journal']).toMatchObject({ status: 'POSTED' });
  });

  it('applies only filters the source supports', () => {
    const where = buildWhere(spec, { branchId: 'b1', status: 'SALES' }, ['c1']);
    expect(where['journal']).toMatchObject({ branchId: 'b1', sourceType: 'SALES' });
  });

  it('rejects an unsupported filter instead of ignoring it', () => {
    expect(() => buildWhere(spec, { productId: 'p1' }, ['c1'])).toThrow(
      /does not support the "productId"/,
    );
  });

  it('turns from/to into an inclusive range', () => {
    const where = buildWhere(spec, { from: '2026-01-01', to: '2026-03-31' }, ['c1']) as {
      journal: { journalDate: { gte: Date; lte: Date } };
    };
    expect(where.journal.journalDate.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(where.journal.journalDate.lte.toISOString()).toBe('2026-03-31T23:59:59.000Z');
  });

  it('rejects date filters on a source without a date field', () => {
    const stockSpec = validateQueryDefinition({
      source: 'STOCK_BALANCE',
      metrics: ['onHand'],
      dimensions: ['product'],
      defaultGrouping: ['product'],
    });
    expect(() => buildWhere(stockSpec, { from: '2026-01-01' }, ['c1'])).toThrow(/does not support from/);
    expect(supportedFilters(SOURCE_CATALOGUE.STOCK_BALANCE)).not.toContain('from');
  });

  it('never emits a raw operator from caller input', () => {
    const where = buildWhere(spec, { status: 'POSTED' }, ['c1']);
    expect(JSON.stringify(where)).not.toContain('$where');
    expect(JSON.stringify(where)).not.toContain('OR');
  });
});

describe('buildSelect', () => {
  const spec = validateQueryDefinition(trialBalance);

  it('selects exactly the declared columns, never select: *', () => {
    const select = buildSelect(SOURCE_CATALOGUE.JOURNAL_LINE, spec);
    expect(Object.keys(select).sort()).toEqual(['account', 'credit', 'debit']);
    expect(Object.values(select)).not.toContain('*');
  });

  it('wraps nested relations in the explicit select shape Prisma requires', () => {
    // The shorthand `{ account: { accountCode: true } }` is rejected at
    // runtime with "Unknown argument"; relations must use `{ select: {...} }`.
    const select = buildSelect(SOURCE_CATALOGUE.JOURNAL_LINE, spec);
    // Only the declared dimensions are pulled; `accountName` is not part of
    // this report, so it must not appear.
    expect(select['account']).toEqual({
      select: { accountCode: true, accountType: true },
    });
    expect(select['debit']).toBe(true);
  });

  it('never emits the shorthand relation form', () => {
    for (const source of Object.values(SOURCE_CATALOGUE)) {
      const built = buildSelect(source, {
        source: source.source,
        metrics: Object.keys(source.metrics),
        dimensions: Object.keys(source.dimensions),
        defaultGrouping: source.defaultGrouping,
      });
      const walk = (node: Record<string, unknown>): void => {
        for (const value of Object.values(node)) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
          expect(Object.keys(value as Record<string, unknown>)).toContain('select');
          walk((value as { select: Record<string, unknown> }).select);
        }
      };
      walk(built);
    }
  });

  it('omits detail columns by default and adds them on request', () => {
    // Drill-down renders source.detailFields; if they are not selected every
    // detail cell comes back blank.
    const without = buildSelect(SOURCE_CATALOGUE.CUSTOMER_INVOICE, {
      source: 'CUSTOMER_INVOICE',
      metrics: ['invoiceCount'],
      dimensions: ['customer'],
      defaultGrouping: ['customer'],
    });
    expect(without['invoiceNo']).toBeUndefined();
    const withDetail = buildSelect(
      SOURCE_CATALOGUE.CUSTOMER_INVOICE,
      {
        source: 'CUSTOMER_INVOICE',
        metrics: ['invoiceCount'],
        dimensions: ['customer'],
        defaultGrouping: ['customer'],
      },
      { includeDetailFields: true },
    );
    expect(withDetail['invoiceNo']).toBe(true);
    expect(withDetail['dueDate']).toBe(true);
  });

  it('reads through the same shape it selects', () => {
    // The select shape and the row shape must agree or every cell reads empty.
    const select = buildSelect(SOURCE_CATALOGUE.JOURNAL_LINE, spec);
    const row = {
      debit: '1.00',
      credit: '0',
      account: { accountCode: '1000', accountName: 'Cash', accountType: 'ASSET' },
    };
    const accountPaths = Object.keys(
      (select['account'] as { select: Record<string, unknown> }).select,
    ).map((field) => `account.${field}`);
    expect(flattenRow(row, accountPaths)['account.accountCode']).toBe('1000');
    expect(flattenRow(row, accountPaths)['account.accountType']).toBe('ASSET');
  });
});

describe('setPath', () => {
  it('creates intermediate objects for dotted paths', () => {
    const target: Record<string, unknown> = {};
    setPath(target, 'journal.company.id', 'c1');
    expect(target).toEqual({ journal: { company: { id: 'c1' } } });
  });

  it('rejects an empty path', () => {
    expect(() => setPath({}, '', 'x')).toThrow(/Empty field path/);
  });
});

describe('aggregate', () => {
  const spec = validateQueryDefinition(trialBalance);
  const rows = [
    journalLine('1000', 'ASSET', '100.10', '0'),
    journalLine('1000', 'ASSET', '50.20', '0'),
    journalLine('2000', 'LIABILITY', '0', '75.30'),
  ];

  it('groups and sums with exact money arithmetic', () => {
    const result = aggregate(spec, rows, { grouping: ['accountType'] });
    const byType = Object.fromEntries(result.rows.map((r) => [r.group['accountType'], r.metrics]));
    expect(byType['ASSET']?.['debit']).toBe('150.30');
    expect(byType['LIABILITY']?.['credit']).toBe('75.30');
  });

  it('computes totals across every source row', () => {
    const result = aggregate(spec, rows, { grouping: ['accountType'] });
    expect(result.totals['debit']).toBe('150.30');
    expect(result.totals['credit']).toBe('75.30');
    expect(result.sourceRowCount).toBe(3);
  });

  it('counts rather than sums for COUNT metrics', () => {
    const headcount = validateQueryDefinition({
      source: 'EMPLOYEE',
      metrics: ['headcount'],
      dimensions: ['department'],
      defaultGrouping: ['department'],
    });
    const result = aggregate(
      headcount,
      [
        { id: '1', employeeNo: 'E1', displayName: 'A', hireDate: new Date('2020-01-01'), employmentStatus: 'ACTIVE', branchId: 'b1', departmentId: 'd1', jobTitle: 'Analyst' },
        { id: '2', employeeNo: 'E2', displayName: 'B', hireDate: new Date('2021-01-01'), employmentStatus: 'ACTIVE', branchId: 'b1', departmentId: 'd1', jobTitle: 'Analyst' },
        { id: '3', employeeNo: 'E3', displayName: 'C', hireDate: new Date('2022-01-01'), employmentStatus: 'ACTIVE', branchId: 'b1', departmentId: 'd2', jobTitle: 'Analyst' },
      ],
      { grouping: ['department'] },
    );
    const byDept = Object.fromEntries(result.rows.map((r) => [r.group['department'], r.metrics['headcount']]));
    expect(byDept).toEqual({ d1: '2', d2: '1' });
    expect(result.totals['headcount']).toBe('3');
  });

  it('falls back to the definition default grouping', () => {
    const result = aggregate(spec, rows, { grouping: [] });
    expect(result.rows.map((r) => r.group['accountType']).sort()).toEqual(['ASSET', 'LIABILITY']);
  });

  it('rejects sorting on a field the report does not expose', () => {
    // Silently ignoring an unknown sort would return rows in an arbitrary
    // order that looks like a deliberate ranking.
    expect(() =>
      aggregate(spec, rows, { grouping: ['accountType'], sorting: { field: 'notAColumn', direction: 'asc' } }),
    ).toThrow(/Cannot sort by "notAColumn"/);
  });

  it('accepts sorting by a declared metric or dimension', () => {
    expect(
      aggregate(spec, rows, { grouping: ['accountType'], sorting: { field: 'debit', direction: 'asc' } })
        .rows.length,
    ).toBe(2);
    expect(
      aggregate(spec, rows, {
        grouping: ['accountType'],
        sorting: { field: 'accountType', direction: 'asc' },
      }).rows.length,
    ).toBe(2);
  });

  it('rejects grouping on a dimension the report does not declare', () => {
    expect(() => aggregate(spec, rows, { grouping: ['branch'] })).toThrow(/not a dimension/);
  });

  it('sorts numerically when a metric sort is requested', () => {
    const result = aggregate(spec, rows, {
      grouping: ['accountType'],
      sorting: { field: 'debit', direction: 'desc' },
    });
    expect(result.rows[0]?.metrics['debit']).toBe('150.30');
  });

  it('treats missing values as zero rather than dropping the row', () => {
    const result = aggregate(spec, [journalLine('1000', 'ASSET', '', '')], { grouping: ['accountType'] });
    expect(result.rows[0]?.metrics['debit']).toBe('0.00');
  });
});

describe('toCsv', () => {
  const spec = validateQueryDefinition(trialBalance);

  it('writes a header row and RFC 4180 quoting', () => {
    const csv = toCsv(['accountType', 'debit'], [
      { group: { accountType: 'ASSET' }, metrics: { debit: '150.30' } },
    ]);
    expect(csv).toBe('accountType,debit\r\nASSET,150.30');
  });

  it('quotes values containing commas, quotes and newlines', () => {
    const csv = toCsv(['label'], [{ group: { label: 'a,b' }, metrics: {} }]);
    expect(csv).toContain('"a,b"');
    const quoted = toCsv(['label'], [{ group: { label: 'say "hi"' }, metrics: {} }]);
    expect(quoted).toContain('"say ""hi"""');
  });

  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv(['label'], [{ group: { label: '=cmd|calc' }, metrics: {} }]);
    expect(csv).toContain("'=cmd|calc");
    expect(toCsv(['label'], [{ group: { label: '@SUM(A1)' }, metrics: {} }])).toContain(
      "'@SUM(A1)",
    );
  });

  it('emits the resolved grouping and metric labels as headers', () => {
    expect(columnLabels(spec, ['accountType'])).toEqual(['Account type', 'Debit', 'Credit']);
  });
});

describe('nextRunAt', () => {
  it('computes the next daily occurrence in the schedule time zone', () => {
    const from = new Date('2026-03-10T12:00:00Z');
    const next = nextRunAt({ frequency: 'DAILY', time: '07:00' }, 'UTC', from);
    expect(next.toISOString()).toBe('2026-03-11T07:00:00.000Z');
  });

  it('rolls to next week for a weekly schedule', () => {
    const from = new Date('2026-03-10T12:00:00Z'); // Tuesday
    const next = nextRunAt({ frequency: 'WEEKLY', time: '07:00', dayOfWeek: 1 }, 'UTC', from);
    expect(next.toISOString()).toBe('2026-03-16T07:00:00.000Z');
  });

  it('rolls to next month for a monthly schedule', () => {
    const from = new Date('2026-01-20T12:00:00Z');
    const next = nextRunAt({ frequency: 'MONTHLY', time: '07:00', dayOfMonth: 1 }, 'UTC', from);
    expect(next.toISOString()).toBe('2026-02-01T07:00:00.000Z');
  });

  it('honours the schedule time zone rather than the server zone', () => {
    const from = new Date('2026-01-10T12:00:00Z');
    const next = nextRunAt({ frequency: 'DAILY', time: '07:00' }, 'America/New_York', from);
    // 07:00 New York (UTC-5 in January) === 12:00Z, not 07:00Z
    expect(next.toISOString()).toBe('2026-01-11T12:00:00.000Z');
  });

  it('stays correct across a DST transition', () => {
    const from = new Date('2026-03-06T12:00:00Z'); // before US DST starts 2026-03-08
    const next = nextRunAt({ frequency: 'DAILY', time: '07:00' }, 'America/New_York', from);
    // 07:00 on 2026-03-07 is still UTC-5 => 12:00Z
    expect(next.toISOString()).toBe('2026-03-07T12:00:00.000Z');
    const after = nextRunAt({ frequency: 'DAILY', time: '07:00' }, 'America/New_York', next);
    // 2026-03-08 is UTC-4, so the same wall clock is 11:00Z
    expect(after.toISOString()).toBe('2026-03-08T11:00:00.000Z');
  });

  it('always returns a strictly future instant', () => {
    const from = new Date('2026-03-10T07:00:00Z'); // exactly on the slot
    const next = nextRunAt({ frequency: 'DAILY', time: '07:00' }, 'UTC', from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('rejects an unknown time zone', () => {
    expect(() => nextRunAt({ frequency: 'DAILY', time: '07:00' }, 'Mars/Olympus', new Date())).toThrow(
      /Unknown time zone/,
    );
  });

  it('reports the zone offset used for a given instant', () => {
    expect(timeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'UTC')).toBe(0);
    expect(timeZoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
  });
});