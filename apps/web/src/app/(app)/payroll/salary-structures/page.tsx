'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface ComponentRow {
  code: string;
  name: string;
  type: string;
  calculationMethod: string;
  value: string | null;
  percentage: string | null;
  taxable: boolean;
}

interface StructureRow {
  id: string;
  companyId: string;
  name: string;
  status: string;
  currency: { code: string };
  components: ComponentRow[];
  _count: { assignments: number };
}

interface AssignmentRow {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  baseSalary: string;
  status: string;
  employee: { employeeNo: string; displayName: string };
  salaryStructure: { name: string };
  currency: { code: string };
}

interface EmployeeOption {
  id: string;
  employeeNo: string;
  displayName: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
  baseCurrencyId: string | null;
}

const EMPTY_COMPONENT = {
  code: '',
  name: '',
  type: 'EARNING',
  calculationMethod: 'FLAT',
  value: '',
  percentage: '',
  taxable: true,
};

const EMPTY_FORM = { companyId: '', name: '', components: [{ ...EMPTY_COMPONENT }] };
const EMPTY_ASSIGNMENT = {
  employeeId: '',
  salaryStructureId: '',
  effectiveFrom: '',
  baseSalary: '',
};

/** Salary structures (PRD Stage 4): earning/deduction/employer components and effective-dated assignments. */
export default function SalaryStructuresPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [assignment, setAssignment] = useState(EMPTY_ASSIGNMENT);

  const canCreate = can('payroll.salary_structure.create');
  const canAssign = can('payroll.salary_structure.assign');

  const listQuery = useQuery({
    queryKey: ['payroll-structures'],
    queryFn: () => api.get<StructureRow[]>('/payroll/salary-structures'),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['payroll-assignments'],
    queryFn: () =>
      api.get<{ rows: AssignmentRow[]; total: number }>(
        '/payroll/salary-assignments?page=1&pageSize=50',
      ),
  });

  const employeesQuery = useQuery({
    queryKey: ['hr-employees-options'],
    queryFn: () => api.get<{ rows: EmployeeOption[] }>('/hr/employees?page=1&pageSize=200'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => api.get<CompanyOption[]>('/companies'),
  });

  const invalidate = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['payroll-structures'] });
    void queryClient.invalidateQueries({ queryKey: ['payroll-assignments'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) => {
      const company = (companiesQuery.data ?? []).find((c) => c.id === payload.companyId);
      return api.post('/payroll/salary-structures', {
        companyId: payload.companyId,
        name: payload.name,
        currencyId: company?.baseCurrencyId,
        components: payload.components.map((c) => ({
          code: c.code.toUpperCase(),
          name: c.name,
          type: c.type,
          calculationMethod: c.calculationMethod,
          ...(c.calculationMethod === 'FLAT' ? { value: c.value } : { percentage: c.percentage }),
          taxable: c.taxable,
        })),
      });
    },
    onSuccess: () => {
      setForm(EMPTY_FORM);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Create failed');
    },
  });

  const assignMutation = useMutation({
    mutationFn: (payload: typeof EMPTY_ASSIGNMENT) =>
      api.post('/payroll/salary-assignments', payload),
    onSuccess: () => {
      setAssignment(EMPTY_ASSIGNMENT);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Assignment failed');
    },
  });

  const structureColumns: Array<DataTableColumn<StructureRow>> = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'currency', header: 'Currency', render: (r) => r.currency.code },
    {
      key: 'components',
      header: 'Components',
      render: (r) =>
        r.components
          .map((c) => {
            const detail =
              c.calculationMethod === 'FLAT'
                ? `flat ${c.value ?? '0'}`
                : `${c.percentage ?? '0'}% of base`;
            return `${c.code} (${detail})`;
          })
          .join(', '),
    },
    { key: 'assignments', header: 'Assignments', render: (r) => String(r._count.assignments) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const assignmentColumns: Array<DataTableColumn<AssignmentRow>> = [
    {
      key: 'employee',
      header: 'Employee',
      render: (r) => `${r.employee.displayName} (${r.employee.employeeNo})`,
    },
    { key: 'structure', header: 'Structure', render: (r) => r.salaryStructure.name },
    { key: 'baseSalary', header: 'Base salary', render: (r) => r.baseSalary },
    { key: 'currency', header: 'CCY', render: (r) => r.currency.code },
    {
      key: 'effective',
      header: 'Effective',
      render: (r) =>
        `${new Date(r.effectiveFrom).toLocaleDateString()} – ${
          r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString() : 'open'
        }`,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Salary structures"
        description="Pay components (earnings, deductions, employer contributions) and effective-dated salary assignments. Compensation data is permission-controlled."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <form
          className="mb-6 space-y-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <select
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.companyId}
              onChange={(e) => {
                setForm({ ...form, companyId: e.target.value });
              }}
              required
            >
              <option value="">Company…</option>
              {(companiesQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <input
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              placeholder="Structure name (e.g. Standard Staff)"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
              }}
              required
            />
          </div>
          <div className="space-y-2">
            {form.components.map((c, i) => (
              <div key={i} className="grid items-center gap-2 md:grid-cols-7">
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  placeholder="CODE"
                  value={c.code}
                  onChange={(e) => {
                    const components = [...form.components];
                    components[i] = { ...c, code: e.target.value };
                    setForm({ ...form, components });
                  }}
                  required
                />
                <input
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  placeholder="Name"
                  value={c.name}
                  onChange={(e) => {
                    const components = [...form.components];
                    components[i] = { ...c, name: e.target.value };
                    setForm({ ...form, components });
                  }}
                  required
                />
                <select
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  value={c.type}
                  onChange={(e) => {
                    const components = [...form.components];
                    components[i] = { ...c, type: e.target.value };
                    setForm({ ...form, components });
                  }}
                >
                  <option value="EARNING">Earning</option>
                  <option value="DEDUCTION">Deduction</option>
                  <option value="EMPLOYER_CONTRIBUTION">Employer contribution</option>
                </select>
                <select
                  className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                  value={c.calculationMethod}
                  onChange={(e) => {
                    const components = [...form.components];
                    components[i] = { ...c, calculationMethod: e.target.value };
                    setForm({ ...form, components });
                  }}
                >
                  <option value="FLAT">Flat amount</option>
                  <option value="PERCENT_OF_BASE">% of base</option>
                </select>
                {c.calculationMethod === 'FLAT' ? (
                  <input
                    className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                    placeholder="Amount e.g. 150.00"
                    value={c.value}
                    onChange={(e) => {
                      const components = [...form.components];
                      components[i] = { ...c, value: e.target.value };
                      setForm({ ...form, components });
                    }}
                    required
                  />
                ) : (
                  <input
                    className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-2 py-1.5 text-xs"
                    placeholder="Percent e.g. 25"
                    value={c.percentage}
                    onChange={(e) => {
                      const components = [...form.components];
                      components[i] = { ...c, percentage: e.target.value };
                      setForm({ ...form, components });
                    }}
                    required
                  />
                )}
                <label className="flex items-center gap-1 text-xs text-[var(--erp-muted)]">
                  <input
                    type="checkbox"
                    checked={c.taxable}
                    onChange={(e) => {
                      const components = [...form.components];
                      components[i] = { ...c, taxable: e.target.checked };
                      setForm({ ...form, components });
                    }}
                  />
                  Taxable
                </label>
                <button
                  type="button"
                  className="text-xs text-[var(--erp-muted)] disabled:opacity-30"
                  disabled={form.components.length === 1}
                  onClick={() => {
                    setForm({
                      ...form,
                      components: form.components.filter((_, j) => j !== i),
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="rounded-md border border-[var(--erp-border)] px-3 py-1.5 text-xs"
              onClick={() => {
                setForm({
                  ...form,
                  components: [...form.components, { ...EMPTY_COMPONENT }],
                });
              }}
            >
              Add component
            </button>
          </div>
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending || !form.companyId}
          >
            Create salary structure
          </button>
        </form>
      ) : null}

      <DataTable
        columns={structureColumns}
        rows={listQuery.data}
        loading={listQuery.isLoading}
        error={listQuery.error}
        getRowKey={(r) => r.id}
        caption="Salary structures"
      />

      {canAssign ? (
        <form
          className="mt-8 mb-4 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            assignMutation.mutate(assignment);
          }}
        >
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={assignment.employeeId}
            onChange={(e) => {
              setAssignment({ ...assignment, employeeId: e.target.value });
            }}
            required
          >
            <option value="">Employee…</option>
            {(employeesQuery.data?.rows ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName} ({e.employeeNo})
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={assignment.salaryStructureId}
            onChange={(e) => {
              setAssignment({ ...assignment, salaryStructureId: e.target.value });
            }}
            required
          >
            <option value="">Structure…</option>
            {(listQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            type="date"
            value={assignment.effectiveFrom}
            onChange={(e) => {
              setAssignment({ ...assignment, effectiveFrom: e.target.value });
            }}
            required
          />
          <input
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            placeholder="Base salary e.g. 4500.00"
            value={assignment.baseSalary}
            onChange={(e) => {
              setAssignment({ ...assignment, baseSalary: e.target.value });
            }}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={assignMutation.isPending}
          >
            Assign salary
          </button>
        </form>
      ) : null}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Salary assignments</h2>
      <DataTable
        columns={assignmentColumns}
        rows={assignmentsQuery.data?.rows}
        loading={assignmentsQuery.isLoading}
        error={assignmentsQuery.error}
        total={assignmentsQuery.data?.total}
        getRowKey={(r) => r.id}
        caption="Salary assignments"
      />
    </div>
  );
}
