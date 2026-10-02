/**
 * Stage 7 end-to-end flow verification (quote to cash) against a running API.
 * Usage: node scripts/verify-sales-flow.mjs
 * Creates a sales order, submits it, approves it (SALES_MANAGER granted to the
 * admin first), delivers it (stock issues), invoices, posts, and collects a
 * receipt. Idempotency: creates new documents each run (numbering increments).
 */
const BASE = 'http://localhost:4000/api/v1';
const USD = '61060136-5b56-4b24-9280-b51ad64d6cbe';
const MAIN_WH = '767d9c46-a161-4c0f-8950-29b74eaf8da9';
const SALES_MGR_ROLE = 'ea22e0e2-162b-4a2d-8e71-5bde26c790b8';
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
  // 1. Login
  let r = await api('POST', '/auth/login', null, {
    email: 'admin@demo.local',
    password: 'Admin123!',
  });
  assert(r.status === 201, 'login 201');
  const token = (r.json.data ?? r.json).accessToken ?? (r.json.data ?? r.json).token;

  // 2. Grant SALES_MANAGER to admin so the approval inbox task can be acted
  const me = await api('GET', '/auth/me', token);
  const adminId = me.json.data?.userId;
  r = await api('POST', '/users/assignments', token, {
    userId: adminId,
    roleId: SALES_MGR_ROLE,
    companyId: DEMO_CO,
  });
  console.log(`role assignment: ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);

  // 3. Re-login to embed the new role in the token
  r = await api('POST', '/auth/login', null, {
    email: 'admin@demo.local',
    password: 'Admin123!',
  });
  const token2 = (r.json.data ?? r.json).accessToken ?? (r.json.data ?? r.json).token;

  // 4. Find customer + order lines
  const me2 = await api('GET', '/auth/me', token2);
  assert(!!me2.json.data?.userId, 'auth/me returns user id');
  r = await api('GET', '/sales/customers?pageSize=10', token2);
  const customer = (r.json.data?.rows ?? [])[0];
  assert(!!customer, 'seeded customer exists', r.json);

  // 5. Create sales order for two real stock products
  const products = await api('GET', '/inventory/products?pageSize=10', token2);
  const skus = products.json.data?.rows ?? [];
  const paper = skus.find((p) => p.sku === 'SKU-0001');
  const stapler = skus.find((p) => p.sku === 'SKU-0003');
  assert(!!paper && !!stapler, 'stock products available', products.json);
  r = await api('POST', '/sales/orders', token2, {
    companyId: DEMO_CO,
    customerId: customer.id,
    orderDate: new Date().toISOString().slice(0, 10),
    currencyId: USD,
    warehouseId: MAIN_WH,
    lines: [
      {
        productId: paper.id,
        description: paper.name,
        quantity: 30,
        unitPrice: paper.standardCost,
      },
      {
        productId: stapler.id,
        description: stapler.name,
        quantity: 5,
        unitPrice: stapler.standardCost,
      },
    ],
  });
  assert(r.status === 201, 'sales order created', r.json);
  const order = r.json.data;

  // 6. Submit for approval
  r = await api('POST', `/sales/orders/${order.id}/submit`, token2, {});
  assert(r.status === 201, 'sales order submitted', r.json);
  assert(r.json.data?.status === 'PENDING_APPROVAL', 'status PENDING_APPROVAL', r.json.data);

  // 7. Approve via workflow inbox
  const inbox = await api('GET', '/workflow/approval-tasks?status=PENDING', token2);
  const tasks = inbox.json.data?.rows ?? inbox.json.data ?? [];
  const task = (Array.isArray(tasks) ? tasks : []).find(
    (t) => t.entityType === 'sales_order' && t.entityId === order.id,
  );
  assert(!!task, 'approval task found for order', inbox.json);
  r = await api('POST', `/workflow/approval-tasks/${task.id}/act`, token2, {
    decision: 'APPROVE',
  });
  assert(r.status === 201, 'approval acted', r.json);
  r = await api('GET', `/sales/orders/${order.id}`, token2);
  assert(r.json.data?.status === 'APPROVED', 'order APPROVED', r.json.data?.status);

  // 8. Delivery: full quantities from order lines
  const soFull = await api('GET', `/sales/orders/${order.id}`, token2);
  const lines = soFull.json.data.lines.map((l) => ({
    salesOrderLineId: l.id,
    quantity: Number(l.quantity),
  }));
  r = await api('POST', '/sales/deliveries', token2, {
    companyId: DEMO_CO,
    warehouseId: MAIN_WH,
    customerId: customer.id,
    salesOrderId: order.id,
    deliveryDate: new Date().toISOString().slice(0, 10),
    lines,
  });
  assert(r.status === 201, 'delivery posted', r.json);
  r = await api('GET', `/sales/orders/${order.id}`, token2);
  assert(r.json.data?.status === 'DELIVERED', 'order DELIVERED', r.json.data?.status);

  // 9. Invoice from the order, then post to AR
  const invLines = soFull.json.data.lines.map((l) => ({
    salesOrderLineId: l.id,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice).toFixed(2),
  }));
  r = await api('POST', '/sales/invoices', token2, {
    companyId: DEMO_CO,
    customerId: customer.id,
    salesOrderId: order.id,
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    currencyId: USD,
    lines: invLines,
  });
  assert(r.status === 201, 'invoice created', r.json);
  const invoice = r.json.data;
  r = await api('POST', `/sales/invoices/${invoice.id}/post`, token2, {});
  assert(r.status === 201, 'invoice posted', r.json);
  assert(r.json.data?.status === 'POSTED', 'invoice POSTED', r.json.data?.status);

  // 10. Receipt: pay half, then the rest
  const total = Number(invoice.grandTotal);
  const half = (total / 2).toFixed(2);
  r = await api('POST', '/sales/receipts', token2, {
    companyId: DEMO_CO,
    customerId: customer.id,
    receiptDate: new Date().toISOString().slice(0, 10),
    currencyId: invoice.currencyId,
    method: 'BANK_TRANSFER',
    allocations: [{ invoiceId: invoice.id, amount: half }],
  });
  assert(r.status === 201, 'receipt 1 posted', r.json);
  r = await api('GET', `/sales/invoices/${invoice.id}`, token2);
  assert(r.json.data?.status === 'PARTIALLY_PAID', 'invoice PARTIALLY_PAID', r.json.data?.status);

  const rest = (total - Number(half)).toFixed(2);
  r = await api('POST', '/sales/receipts', token2, {
    companyId: DEMO_CO,
    customerId: customer.id,
    receiptDate: new Date().toISOString().slice(0, 10),
    currencyId: invoice.currencyId,
    method: 'CASH',
    allocations: [{ invoiceId: invoice.id, amount: rest }],
  });
  assert(r.status === 201, 'receipt 2 posted', r.json);
  r = await api('GET', `/sales/invoices/${invoice.id}`, token2);
  assert(r.json.data?.status === 'PAID', 'invoice PAID', r.json.data?.status);

  // 11. Stock ledger: issues recorded with COGS
  r = await api('GET', '/inventory/movements?page=1&pageSize=10', token2);
  const issues = (r.json.data?.rows ?? []).filter((m) => m.movementType === 'ISSUE');
  assert(issues.length >= 2, 'ISSUE movements in ledger', issues.length);
  const withCost = issues.filter((m) => Number(m.unitCost) > 0);
  assert(withCost.length >= 2, 'issues carry weighted-average cost');

  console.log('\nQuote-to-cash flow VERIFIED end to end.');
}

main().catch((e) => {
  console.error('FLOW ERROR', e);
  process.exit(1);
});
