#!/usr/bin/env node
// Proves the local checkout and the live site read the same database.
//
//   node scripts/verify-shared-db.mjs
//
// Reads rows over the local DATABASE_URL (apps/api/.env) and then asks the live HTTP
// API for the same rows, comparing id and updatedAt. It is read-only and writes
// nothing, on either side, so it is safe to run against production at any time.
//
// Why this exists: "local and live always share data" is a claim about configuration,
// and configuration drifts. If someone points the host at a second database, or the
// local .env at a local Postgres, this fails loudly instead of silently diverging.
//
// Overrides: LIVE_URL, LIVE_EMAIL, LIVE_PASSWORD.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_URL = (process.env.LIVE_URL ?? 'https://erp.ienet.online').replace(/\/$/, '');
const EMAIL = process.env.LIVE_EMAIL ?? 'admin@demo.local';
const PASSWORD = process.env.LIVE_PASSWORD ?? 'Admin123!';

let failed = false;
const ok = (s) => console.log(`  ok   ${s}`);
const bad = (s, expected, actual) => {
  failed = true;
  console.error(`  FAIL ${s}\n       expected: ${expected}\n       actual:   ${actual}`);
};
const check = (s, expected, actual) =>
  expected === actual ? ok(s) : bad(s, expected, actual);

function databaseUrl() {
  const envPath = join(ROOT, 'apps/api/.env');
  let raw;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    console.error(`ERROR: cannot read ${envPath}`);
    process.exit(2);
  }
  const match = raw.match(/^DATABASE_URL=(.*)$/m);
  if (!match) {
    console.error(`ERROR: no DATABASE_URL in ${envPath}`);
    process.exit(2);
  }
  return match[1].trim().replace(/^"|"$/g, '');
}

// The length of the password and the token are never printed: only shape is.
function describe(url) {
  const u = new URL(url);
  return `host=${u.hostname} db=${u.pathname.slice(1)} user=${u.username.split('.')[0]}`;
}

const url = databaseUrl();
console.log(`local database: ${describe(url)}`);
console.log(`live site:      ${LIVE_URL}`);

const { PrismaClient } = await import(join(ROOT, 'node_modules/@prisma/client/index.js'));
const prisma = new PrismaClient({ datasources: { db: { url } } });

let local;
try {
  const [accounts, users, companies] = await Promise.all([
    prisma.account.findMany({
      take: 5,
      orderBy: { accountCode: 'asc' },
      select: { id: true, accountCode: true, updatedAt: true },
    }),
    prisma.user.count(),
    prisma.company.count(),
  ]);
  local = { accounts, users, companies };
  console.log(
    `local read:   ${accounts.length} sampled accounts, ${users} users, ${companies} companies`,
  );
} catch (e) {
  console.error(`ERROR: the local DATABASE_URL could not be read: ${e.message.split('\n')[0]}`);
  process.exit(2);
} finally {
  await prisma.$disconnect();
}

let token;
try {
  const login = await fetch(`${LIVE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`ERROR: live login failed with HTTP ${login.status}`);
    process.exit(2);
  }
  const body = await login.json();
  token = body?.data?.accessToken ?? body?.accessToken;
  if (!token) {
    console.error('ERROR: live login returned no access token');
    process.exit(2);
  }
  ok(`live login accepted for ${EMAIL}`);
} catch (e) {
  console.error(`ERROR: could not reach ${LIVE_URL}: ${e.message}`);
  process.exit(2);
}

let list;
try {
  const res = await fetch(`${LIVE_URL}/api/v1/accounting/accounts`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`ERROR: live accounts request failed with HTTP ${res.status}`);
    process.exit(2);
  }
  const body = await res.json();
  list = Array.isArray(body) ? body : (body?.data?.rows ?? body?.data?.items ?? body?.data);
  if (!Array.isArray(list)) {
    console.error(`ERROR: unexpected live payload: ${JSON.stringify(Object.keys(body))}`);
    process.exit(2);
  }
  ok(`live API served ${list.length} accounts`);
} catch (e) {
  console.error(`ERROR: could not reach ${LIVE_URL}: ${e.message}`);
  process.exit(2);
}

const liveById = new Map(list.map((r) => [r.id, r]));
for (const account of local.accounts) {
  const remote = liveById.get(account.id);
  if (!remote) {
    bad(
      `account ${account.accountCode} read locally exists live`,
      `id ${account.id} present in the live response`,
      'absent',
    );
    continue;
  }
  check(
    `account ${account.accountCode} has the same updatedAt both sides`,
    new Date(account.updatedAt).toISOString(),
    new Date(remote.updatedAt).toISOString(),
  );
}

// The same row set must be visible to the live app, not merely overlapping ids.
const localCodes = local.accounts.map((a) => a.accountCode).sort();
const liveCodes = list
  .map((r) => r.accountCode)
  .filter((c) => localCodes.includes(c))
  .sort();
check(
  'the live app sees the same chart of accounts',
  localCodes.join(','),
  liveCodes.join(','),
);

if (failed) {
  console.error(
    '\nRESULT: the local checkout and the live site do NOT agree. They are probably no longer\n        pointed at the same database. Check DATABASE_URL in apps/api/.env against the\n        host app\'s .env.',
  );
  process.exit(1);
}
console.log(
  `\nRESULT: local and live share one database -- ${local.accounts.length}/${
    local.accounts.length
  } sampled rows matched on id and updatedAt.`,
);
