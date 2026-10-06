'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { usePermissions } from '@/lib/auth';
import { Alert } from '@erp/ui';

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  debit: string;
  credit: string;
  balance: string;
}

interface TrialBalance {
  rows: TrialBalanceRow[];
  totals: { debit: string; credit: string };
  balanced: boolean;
}

interface AgingTotals {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90plus: string;
  open: string;
}

interface Aging {
  rows: Array<{ invoiceNo: string; dueDate: string; outstanding: string }>;
  totals: AgingTotals;
}

interface Statements {
  incomeStatement: { revenue: TrialBalanceRow[]; expenses: TrialBalanceRow[]; netIncome: string };
  balanceSheet: {
    assets: TrialBalanceRow[];
    liabilities: TrialBalanceRow[];
    equity: TrialBalanceRow[];
    retainedEarnings: string;
    totalEquity: string;
  };
}

function AgingCard({ title, data }: { title: string; data: Aging | undefined }) {
  if (!data) return null;
  const t = data.totals;
  return (
    <section className="rounded-lg border border-[var(--erp-border)] erp-frost p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
        {[
          ['Current', t.current],
          ['1–30', t.d1_30],
          ['31–60', t.d31_60],
          ['61–90', t.d61_90],
          ['90+', t.d90plus],
          ['Open', t.open],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-[var(--erp-border)] p-2">
            <div className="text-[var(--erp-muted)]">{label}</div>
            <div className="font-medium">{value}</div>
          </div>
        ))}
      </div>
      {data.rows.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-[var(--erp-muted)]">
          {data.rows.slice(0, 5).map((r) => (
            <li key={r.invoiceNo}>
              {r.invoiceNo} — due {new Date(r.dueDate).toLocaleDateString()} — {r.outstanding}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-[var(--erp-muted)]">Nothing open.</p>
      )}
    </section>
  );
}

/** GL reports (PRD Stage 8): trial balance, statements, AR/AP aging. */
export default function AccountingReportsPage() {
  const { can } = usePermissions();
  const canView = can('accounting.journal.view');

  const tbQuery = useQuery({
    queryKey: ['accounting-trial-balance'],
    queryFn: () => api.get<TrialBalance>('/accounting/trial-balance'),
    enabled: canView,
  });

  const stmtQuery = useQuery({
    queryKey: ['accounting-statements'],
    queryFn: () => api.get<Statements>('/accounting/statements'),
    enabled: canView,
  });

  const arQuery = useQuery({
    queryKey: ['accounting-ar-aging'],
    queryFn: () => api.get<Aging>('/accounting/ar-aging'),
    enabled: can('accounting.ar.view'),
  });

  const apQuery = useQuery({
    queryKey: ['accounting-ap-aging'],
    queryFn: () => api.get<Aging>('/accounting/ap-aging'),
    enabled: can('accounting.ap.view'),
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="GL reports" description="Trial balance and financial statements." />
        <Alert tone="error" title="No access">
          You do not have permission to view accounting reports.
        </Alert>
      </div>
    );
  }

  const stmt = stmtQuery.data;

  return (
    <div>
      <PageHeader
        title="GL reports"
        description="Trial balance over posted journals; statements derive from it."
      />
      {tbQuery.error ? (
        <Alert tone="error" title="Error">
          {tbQuery.error instanceof Error ? tbQuery.error.message : 'Failed to load'}
        </Alert>
      ) : null}

      <section className="mb-6 rounded-lg border border-[var(--erp-border)] erp-frost p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Trial balance</h3>
          <span
            className={`text-xs ${tbQuery.data?.balanced ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {tbQuery.data ? (tbQuery.data.balanced ? 'Balanced' : 'OUT OF BALANCE') : ''}
          </span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--erp-muted)]">
              <th className="py-1">Code</th>
              <th className="py-1">Account</th>
              <th className="py-1">Type</th>
              <th className="py-1 text-right">Debit</th>
              <th className="py-1 text-right">Credit</th>
              <th className="py-1 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(tbQuery.data?.rows ?? []).map((r) => (
              <tr key={r.accountId} className="border-t border-[var(--erp-border)]">
                <td className="py-1">{r.accountCode}</td>
                <td className="py-1">{r.accountName}</td>
                <td className="py-1">{r.accountType}</td>
                <td className="py-1 text-right">{r.debit}</td>
                <td className="py-1 text-right">{r.credit}</td>
                <td className="py-1 text-right font-medium">{r.balance}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--erp-border)] font-medium">
              <td className="py-1" colSpan={3}>
                Totals
              </td>
              <td className="py-1 text-right">{tbQuery.data?.totals.debit}</td>
              <td className="py-1 text-right">{tbQuery.data?.totals.credit}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      {stmt ? (
        <section className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--erp-border)] erp-frost p-4">
            <h3 className="mb-2 text-sm font-semibold">Income statement</h3>
            {stmt.incomeStatement.revenue.map((r) => (
              <div key={r.accountId} className="flex justify-between text-xs">
                <span>{r.accountName}</span>
                <span>{r.balance}</span>
              </div>
            ))}
            {stmt.incomeStatement.expenses.map((r) => (
              <div
                key={r.accountId}
                className="flex justify-between text-xs text-[var(--erp-muted)]"
              >
                <span>{r.accountName}</span>
                <span>-{r.balance}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-[var(--erp-border)] pt-2 text-sm font-semibold">
              <span>Net income</span>
              <span>{stmt.incomeStatement.netIncome}</span>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--erp-border)] erp-frost p-4">
            <h3 className="mb-2 text-sm font-semibold">Balance sheet</h3>
            {stmt.balanceSheet.assets.map((r) => (
              <div key={r.accountId} className="flex justify-between text-xs">
                <span>{r.accountName}</span>
                <span>{r.balance}</span>
              </div>
            ))}
            {stmt.balanceSheet.liabilities.map((r) => (
              <div
                key={r.accountId}
                className="flex justify-between text-xs text-[var(--erp-muted)]"
              >
                <span>{r.accountName}</span>
                <span>{r.balance}</span>
              </div>
            ))}
            {stmt.balanceSheet.equity.map((r) => (
              <div
                key={r.accountId}
                className="flex justify-between text-xs text-[var(--erp-muted)]"
              >
                <span>{r.accountName}</span>
                <span>{r.balance}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs text-[var(--erp-muted)]">
              <span>Retained earnings (net income)</span>
              <span>{stmt.balanceSheet.retainedEarnings}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-[var(--erp-border)] pt-2 text-sm font-semibold">
              <span>Total equity</span>
              <span>{stmt.balanceSheet.totalEquity}</span>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <AgingCard title="Accounts receivable aging" data={arQuery.data} />
        <AgingCard title="Accounts payable aging" data={apQuery.data} />
      </div>
    </div>
  );
}
