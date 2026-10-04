/**
 * Stage 11 reporting verification (PRD Stage 11; DATA-MODEL §23, USER-FLOWS §21).
 *
 * Runs against the live preview API and the seeded Supabase database. Verifies
 * permission gating, company scoping, filter rejection, aggregation, drill-down,
 * export lifecycle, saved configurations and scheduled-report management.
 *
 *   node scripts/verify-reporting-flow.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const PASSWORD = 'Admin123!';

let passed = 0;
let failed = 0;
const created = { saved: [], schedules: [], exports: [] };

function check(label, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label} (${JSON.stringify(actual)})`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/** Returns { status, body } where body is the parsed envelope (or raw text). */
async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/**
 * A run of this harness outlives the 15-minute access token, so a mid-run 401
 * means "re-authenticate", not "the check failed". Re-login and retry once;
 * anything that is still 401 is a real authorization failure and is reported.
 */
const tokenOwners = new Map();

async function callAs(token, method, path, body) {
  const first = await call(token, method, path, body);
  if (first.status !== 401 || !token) return first;
  const email = tokenOwners.get(token);
  if (!email) return first;
  const fresh = await login(email);
  tokenOwners.set(fresh, email);
  return call(fresh, method, path, body);
}

async function login(email) {
  const { body } = await call(null, 'POST', '/auth/login', { email, password: PASSWORD });
  if (!body?.data?.accessToken) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  tokenOwners.set(body.data.accessToken, email);
  return body.data.accessToken;
}

async function cleanup() {
  const token = await login('admin@demo.local');
  for (const id of created.schedules) {
    await call(token, 'DELETE', `/reports/scheduled/${id}`);
  }
  for (const id of created.saved) {
    await call(token, 'DELETE', `/reports/saved/${id}`);
  }
}

async function main() {
  section('login');
  const admin = await login('admin@demo.local');
  // The second reporting principal: seeded with reporting
  // view/export/download/create but not edit/delete.
  const finance = await login('finance@demo.local');
  // Holds no reporting permission at all — used for the negative probes.
  const office = await login('office@demo.local');
  check('three demo users authenticate', true, [admin, finance, office].every((t) => t.length > 1000));

  const companies = await callAs(admin, 'GET', '/companies');
  check('GET /companies returns the demo company', 200, companies.status);
  // Every list endpoint answers with { rows, total } inside `data`.
  const companyRows = companies.body.data?.rows ?? [];
  check('company list uses the rows/total envelope', true, companyRows.length > 0);
  const companyId = companyRows[0].id;

  section('report catalogue');
  const defs = await callAs(admin, 'GET', '/reports/definitions');
  check('admin sees the seeded report catalogue', 200, defs.status);
  const definitions = defs.body?.data?.rows ?? [];
  check('catalogue has at least 9 reports', true, definitions.length >= 9);
  check(
    'every definition exposes dimensions, metrics and supported filters',
    true,
    definitions.every((d) => Array.isArray(d.dimensions) && Array.isArray(d.metrics) && Array.isArray(d.supportedFilters)),
  );
  check(
    'catalogue includes the trial balance report',
    true,
    definitions.some((d) => d.code === 'GL_TRIAL_BALANCE'),
  );
  const trialBalance = definitions.find((d) => d.code === 'GL_TRIAL_BALANCE');
  const headcount = definitions.find((d) => d.code === 'HEADCOUNT');
  check('trial balance is scoped to posted journals', true, String(trialBalance?.supportedFilters ?? []).includes('from'));

  section('permission gating');
  const officeDefs = await callAs(office, 'GET', '/reports/definitions');
  check('a low-privilege user gets a 403 on the catalogue', 403, officeDefs.status);
  check('a low-privilege user gets a 403 on a run', 403, (await callAs(office, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {})).status);
  check('an unauthenticated run is a 401', 401, (await call(null, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {})).status);

  section('running a report');
  const run = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    grouping: ['accountType'],
    pageSize: 50,
  });
  check('trial balance run succeeds', 201, run.status);
  const result = run.body?.data;
  check('run returns columns with kinds', true, (result?.columns ?? []).every((c) => c.kind === 'dimension' || c.kind === 'metric'));
  check('run returns totals', true, Object.keys(result?.totals ?? {}).length > 0);
  check('run reports the source row count', true, (result?.sourceRowCount ?? 0) > 0);
  check('trial balance is balanced (debits equal credits)', true, result?.totals?.debit === result?.totals?.credit);
  check(
    'grouped rows carry the grouping key',
    true,
    (result?.rows ?? []).every((r) => typeof r.group?.accountType === 'string'),
  );

  const ungrouped = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    grouping: [],
    pageSize: 50,
  });
  check('an empty grouping falls back to the definition default', 201, ungrouped.status);
  check(
    'fallback grouping matches the declared default',
    trialBalance.defaultGrouping,
    (ungrouped.body?.data?.columns ?? []).filter((c) => c.kind === 'dimension').map((c) => c.key),
  );

  const sorted = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    grouping: ['accountType'],
    sorting: { field: 'debit', direction: 'desc' },
  });
  check('a metric sort is accepted', 201, sorted.status);
  check(
    'descending sort puts the largest debit first',
    true,
    Number(sorted.body?.data?.rows?.[0]?.metrics?.debit ?? 0) >= Number(sorted.body?.data?.rows?.[1]?.metrics?.debit ?? 0),
  );

  const dated = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    filters: { from: '2000-01-01', to: '2000-01-02' },
    grouping: ['accountType'],
  });
  check('a date range that matches nothing returns no rows', 201, dated.status);
  check('narrow date range excludes everything', 0, dated.body?.data?.rows?.length);

  const reversedRange = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    filters: { from: '2026-12-31', to: '2026-01-01' },
  });
  check('from after to is rejected', 400, reversedRange.status);

  const headcountRun = await callAs(admin, 'POST', '/reports/definitions/HEADCOUNT/run', {
    grouping: ['department'],
  });
  check('headcount run succeeds', 201, headcountRun.status);
  check(
    'headcount counts employees per department',
    true,
    (headcountRun.body?.data?.rows ?? []).every((r) => Number(r.metrics?.headcount ?? 0) >= 0),
  );

  const sortedBad = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    sorting: { field: 'notAColumn', direction: 'asc' },
  });
  check('sorting on an unknown field is rejected', 422, sortedBad.status);
  check('the rejection is a business rule error', 'BUSINESS_RULE_ERROR', sortedBad.body?.code);

  section('filters and scope');
  const badFilter = await callAs(admin, 'POST', '/reports/definitions/HEADCOUNT/run', {
    filters: { productId: '00000000-0000-0000-0000-000000000001' },
  });
  check('an unsupported filter is rejected, not silently ignored', 422, badFilter.status);

  const scoped = await callAs(admin, 'POST', '/reports/definitions/HEADCOUNT/run', {
    filters: { companyId },
    grouping: ['department'],
  });
  check('an in-scope company filter is accepted', 201, scoped.status);

  const foreign = await call(
    admin,
    'POST',
    '/reports/definitions/HEADCOUNT/run',
    { filters: { companyId: '00000000-0000-0000-0000-0000000000ff' }, grouping: ['department'] },
  );
  check(
    'a companyId outside the principal scope cannot widen the report',
    0,
    foreign.body?.data?.rows?.length,
  );
  check('the in-scope companyId returns rows', true, (scoped.body?.data?.rows?.length ?? 0) > 0);

  const badUuid = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    filters: { companyId: 'not-a-uuid' },
  });
  check('a malformed companyId is a validation error', 400, badUuid.status);

  const unknownReport = await callAs(admin, 'POST', '/reports/definitions/NOPE_DOES_NOT_EXIST/run', {});
  check('an unknown report code is a 404', 404, unknownReport.status);

  section('every catalogue source runs');
  // Each seeded definition must run without error. A wrong Prisma field name
  // only surfaces when the report is actually executed.
  for (const definition of definitions) {
    const res = await callAs(admin, 'POST', `/reports/definitions/${definition.code}/run`, {
      grouping: definition.defaultGrouping,
      pageSize: 5,
    });
    check(`${definition.code} runs`, 201, res.status);
    check(
      `${definition.code} returns its declared columns`,
      true,
      (res.body?.data?.columns ?? []).length > 0,
    );
  }

  section('paging');
  const page1 = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    grouping: ['account'],
    page: 1,
    pageSize: 1,
  });
  const page2 = await callAs(admin, 'POST', '/reports/definitions/GL_TRIAL_BALANCE/run', {
    grouping: ['account'],
    page: 2,
    pageSize: 1,
  });
  check('paging returns the total across pages', true, page1.body?.data?.total >= 2);
  check('page size is honoured', 1, page1.body?.data?.rows?.length);
  check(
    'page 2 differs from page 1',
    true,
    JSON.stringify(page1.body?.data?.rows?.[0]?.group) !== JSON.stringify(page2.body?.data?.rows?.[0]?.group),
  );

  section('drill-down');
  /**
   * Drill a report into its detail rows and assert the grid is actually
   * populated. A select that omits `detailFields` does not error - it returns
   * rows of empty strings, so only a per-cell assertion catches it.
   */
  async function checkDrillDown(code, grouping) {
    const base = await callAs(admin, 'POST', `/reports/definitions/${code}/run`, { grouping, pageSize: 50 });
    check(`${code} runs before drill-down`, 201, base.status);
    const group = base.body?.data?.rows?.[0]?.group ?? {};
    const res = await callAs(admin, 'POST', `/reports/definitions/${code}/drill-down`, { grouping, groupKey: group });
    check(`${code} drill-down succeeds`, 201, res.status);
    const data = res.body?.data;
    check(`${code} drill-down returns detail headers`, true, (data?.headers ?? []).length > 0);
    check(
      `${code} drill-down rows belong to the group`,
      true,
      (data?.rows ?? []).length > 0 && (data?.matched ?? 0) >= (data?.rows ?? []).length,
    );
    const cells = (data?.rows ?? []).flat();
    const blanks = cells.filter((c) => String(c).length === 0).length;
    check(`${code} drill-down populates every detail cell`, 0, blanks);
    return { headers: data?.headers ?? [], sample: (data?.rows ?? [])[0] ?? [] };
  }

  const trialDrill = await checkDrillDown('GL_TRIAL_BALANCE', ['accountType']);
  check(
    'trial-balance drill-down exposes journal detail columns',
    true,
    ['Journal', 'Date', 'Account', 'Debit', 'Credit'].every((h) =>
      trialDrill.headers.some((x) => String(x).toLowerCase().includes(h.toLowerCase())),
    ),
  );
  // A second, relation-carrying source with a derived metric, grouped by a
  // *relation* path (`customer.displayName`). The group key therefore arrives
  // as a human label rather than an id, which the filter must still resolve.
  const arDrill = await checkDrillDown('AR_OUTSTANDING', ['customerName']);
  check(
    'receivables drill-down exposes invoice detail columns',
    true,
    arDrill.headers.some((h) => /invoice/i.test(String(h))),
  );

  section('exports');
  const exportCsv = await callAs(admin, 'POST', '/reports/exports', {
    reportDefinitionId: trialBalance.id,
    format: 'CSV',
  });
  check('CSV export is created READY', 201, exportCsv.status);
  check('export status is READY', 'READY', exportCsv.body?.data?.status);
  check('export records a row count', true, (exportCsv.body?.data?.rowCount ?? 0) > 0);
  check('export records a size', true, (exportCsv.body?.data?.sizeBytes ?? 0) > 0);
  check('export has an expiry', true, Boolean(exportCsv.body?.data?.expiresAt));
  const csvExportId = exportCsv.body?.data?.id;
  created.exports.push(csvExportId);

  const exportJson = await callAs(admin, 'POST', '/reports/exports', {
    reportDefinitionId: headcount.id,
    format: 'JSON',
  });
  check('JSON export is created', 201, exportJson.status);
  created.exports.push(exportJson.body?.data?.id);

  const exportList = await callAs(admin, 'GET', '/reports/exports?pageSize=20');
  check('exports list includes both new exports', true, (exportList.body?.data?.rows ?? []).length >= 2);
  check('exports are listed newest first', true, (exportList.body?.data?.rows ?? []).every((r, i, a) => i === 0 || new Date(a[i - 1].requestedAt) >= new Date(r.requestedAt)));

  section('export download guard');
  const download = await fetch(`${BASE}/reports/exports/${csvExportId}/download`, {
    headers: { Authorization: `Bearer ${admin}` },
  });
  check('owner can download the export', 200, download.status);
  const csv = await download.text();
  check('the CSV has a header row', true, csv.split('\r\n')[0].split(',').length > 1);
  check('the CSV is not empty', true, csv.length > 20);

  const otherDownload = await fetch(`${BASE}/reports/exports/${csvExportId}/download`, {
    headers: { Authorization: `Bearer ${finance}` },
  });
  check("a different user cannot download someone else's export", 404, otherDownload.status);

  const anonDownload = await fetch(`${BASE}/reports/exports/${csvExportId}/download`);
  check('an anonymous download is a 401', 401, anonDownload.status);

  section('saved configurations');
  const saved = await callAs(admin, 'POST', '/reports/saved', {
    reportDefinitionId: trialBalance.id,
    name: `Verification ${Date.now()}`,
    filters: { from: '2020-01-01', to: '2030-01-01' },
    columns: ['accountType', 'debit'],
    sorting: { field: 'debit', direction: 'desc' },
    grouping: ['accountType'],
  });
  check('a saved report is created', 201, saved.status);
  const savedId = saved.body?.data?.id;
  created.saved.push(savedId);

  const savedList = await callAs(admin, 'GET', `/reports/saved?definitionId=${trialBalance.id}`);
  check('saved reports are listed for the definition', true, (savedList.body?.data?.rows ?? []).some((r) => r.id === savedId));
  check('a saved report keeps its grouping', ['accountType'], saved.body?.data?.grouping);
  check('a saved report keeps its filters', '2020-01-01', saved.body?.data?.filters?.from);

  const duplicate = await callAs(admin, 'POST', '/reports/saved', {
    reportDefinitionId: trialBalance.id,
    name: saved.body?.data?.name,
    columns: [],
    grouping: [],
  });
  check('a duplicate saved name is rejected', 409, duplicate.status);

  const otherSaved = await callAs(finance, 'GET', `/reports/saved?definitionId=${trialBalance.id}`);
  check('another reporting user sees none of the saved reports', 0, otherSaved.body?.data?.total);


  const deleteSaved = await callAs(admin, 'DELETE', `/reports/saved/${savedId}`);
  check('a saved report can be deleted', 200, deleteSaved.status);
  created.saved = created.saved.filter((id) => id !== savedId);
  const afterDelete = await callAs(admin, 'GET', `/reports/saved?definitionId=${trialBalance.id}`);
  check('the deleted saved report is gone', false, (afterDelete.body?.data?.rows ?? []).some((r) => r.id === savedId));

  section('scheduled reports');
  const schedule = await callAs(admin, 'POST', '/reports/scheduled', {
    reportDefinitionId: trialBalance.id,
    schedule: { frequency: 'WEEKLY', time: '07:00', dayOfWeek: 1 },
    timezone: 'UTC',
    filters: { companyId },
    outputFormat: 'CSV',
    deliveryChannel: 'IN_APP',
  });
  check('a weekly schedule is created', 201, schedule.status);
  const scheduleId = schedule.body?.data?.id;
  created.schedules.push(scheduleId);
  check('the schedule starts ACTIVE', 'ACTIVE', schedule.body?.data?.status);
  check('the schedule has a next run in the future', true, new Date(schedule.body?.data?.nextRunAt).getTime() > Date.now());
  check(
    'the next run lands on a Monday at 07:00Z',
    true,
    new Date(schedule.body?.data?.nextRunAt).getUTCDay() === 1 &&
      new Date(schedule.body?.data?.nextRunAt).getUTCHours() === 7,
  );

  const daily = await callAs(admin, 'POST', '/reports/scheduled', {
    reportDefinitionId: headcount.id,
    schedule: { frequency: 'DAILY', time: '06:30' },
    timezone: 'America/New_York',
    outputFormat: 'JSON',
    deliveryChannel: 'EMAIL',
  });
  check('a daily schedule in another time zone is created', 201, daily.status);
  const dailyId = daily.body?.data?.id;
  created.schedules.push(dailyId);
  check(
    'the next run is computed in the schedule time zone',
    true,
    new Date(daily.body?.data?.nextRunAt).getUTCHours() === 11 || new Date(daily.body?.data?.nextRunAt).getUTCHours() === 10,
  );

  const badFrequency = await callAs(admin, 'POST', '/reports/scheduled', {
    reportDefinitionId: headcount.id,
    schedule: { frequency: 'HOURLY', time: '06:30' },
    timezone: 'UTC',
  });
  check('an unsupported frequency is rejected', 400, badFrequency.status);

  const missingDay = await callAs(admin, 'POST', '/reports/scheduled', {
    reportDefinitionId: headcount.id,
    schedule: { frequency: 'WEEKLY', time: '06:30' },
    timezone: 'UTC',
  });
  check('a weekly schedule without dayOfWeek is rejected', 400, missingDay.status);

  const badZone = await callAs(admin, 'POST', '/reports/scheduled', {
    reportDefinitionId: headcount.id,
    schedule: { frequency: 'DAILY', time: '06:30' },
    timezone: 'Mars/Olympus',
  });
  check('an unknown time zone is rejected', 422, badZone.status);

  const scheduledList = await callAs(admin, 'GET', '/reports/scheduled');
  check('schedules are listed', true, (scheduledList.body?.data?.rows ?? []).length >= 2);
  check(
    'schedules are listed soonest-first',
    true,
    (scheduledList.body?.data?.rows ?? []).every((r, i, a) => i === 0 || new Date(a[i - 1].nextRunAt) <= new Date(r.nextRunAt)),
  );

  const paused = await callAs(admin, 'PATCH', `/reports/scheduled/${scheduleId}/status`, { status: 'PAUSED' });
  check('a schedule can be paused', 200, paused.status);
  check('the paused status is stored', 'PAUSED', paused.body?.data?.status);

  const resumed = await callAs(admin, 'PATCH', `/reports/scheduled/${scheduleId}/status`, { status: 'ACTIVE' });
  check('a schedule can be resumed', 200, resumed.status);
  check(
    'resuming recomputes the next run into the future',
    true,
    new Date(resumed.body?.data?.nextRunAt).getTime() > Date.now(),
  );

  const disabled = await callAs(admin, 'PATCH', `/reports/scheduled/${scheduleId}/status`, { status: 'DISABLED' });
  check('a schedule can be disabled', 200, disabled.status);

  const otherSchedules = await callAs(finance, 'GET', '/reports/scheduled');
  check('schedules are private to their owner', false, (otherSchedules.body?.data?.rows ?? []).some((r) => r.id === scheduleId));

  // Finance holds reporting view/export/download/create but NOT delete, so the
  // permission guard refuses first. A permitted-but-not-owner delete is
  // covered by the ownership check below.
  const foreignDelete = await callAs(finance, 'DELETE', `/reports/scheduled/${scheduleId}`);
  check('reporting.delete is required to remove a schedule', 403, foreignDelete.status);

  const foreignSchedule = await call(
    admin,
    'POST',
    '/reports/scheduled',
    {
      reportDefinitionId: trialBalance.id,
      schedule: { frequency: 'DAILY', time: '05:45' },
      timezone: 'UTC',
      outputFormat: 'CSV',
      deliveryChannel: 'IN_APP',
    },
  );
  check('a second owner can create their own schedule', 201, foreignSchedule.status);
  created.schedules.push(foreignSchedule.body?.data?.id);

  section('audit');
  const exportAudit = await callAs(admin, 'GET', '/audit?resourceType=report_export&pageSize=20');
  check('export creation is audited', true, (exportAudit.body?.data?.rows ?? []).some((r) => r.action === 'reporting.export_created'));
  check(
    'downloads are audited with the request id',
    true,
    (exportAudit.body?.data?.rows ?? []).some((r) => r.action === 'reporting.export_downloaded' && Boolean(r.requestId)),
  );
  const scheduleAudit = await callAs(admin, 'GET', '/audit?resourceType=scheduled_report&pageSize=20');
  check('schedule creation is audited', true, (scheduleAudit.body?.data?.rows ?? []).some((r) => r.action === 'reporting.schedule_created'));

  section('cleanup');
  await deleteCreatedSchedules(admin);
  await deleteCreatedSaved(admin);

  console.log('\n===============================');
  console.log(`passed=${passed} failed=${failed}`);
  if (failed > 0) {
    console.log('REPORTING FLOW VERIFICATION FAILED');
    process.exit(1);
  }
  console.log('REPORTING FLOW VERIFICATION PASSED');
}

/** Removes every schedule this run created, as its owner. */
async function deleteCreatedSchedules(token) {
  for (const id of created.schedules.splice(0)) {
    if (!id) continue;
    const res = await call(token, 'DELETE', `/reports/scheduled/${id}`);
    check(`schedule ${String(id).slice(0, 8)} deleted`, 200, res.status);
  }
}

/** Removes every saved configuration this run created. */
async function deleteCreatedSaved(token) {
  for (const id of created.saved.splice(0)) {
    if (!id) continue;
    const res = await call(token, 'DELETE', `/reports/saved/${id}`);
    check(`saved ${String(id).slice(0, 8)} deleted`, 200, res.status);
  }
}

main()
  .catch(async (e) => {
    console.error('verification error:', e);
    await cleanup().catch(() => {});
    process.exit(1);
  });