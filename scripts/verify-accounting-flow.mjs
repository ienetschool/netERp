/**
 * Stage 8 end-to-end accounting verification against a running API.
 * Usage: node scripts/verify-accounting-flow.mjs
 * Creates a balanced manual journal, submits it, approves it (CHIEF_ACCOUNTANT
 * granted to admin), posts it, checks the trial balance, reverses it, and
 * imports module journals from the PENDING outbox (idempotent).
 */
const BASE = 'http://localhost:4000/api/v1';
const CHIEF_ACCOUNTANT_ROLE = process.env.CHIEF_ACCOUNTANT_ROLE ?? '';
const DEMO_CO = 'e4648fdf-245d-4ab0-9bd0-3700ac00f245';

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(cond, label, detail) {
  if (!cond) {
    console.error(`FAIL: ${label}`, detail ?? '');
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

async function main() {
  let r = await api('POST', '/auth/login', null, {
    email: 'admin@demo.local',
    password: 'Admin123!',
  });
  assert(r.status === 201, 'login 201');
  let token = (r.json.data ?? r.json).accessToken ?? (r.json.data ?? r.json).token;

  // Grant CHIEF_ACCOUNTANT to admin so the approval task can be acted.
  if (CHIEF_ACCOUNTANT_ROLE) {
    const me = await api('GET', '/auth/me', token);
    r = await api('POST', '/users/assignments', token, {
      userId: me.json.data?.userId,
      roleId: CHIEF_ACCOUNTANT_ROLE,
      companyId: DEMO_CO,
    });
    console.log(`role assignment: ${r.status}`);
    r = await api('POST', '/auth/login', null, {
      email: 'admin@demo.local',
      password: 'Admin123!',
    });
    token = (r.json.data ?? r.json).accessToken ?? (r.json.data ?? r.json).token;
  }

  // Resolve posting accounts (1200 AR, 4000 Revenue).
  const accounts = await api('GET', '/accounting/accounts?pageSize=100', token);
  const rows = accounts.json.data?.rows ?? [];
  const ar = rows.find((a) => a.accountCode === '1200');
  const revenue = rows.find((a) => a.accountCode === '4000');
  assert(!!ar && !!revenue, 'posting accounts exist', rows.map((a) => a.accountCode));

  // 1. Create a balanced manual journal: DR AR 240 / CR Revenue 240.
  r = await api('POST', '/accounting/journals', token, {
    companyId: DEMO_CO,
    journalDate: new Date().toISOString().slice(0, 10),
    journalType: 'GENERAL',
    description: 'Smoke: manual adjustment journal',
    lines: [
      { accountId: ar.id, debit: '240.00', description: 'Adjustment to AR' },
      { accountId: revenue.id, credit: '240.00', description: 'Adjustment to revenue' },
    ],
  });
  assert(r.status === 201, 'journal created', r.json);
  const journal = r.json.data;

  // 2. Submit for approval.
  r = await api('POST', `/accounting/journals/${journal.id}/submit`, token, {});
  assert(r.status === 201, 'journal submitted', r.json);
  assert(r.json.data?.status === 'PENDING_APPROVAL', 'PENDING_APPROVAL', r.json.data);

  // 3. Approve via the workflow inbox.
  const inbox = await api('GET', '/workflow/approval-tasks?status=PENDING', token);
  const tasks = inbox.json.data?.rows ?? inbox.json.data ?? [];
  const task = (Array.isArray(tasks) ? tasks : []).find(
    (t) => t.entityType === 'journal_entry' && t.entityId === journal.id,
  );
  assert(!!task, 'approval task found', inbox.json);
  r = await api('POST', `/workflow/approval-tasks/${task.id}/act`, token, { decision: 'APPROVE' });
  assert(r.status === 201, 'approval acted', r.json);

  // 4. Post it.
  r = await api('POST', `/accounting/journals/${journal.id}/post`, token, {});
  assert(r.status === 201, 'journal posted', r.json);
  assert(r.json.data?.status === 'POSTED', 'status POSTED', r.json.data);

  // 5. Trial balance reflects it and stays balanced.
  const tb = await api('GET', '/accounting/trial-balance', token);
  assert(tb.json.data?.balanced === true, 'trial balance balanced', tb.json.data?.totals);
  const arRow = (tb.json.data?.rows ?? []).find((x) => x.accountCode === '1200');
  assert(!!arRow, 'AR row present in trial balance');

  // 6. Reverse it; reversal journal posts immediately.
  r = await api('POST', `/accounting/journals/${journal.id}/reverse`, token, {
    reason: 'Smoke reversal',
  });
  assert(r.status === 201, 'reversal created', r.json);
  const detail = await api('GET', `/accounting/journals/${journal.id}`, token);
  assert(detail.json.data?.status === 'REVERSED', 'original REVERSED', detail.json.data?.status);

  // 7. Import module journals from the PENDING outbox (sales invoice etc.).
  r = await api('POST', '/accounting/journals/import-outbox', token, {});
  assert(r.status === 201, 'outbox import ran', r.json);
  console.log('import result:', JSON.stringify(r.json.data));

  // 8. Statements + daybook + aging render.
  r = await api('GET', '/accounting/statements', token);
  assert(r.status === 200 && r.json.data?.trialBalanced === true, 'statements render', r.json);
  r = await api('GET', '/accounting/daybook', token);
  assert(r.status === 200, 'daybook renders', r.status);
  r = await api('GET', '/accounting/ar-aging', token);
  assert(r.status === 200, 'AR aging renders', r.status);
  r = await api('GET', '/accounting/ap-aging', token);
  assert(r.status === 200, 'AP aging renders', r.status);

  console.log('\nAccounting flow VERIFIED end to end.');
}

main().catch((e) => {
  console.error('FLOW ERROR', e);
  process.exit(1);
});
