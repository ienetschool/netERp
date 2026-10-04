'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiList } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { useAuth, usePermissions } from '@/lib/auth';
import { Alert, StatusBadge } from '@erp/ui';

interface Participant {
  userId: string;
  role: string;
  lastReadAt: string | null;
}

interface LastMessage {
  id: string;
  senderUserId: string;
  content: string;
  messageType: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  companyId: string;
  type: string;
  name: string | null;
  createdById: string;
  lastMessageAt: string | null;
  createdAt: string;
  participants: Participant[];
  messages: LastMessage[];
  unreadCount: number;
}

interface Message {
  id: string;
  conversationId: string;
  senderUserId: string;
  messageType: string;
  content: string;
  documentId: string | null;
  createdAt: string;
  editedAt: string | null;
}

interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
}

interface CompanyOption {
  id: string;
  code: string;
  name: string;
}

const EMPTY_FORM = {
  companyId: '',
  type: 'DIRECT' as 'DIRECT' | 'GROUP',
  name: '',
  recipientId: '',
  memberIds: [] as string[],
};

/** Chat (PRD Stage 10; DATA-MODEL §22, USER-FLOWS §19.1). */
export default function ChatPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { principal } = useAuth();
  const myUserId = principal?.userId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showCreate, setShowCreate] = useState(false);

  const canCreate = can('communication.chat.create');
  const canEdit = can('communication.chat.edit');

  const listQuery = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () =>
      api.get<{ rows: Conversation[]; total: number }>('/chat/conversations?pageSize=100'),
  });

  const companiesQuery = useQuery({
    queryKey: ['companies-options'],
    queryFn: () => apiList<CompanyOption>('/companies?pageSize=200'),
  });

  const companyId = form.companyId || (companiesQuery.data?.rows[0]?.id ?? '');
  const directoryQuery = useQuery({
    queryKey: ['chat-directory', companyId],
    queryFn: () =>
      api.get<{ rows: DirectoryUser[]; total: number }>(
        `/chat/directory?companyId=${encodeURIComponent(companyId)}`,
      ),
    enabled: Boolean(companyId),
  });

  const directory = directoryQuery.data?.rows ?? [];
  const nameOf = useMemo(() => {
    const map = new Map(directory.map((u) => [u.id, u.displayName]));
    return (userId: string): string => map.get(userId) ?? userId.slice(0, 8);
  }, [directory]);

  const selected = (listQuery.data?.rows ?? []).find((c) => c.id === selectedId) ?? null;

  // Direct chats have no name: show the other members, never the viewer.
  const labelFor = (c: Conversation): string => {
    if (c.name) return c.name;
    const others = c.participants
      .map((p) => (p.userId === myUserId ? 'You' : nameOf(p.userId)))
      .filter((n) => n !== 'You');
    return others.length > 0 ? others.join(', ') : 'Conversation';
  };

  const messagesQuery = useQuery({
    queryKey: ['chat-messages', selectedId],
    queryFn: () =>
      api.get<{ rows: Message[]; total: number }>(
        `/chat/conversations/${selectedId}/messages?pageSize=200`,
      ),
    enabled: Boolean(selectedId),
  });

  // Opening a conversation advances the read cursor (USER-FLOWS §19.1).
  useEffect(() => {
    if (!selectedId) return;
    void api.post(`/chat/conversations/${selectedId}/read`, {}).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    });
  }, [selectedId, queryClient]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['chat-messages', selectedId] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const participantUserIds =
        form.type === 'GROUP' ? form.memberIds : form.recipientId ? [form.recipientId] : [];
      const created = await api.post<{ id: string }>('/chat/conversations', {
        companyId,
        type: form.type,
        ...(form.type === 'GROUP' ? { name: form.name } : {}),
        participantUserIds,
      });
      return created;
    },
    onSuccess: (created) => {
      setError(null);
      setShowCreate(false);
      setForm({ ...EMPTY_FORM, companyId });
      invalidate();
      setSelectedId(created.id);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Conversation creation failed');
    },
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      api.post(`/chat/conversations/${selectedId}/messages`, { content }),
    onSuccess: () => {
      setError(null);
      setDraft('');
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Message failed to send');
    },
  });

  const addParticipantMutation = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/chat/conversations/${selectedId}/participants`, { userId }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Adding the participant failed');
    },
  });

  const alreadyMember = (userId: string): boolean =>
    selected?.participants.some((p) => p.userId === userId) ?? false;
  const amOwner =
    selected != null &&
    selected.participants.some((p) => p.userId === myUserId && p.role === 'OWNER');

  const toggleMember = (userId: string) => {
    setForm({
      ...form,
      memberIds: form.memberIds.includes(userId)
        ? form.memberIds.filter((id) => id !== userId)
        : [...form.memberIds, userId],
    });
  };

  return (
    <div>
      <PageHeader
        title="Chat"
        description="Conversations, messages and unread tracking (in-app; external channels are handled by the worker)."
      />
      {error ? (
        <Alert tone="error" title="Error">
          {error}
        </Alert>
      ) : null}

      {canCreate ? (
        <div className="mb-4">
          <button
            type="button"
            className="rounded-md border border-[var(--erp-border)] px-3 py-2 text-sm font-medium"
            onClick={() => {
              setShowCreate((v) => !v);
              setForm({ ...EMPTY_FORM, companyId });
            }}
          >
            {showCreate ? 'Cancel' : 'New conversation'}
          </button>
        </div>
      ) : null}

      {showCreate && canCreate ? (
        <form
          className="mb-6 grid gap-3 rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)] p-4 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={companyId}
            onChange={(e) => {
              setForm({ ...form, companyId: e.target.value, memberIds: [], recipientId: '' });
            }}
          >
            {(companiesQuery.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
            value={form.type}
            onChange={(e) => {
              setForm({ ...form, type: e.target.value as 'DIRECT' | 'GROUP' });
            }}
          >
            <option value="DIRECT">Direct</option>
            <option value="GROUP">Group</option>
          </select>
          {form.type === 'GROUP' ? (
            <input
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              placeholder="Group name"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
              }}
              required
            />
          ) : (
            <select
              className="rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
              value={form.recipientId}
              onChange={(e) => {
                setForm({ ...form, recipientId: e.target.value });
              }}
              required
            >
              <option value="">Recipient…</option>
              {directory.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={createMutation.isPending}
          >
            Create
          </button>

          {form.type === 'GROUP' ? (
            <div className="md:col-span-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--erp-muted)]">
                Participants
              </p>
              <div className="flex flex-wrap gap-1">
                {directory.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      toggleMember(u.id);
                    }}
                    className={`rounded-full border px-2 py-1 text-xs ${
                      form.memberIds.includes(u.id)
                        ? 'border-[var(--erp-accent)] bg-[var(--erp-accent)] text-white'
                        : 'border-[var(--erp-border)]'
                    }`}
                  >
                    {u.displayName}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </form>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
          <p className="border-b border-[var(--erp-border)] px-3 py-2 text-sm font-medium">
            Conversations
          </p>
          {listQuery.isLoading ? (
            <p className="px-3 py-4 text-sm">Loading…</p>
          ) : listQuery.error ? (
            <p className="px-3 py-4 text-sm text-red-600">
              {listQuery.error instanceof Error ? listQuery.error.message : 'Failed to load'}
            </p>
          ) : (listQuery.data?.rows ?? []).length === 0 ? (
            <p className="px-3 py-4 text-sm">No conversations yet.</p>
          ) : (
            <ul>
              {(listQuery.data?.rows ?? []).map((c) => {
                const label = labelFor(c);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(c.id);
                      }}
                      className={`flex w-full items-start justify-between gap-2 border-b border-[var(--erp-border)] px-3 py-2 text-left last:border-b-0 ${
                        selectedId === c.id ? 'bg-[var(--erp-bg)]' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{label}</span>
                        <span className="block truncate text-xs text-[var(--erp-muted)]">
                          {c.messages[0]?.content ?? 'No messages yet'}
                        </span>
                      </span>
                      {c.unreadCount > 0 ? (
                        <span className="rounded-full bg-[var(--erp-accent)] px-2 py-0.5 text-xs font-medium text-white">
                          {c.unreadCount}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-[var(--erp-border)] bg-[var(--erp-surface)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--erp-border)] px-3 py-2">
            <p className="text-sm font-medium">
              {selected ? labelFor(selected) : 'Select a conversation'}
            </p>
            {selected ? (
              <span className="flex items-center gap-2">
                <StatusBadge status={selected.type} />
                {canEdit && amOwner && selected.type === 'GROUP' ? (
                  <select
                    className="rounded border border-[var(--erp-border)] bg-[var(--erp-bg)] px-1 py-1 text-xs"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addParticipantMutation.mutate(e.target.value);
                    }}
                  >
                    <option value="">Add person…</option>
                    {directory
                      .filter((u) => !alreadyMember(u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                  </select>
                ) : null}
              </span>
            ) : null}
          </div>

          <div className="max-h-[420px] min-h-[220px] overflow-y-auto p-3">
            {!selected ? (
              <p className="text-sm text-[var(--erp-muted)]">
                Pick a conversation on the left to read and reply.
              </p>
            ) : messagesQuery.isLoading ? (
              <p className="text-sm">Loading messages…</p>
            ) : messagesQuery.error ? (
              <p className="text-sm text-red-600">
                {messagesQuery.error instanceof Error
                  ? messagesQuery.error.message
                  : 'Failed to load messages'}
              </p>
            ) : (messagesQuery.data?.rows ?? []).length === 0 ? (
              <p className="text-sm text-[var(--erp-muted)]">No messages yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(messagesQuery.data?.rows ?? []).map((m) => {
                  const mine = m.senderUserId === myUserId;
                  return (
                    <li
                      key={m.id}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        mine
                          ? 'border-[var(--erp-accent)]/40 bg-[var(--erp-bg)]'
                          : 'border-[var(--erp-border)]'
                      }`}
                    >
                      <p className="mb-0.5 text-xs font-medium text-[var(--erp-muted)]">
                        {nameOf(m.senderUserId)} · {new Date(m.createdAt).toLocaleString()}
                        {m.messageType !== 'TEXT' ? ` · ${m.messageType}` : ''}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {selected && canCreate ? (
            <form
              className="flex gap-2 border-t border-[var(--erp-border)] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const content = draft.trim();
                if (content) sendMutation.mutate(content);
              }}
            >
              <input
                className="flex-1 rounded-md border border-[var(--erp-border)] bg-[var(--erp-bg)] px-3 py-2 text-sm"
                placeholder="Write a message…"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
              />
              <button
                type="submit"
                className="rounded-md bg-[var(--erp-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={sendMutation.isPending || draft.trim().length === 0}
              >
                Send
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
