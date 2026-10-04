'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Alert, Button, StatusBadge } from '@erp/ui';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
}

const inputClass =
  'h-[38px] w-full rounded-md border border-[var(--erp-border)] bg-[var(--erp-surface)] px-3 text-sm';

function CreateUserDialog({
  onClose,
  roleOptions,
}: {
  onClose: () => void;
  roleOptions: Array<{ id: string; code: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post('/users', {
        email,
        displayName,
        password,
        roleIds: [roleId],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'Failed to create user');
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-user-title"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-5">
        <h2 id="create-user-title" className="mb-4 text-base font-semibold">
          Create User
        </h2>
        {error ? (
          <div className="mb-3">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <input
            aria-label="Email"
            placeholder="Email"
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            className={inputClass}
          />
          <input
            aria-label="Display name"
            placeholder="Display name"
            required
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
            className={inputClass}
          />
          <input
            aria-label="Temporary password"
            placeholder="Temporary password"
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            className={inputClass}
          />
          <select
            aria-label="Role"
            required
            value={roleId}
            onChange={(e) => {
              setRoleId(e.target.value);
            }}
            className={inputClass}
          >
            <option value="" disabled>
              Select role…
            </option>
            {roleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UsersPage() {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const rolesQuery = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiList<{ id: string; code: string; name: string }>('/roles?pageSize=200'),
  });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', page],
    queryFn: () => apiList<UserRow>(`/users?page=${page}&pageSize=25`),
  });

  const columns: Array<DataTableColumn<UserRow>> = [
    { key: 'email', header: 'Email', render: (u) => u.email },
    { key: 'displayName', header: 'Name', render: (u) => u.displayName },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage platform users and their roles."
        actions={
          <Button
            onClick={() => {
              setShowCreate(true);
            }}
          >
            Create user
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={usersQuery.data?.rows}
        loading={usersQuery.isLoading}
        error={usersQuery.error}
        total={usersQuery.data?.total}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        getRowKey={(u) => u.id}
        caption="Platform users"
      />
      {showCreate ? (
        <CreateUserDialog
          onClose={() => {
            setShowCreate(false);
          }}
          roleOptions={rolesQuery.data?.rows ?? []}
        />
      ) : null}
    </div>
  );
}
