/**
 * Stage 10 chat flow verification (PRD Stage 10; DATA-MODEL §22, USER-FLOWS §19.1).
 *
 * Runs against the live preview API and the seeded Supabase database. Verifies
 * the membership gate, unread derivation, read cursor, direct-chat idempotency
 * and owner-only participant management.
 *
 *   node scripts/verify-chat-flow.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const PASSWORD = 'Admin123!';

let passed = 0;
let failed = 0;

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

async function login(email) {
  const { body } = await call(null, 'POST', '/auth/login', { email, password: PASSWORD });
  if (!body?.data?.accessToken) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.data.accessToken;
}

async function main() {
  section('login');
  const admin = await login('admin@demo.local');
  const manager = await login('manager@demo.local');
  const finance = await login('finance@demo.local');
  check('three demo users authenticate', true, [admin, manager, finance].every((t) => t.length > 1000));

  const companies = await call(admin, 'GET', '/companies');
  check('GET /companies returns the demo company', 200, companies.status);
  const companyId = companies.body.data[0].id;

  const directory = await call(admin, 'GET', `/chat/directory?companyId=${companyId}`);
  check('GET /chat/directory is company-scoped', 200, directory.status);
  const emails = directory.body.data.rows.map((u) => u.email);
  check('directory lists the seeded users', true, emails.includes('admin@demo.local') && emails.includes('manager@demo.local'));

  const search = await call(admin, 'GET', `/chat/directory?companyId=${companyId}&search=finance`);
  check('directory search narrows results', ['finance@demo.local'], search.body.data.rows.map((u) => u.email));

  section('seeded conversations');
  const list = await call(admin, 'GET', '/chat/conversations?pageSize=50');
  check('list conversations', 200, list.status);
  const rows = list.body.data.rows;
  // The suite is re-runnable against a database that already holds smoke data,
  // so seeded-data assertions check a floor rather than an exact count.
  check('both seeded conversations exist', true, rows.length >= 2);
  const direct = rows.find((c) => c.type === 'DIRECT');
  const group = rows.find((c) => c.name === 'Operations');
  check('group conversation is named', 'Operations', group.name);
  check('unread counts are whole numbers', true, rows.every((c) => Number.isInteger(c.unreadCount) && c.unreadCount >= 0));

  section('message history');
  const history = await call(admin, 'GET', `/chat/conversations/${direct.id}/messages?pageSize=50`);
  check('message list returns rows and total', true, Array.isArray(history.body.data.rows) && Number.isInteger(history.body.data.total));
  check('total matches the returned rows', history.body.data.total, history.body.data.rows.length);
  check('seeded direct chat kept its 2 seed messages', true, history.body.data.total >= 2);
  check(
    'messages are returned oldest first',
    true,
    history.body.data.rows.every((m, i, a) => i === 0 || new Date(a[i - 1].createdAt) <= new Date(m.createdAt)),
  );

  section('membership gate');
  const outsider = await call(finance, 'GET', `/chat/conversations/${direct.id}/messages`);
  check('non-member cannot read a conversation', 404, outsider.status);
  const outsiderSend = await call(finance, 'POST', `/chat/conversations/${direct.id}/messages`, { content: 'sneak' });
  check('non-member cannot post', 404, outsiderSend.status);
  const outsiderList = await call(finance, 'GET', '/chat/conversations');
  check('non-member list excludes the conversation', false, outsiderList.body.data.rows.some((c) => c.id === direct.id));

  section('sending and unread');
  const adminUnread = async () => {
    const l = await call(admin, 'GET', '/chat/conversations?pageSize=50');
    return l.body.data.rows.find((c) => c.id === direct.id).unreadCount;
  };
  const mgrUnread = async () => {
    const l = await call(manager, 'GET', '/chat/conversations?pageSize=50');
    return l.body.data.rows.find((c) => c.id === direct.id).unreadCount;
  };

  const adminBefore = await adminUnread();
  const mgrBefore = await mgrUnread();
  const sent = await call(manager, 'POST', `/chat/conversations/${direct.id}/messages`, {
    content: 'Smoke: staging deploy looks clean.',
  });
  check('member can post a message', 201, sent.status);
  const blank = await call(manager, 'POST', `/chat/conversations/${direct.id}/messages`, { content: '   ' });
  check('blank message rejected', 400, blank.status);
  check('blank message reports a validation error', 'VALIDATION_ERROR', blank.body.code);
  check('recipient unread increments by one', adminBefore + 1, await adminUnread());
  check('sender unread unchanged by their own message', mgrBefore, await mgrUnread());

  section('read cursor');
  const markRead = await call(admin, 'POST', `/chat/conversations/${direct.id}/read`, {});
  check('mark read accepted', 201, markRead.status);
  check('mark read returns a cursor', true, Boolean(markRead.body.data.lastReadAt));
  check('unread cleared after reading', 0, await adminUnread());
  check('other member unaffected', mgrBefore, await mgrUnread());

  section('direct chat idempotency');
  const adminId = directory.body.data.rows.find((u) => u.email === 'admin@demo.local').id;
  const again = await call(manager, 'POST', '/chat/conversations', {
    companyId,
    type: 'DIRECT',
    participantUserIds: [adminId],
  });
  check('duplicate direct reuses the pair', direct.id, again.body.data.id);
  check('existing conversation is flagged as reused', true, again.body.data.reused);

  section('participant rules');
  const managerId = directory.body.data.rows.find((u) => u.email === 'manager@demo.local').id;
  const financeId = directory.body.data.rows.find((u) => u.email === 'finance@demo.local').id;

  const selfRef = await call(admin, 'POST', '/chat/conversations', {
    companyId,
    type: 'DIRECT',
    participantUserIds: [adminId],
  });
  check('creator cannot invite themselves', 422, selfRef.status);
  check('self-invite is a business rule error', 'BUSINESS_RULE_ERROR', selfRef.body.code);

  const twoRecipients = await call(admin, 'POST', '/chat/conversations', {
    companyId,
    type: 'DIRECT',
    participantUserIds: [managerId, financeId],
  });
  check('direct chat needs exactly one recipient', 422, twoRecipients.status);
  check('direct chat rejection is a business rule error', 'BUSINESS_RULE_ERROR', twoRecipients.body.code);

  const unknownUser = await call(admin, 'POST', '/chat/conversations', {
    companyId,
    type: 'DIRECT',
    participantUserIds: ['00000000-0000-0000-0000-000000000000'],
  });
  check('unknown participant is rejected', 404, unknownUser.status);

  const noName = await call(admin, 'POST', '/chat/conversations', {
    companyId,
    type: 'GROUP',
    participantUserIds: [managerId],
  });
  check('group chat needs a name', 400, noName.status);
  const issue = noName.body.details?.issues?.[0] ?? {};
  check('group validation names the field', true, String(issue.path).includes('name'));

  const newGroup = await call(admin, 'POST', '/chat/conversations', {
    companyId,
    type: 'GROUP',
    name: 'Smoke Group',
    participantUserIds: [managerId],
  });
  check('owner creates a group', 201, newGroup.status);
  const groupId = newGroup.body.data.id;
  check('creator is the group OWNER', 'OWNER', newGroup.body.data.participants.find((p) => p.userId === adminId)?.role);
  check('invitee joins as MEMBER', 'MEMBER', newGroup.body.data.participants.find((p) => p.userId === managerId)?.role);

  const nonMemberAdd = await call(finance, 'POST', `/chat/conversations/${groupId}/participants`, { userId: managerId });
  check('non-member cannot add participants', 404, nonMemberAdd.status);
  const nonOwnerAdd = await call(manager, 'POST', `/chat/conversations/${groupId}/participants`, { userId: financeId });
  check('member without OWNER role cannot add participants', 422, nonOwnerAdd.status);
  check('owner-only rule is a business rule error', 'BUSINESS_RULE_ERROR', nonOwnerAdd.body.code);

  const add = await call(admin, 'POST', `/chat/conversations/${groupId}/participants`, { userId: financeId });
  check('owner adds a participant', 201, add.status);
  const addAgain = await call(admin, 'POST', `/chat/conversations/${groupId}/participants`, { userId: financeId });
  check('duplicate participant rejected', 422, addAgain.status);
  check('duplicate rejection is a business rule error', 'BUSINESS_RULE_ERROR', addAgain.body.code);

  const directAdd = await call(admin, 'POST', `/chat/conversations/${direct.id}/participants`, { userId: financeId });
  check('direct chat never grows', 422, directAdd.status);

  section('notification fan-out');
  const financeNotifs = await call(finance, 'GET', '/notifications?onlyUnread=true');
  check('added participant is notified in-app', true, financeNotifs.body.data.some((n) => n.type === 'COMMUNICATION_PARTICIPANT_ADDED'));
  const postAdd = await call(manager, 'POST', `/chat/conversations/${groupId}/messages`, { content: 'Welcome aboard.' });
  check('member posts to the group', 201, postAdd.status);
  const messageId = postAdd.body.data.id;
  const adminNotifs = await call(admin, 'GET', '/notifications?onlyUnread=true');
  const chatNotif = adminNotifs.body.data.find((n) => n.type === 'CHAT_MESSAGE');
  check('message notifies other participants', true, Boolean(chatNotif));
  check('chat notification links to the message', messageId, chatNotif?.resourceId ?? null);
  check('chat notification is in-app only', 'IN_APP', chatNotif?.channel ?? null);

  section('audit trail');
  const convAudit = await call(admin, 'GET', '/audit?resourceType=conversation&pageSize=20');
  check('conversation audit entries readable', 200, convAudit.status);
  check('audit list is a plain array', true, Array.isArray(convAudit.body.data));
  const convActions = convAudit.body.data.map((r) => r.action);
  check(
    'conversation creation is audited',
    true,
    convActions.includes('communication.group_created') || convActions.includes('communication.direct_created'),
  );
  check('read receipts are audited', true, convActions.includes('communication.read_receipt'));

  const msgAudit = await call(admin, 'GET', '/audit?resourceType=message&pageSize=20');
  const partAudit = await call(admin, 'GET', '/audit?resourceType=conversation_participant&pageSize=20');
  check('participant addition is audited', true, partAudit.body.data.some((r) => r.action === 'communication.participant_added'));
  check('message send is audited', true, msgAudit.body.data.some((r) => r.action === 'communication.message_sent'));
  check('audit records the request id', true, msgAudit.body.data.some((r) => r.action === 'communication.message_sent' && Boolean(r.requestId)));

  section('scope guard');
  const badUuid = await call(admin, 'GET', '/chat/directory?companyId=not-a-uuid');
  check('invalid companyId rejected', 400, badUuid.status);
  const missing = await call(admin, 'GET', '/chat/conversations/00000000-0000-0000-0000-000000000000/messages');
  check('unknown conversation is a 404', 404, missing.status);

  console.log('\n===============================');
  console.log(`passed=${passed} failed=${failed}`);
  if (failed > 0) {
    console.log('CHAT FLOW VERIFICATION FAILED');
    process.exit(1);
  }
  console.log('CHAT FLOW VERIFICATION PASSED');
}

main().catch((e) => {
  console.error('verification error:', e);
  process.exit(1);
});
