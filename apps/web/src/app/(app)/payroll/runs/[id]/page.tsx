'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface PayrollException {
  employeeNo: string | null;
  employeeName: string;
  reason: string;
}

interface PayrollLineRow {
  id: string;
  description: string;
  quantity: string;
  rate: string;
  amount: string;
  taxable: boolean;
  salaryComponent: { code: string; name: string; type: string };
}

interface PayrollEntryRow {
  id: string;
  employeeId: string;
  grossAmount: string;
  deductionAmount: string;
  netAmount: string;
  employerCost: string;
  status: string;
  employee: { employeeNo: string; displayName: string };
  lines: PayrollLineRow[];
}

interface PayrollRunDetail {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  paymentDate: string;
  employeeCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  totalEmployerCost: string;
  exceptions: PayrollException[] | null;
  workflowInstanceId: string | null;
  payGroup: { name: string; frequency: string };
  currency: { code: string };
  entries: PayrollEntryRow[];
}

/** Payroll run detail (PRD Stage 4): payslips, exceptions and lifecycle actions. */
export default function PayrollRunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  const runQuery = useQuery({
    queryKey: ['payroll-run', runId],
    queryFn: () => api.get<PayrollRunDetail>(`/payroll/runs/${runId}`),
    enabled: Boolean(runId),
  });

  const invalidate = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['payroll-run', runId] });
    void queryClient.invalidateQueries({ queryKey: ['payroll-runs'] });
  };

  const actionMutation = useMutation({
    mutationFn: ({ action }: { action: 'calculate' | 'submit' | 'approve' | 'post' | 'cancel' }) =>
      api.post(`/payroll/runs/${runId}/${action}`, {}),
    onSuccess: invalidate,
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Action failed');
    },
  });

  const run = runQuery.data;
  const canCalculate = can('payroll.payroll_run.edit');
  const canSubmit = can('payroll.payroll_run.submit');
  const canApprove = can('payroll.payroll_run.approve');
  const canPost = can('payroll.payroll_run.post');
  const canCancel = can('payroll.payroll_run.cancel');

  const entryColumns: Array<DataTableColumn<PayrollEntryRow>> = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => `${r.employee.displayName} (${r.employee.employeeNo})`,
    },
    { key: 'grossAmount', header: 'Gross', render: (r) => r.grossAmount },
    { key: 'deductionAmount', header: 'Deductions', render: (r) => r.deductionAmount },
    { key: 'netAmount', header: 'Net pay', render: (r) => r.netAmount },
    { key: 'employerCost', header: 'Employer cost', render: (r) => r.employerCost },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'lines',
      header: 'Payslip',
      render: (r) => (
        <button
          className="text-xs text-[var(--erp-accent)]"
          onClick={() => {
            setOpenEntryId((v) => (v === r.id ? null : r.id));
          }}
        >
          {openEntryId === r.id ? 'Hide lines' : 'Show lines'}
        </button>
      ),
    },
  ];

  const openEntry = (run?.entries ?? []).find((e) => e.id === openEntryId);

  return (
    <div>
      <PageHeader
        title={`Payroll run · ${run?.payGroup.name ?? ''}`}
        description={
          run
            ? `${new Date(run.periodStart).toLocaleDateString()} – ${new Date(
                run.periodEnd,
              ).toLocaleDateString()} · payment ${new Date(run.paymentDate).toLocaleDateString()} · ${run.currency.code}`
            : 'Loading…'
        }
        actions={
          <span className="flex gap-2">
            {run && canCalculate && (run.status === 'DRAFT' || run.status === 'CALCULATED') ? (
              <button
                className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={actionMutation.isPending}
                onClick={() => {
                  actionMutation.mutate({ action: 'calculate' });
                }}
              >
                Calculate
              </button>
            ) : null}
            {run && canSubmit && run.status === 'CALCULATED' ? (
              <button
                className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={actionMutation.isPending}
                onClick={() => {
                  actionMutation.mutate({ action: 'submit' });
                }}
              >
                Submit for approval
              </button>
            ) : null}
            {run && canApprove && run.status === 'PENDING_APPROVAL' && !run.workflowInstanceId ? (
              <button
                className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={actionMutation.isPending}
                onClick={() => {
                  actionMutation.mutate({ action: 'approve' });
                }}
              >
                Approve
              </button>
            ) : null}
            {run && canPost && run.status === 'APPROVED' ? (
              <button
                className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={actionMutation.isPending}
                onClick={() => {
                  actionMutation.mutate({ action: 'post' });
                }}
              >
                Post
              </button>
            ) : null}
            {run &&
            canCancel &&
            (run.status === 'DRAFT' ||
              run.status === 'CALCULATED' ||
              run.status === 'PENDING_APPROVAL') ? (
              <button
                className="rounded-md border border-[var(--erp-border)] px-3 py-2 text-sm disabled:opacity-50"
                disabled={actionMutation.isPending}
                onClick={() => {
                  actionMutation.mutate({ action: 'cancel' });
                }}
              >
                Cancel run
              </button>
            ) : null}
          </span>
        }
      />
      {error ? (
        <Alert tone="error" title="Action failed">
          {error}
        </Alert>
      ) : null}

      {run ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            {(
              [
                ['Employees', String(run.employeeCount)],
                ['Gross', run.totalGross],
                ['Deductions', run.totalDeductions],
                ['Net', run.totalNet],
                ['Employer cost', run.totalEmployerCost],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-3"
              >
                <p className="text-xs text-[var(--erp-muted)]">{label}</p>
                <p className="text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div className="mb-4 flex items-center gap-2">
            <StatusBadge status={run.status} />
            <span className="text-xs text-[var(--erp-muted)]">
              {run.workflowInstanceId
                ? 'Approval runs through the finance approval inbox.'
                : 'No workflow attached; approvals are permission-gated here.'}
            </span>
          </div>

          {run.exceptions && run.exceptions.length > 0 ? (
            <div className="mb-6 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4">
              <p className="mb-2 text-sm font-semibold">Exceptions ({run.exceptions.length})</p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--erp-muted)]">
                {run.exceptions.map((x, i) => (
                  <li key={i}>
                    {x.employeeName}
                    {x.employeeNo ? ` (${x.employeeNo})` : ''} — {x.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h2 className="mb-2 text-sm font-semibold">Employees (payslips)</h2>
          <DataTable
            columns={entryColumns}
            rows={run.entries}
            loading={runQuery.isLoading}
            error={runQuery.error}
            getRowKey={(r) => r.id}
            caption="Payroll entries"
          />

          {openEntry ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">
                Payslip lines · {openEntry.employee.displayName}
              </h3>
              <ul className="divide-y divide-[var(--erp-border)] overflow-hidden rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] text-sm">
                {openEntry.lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-4 py-2">
                    <span>
                      {l.salaryComponent.name}{' '}
                      <span className="text-xs text-[var(--erp-muted)]">
                        ({l.salaryComponent.type.replaceAll('_', ' ').toLowerCase()}
                        {l.taxable ? ', taxable' : ''})
                      </span>
                    </span>
                    <span className="font-medium">{l.amount}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
