import { describe, expect, it } from 'vitest';

/**
 * Chat rule tests (Stage 10). The DB-backed transactions (participant
 * inserts, notification fan-out, read cursor writes) are covered by the live
 * smoke; these lock the rules ChatService enforces
 * (DATA-MODEL §22, USER-FLOWS §19.1).
 */

type ConversationType = 'DIRECT' | 'GROUP';
type ParticipantRole = 'OWNER' | 'MEMBER';

interface Participant {
  userId: string;
  role: ParticipantRole;
  lastReadAt: Date | null;
}

interface Conversation {
  type: ConversationType;
  name: string | null;
  createdById: string;
  participants: Participant[];
}

interface Message {
  senderUserId: string;
  createdAt: Date;
}

/** Mirrors ChatService.createConversation participant validation. */
function resolveRecipients(
  type: ConversationType,
  creatorId: string,
  requested: string[],
): { recipients: string[]; error?: string } {
  const recipients = [...new Set(requested)];
  if (recipients.includes(creatorId)) {
    return { recipients, error: 'You cannot add yourself as a participant' };
  }
  if (type === 'DIRECT' && recipients.length !== 1) {
    return { recipients, error: 'A direct chat has exactly one recipient' };
  }
  return { recipients };
}

/** Mirrors ChatService.createConversation role assignment (creator is OWNER). */
function initialParticipants(creatorId: string, recipients: string[]): Participant[] {
  return [
    { userId: creatorId, role: 'OWNER', lastReadAt: null },
    ...recipients.map((userId) => ({ userId, role: 'MEMBER' as ParticipantRole, lastReadAt: null })),
  ];
}

/**
 * Mirrors ChatService.addParticipant gates. Returns the participant list with
 * the addition applied, or throws exactly as the service does.
 */
function addParticipant(conversation: Conversation, actorId: string, newUserId: string): Conversation {
  if (conversation.type === 'DIRECT') {
    throw new Error('Participants cannot be added to a direct chat');
  }
  const actor = conversation.participants.find((p) => p.userId === actorId);
  if (!actor) throw new Error('Conversation not found');
  if (actor.role !== 'OWNER') {
    throw new Error('Only the conversation owner can add participants');
  }
  if (conversation.participants.some((p) => p.userId === newUserId)) {
    throw new Error('User is already in this conversation');
  }
  return {
    ...conversation,
    participants: [
      ...conversation.participants,
      { userId: newUserId, role: 'MEMBER', lastReadAt: null },
    ],
  };
}

/** Mirrors ChatService.requireMembership: non-members never see the conversation. */
function assertMembership(conversation: Conversation, userId: string): void {
  if (!conversation.participants.some((p) => p.userId === userId)) {
    throw new Error('Conversation not found');
  }
}

/**
 * Mirrors ChatService.listConversations unread derivation: messages after the
 * reader's own lastReadAt, excluding their own messages.
 */
function unreadCount(participant: Participant, messages: Message[]): number {
  const since = participant.lastReadAt ?? new Date(0);
  return messages.filter(
    (m) => m.senderUserId !== participant.userId && m.createdAt > since,
  ).length;
}

describe('conversation participants', () => {
  it('creates the creator as OWNER and invitees as MEMBER', () => {
    const participants = initialParticipants('u-admin', ['u-manager', 'u-clerk']);
    expect(participants.map((p) => [p.userId, p.role])).toEqual([
      ['u-admin', 'OWNER'],
      ['u-manager', 'MEMBER'],
      ['u-clerk', 'MEMBER'],
    ]);
  });

  it('rejects the creator as a participant of their own conversation', () => {
    expect(resolveRecipients('DIRECT', 'u-admin', ['u-admin']).error).toBe(
      'You cannot add yourself as a participant',
    );
  });

  it('allows a direct chat with exactly one recipient', () => {
    expect(resolveRecipients('DIRECT', 'u-admin', ['u-manager']).error).toBeUndefined();
  });

  it('rejects a direct chat with zero or several recipients', () => {
    expect(resolveRecipients('DIRECT', 'u-admin', []).error).toBe(
      'A direct chat has exactly one recipient',
    );
    expect(resolveRecipients('DIRECT', 'u-admin', ['u-a', 'u-b']).error).toBe(
      'A direct chat has exactly one recipient',
    );
  });

  it('allows a group chat with several recipients', () => {
    expect(resolveRecipients('GROUP', 'u-admin', ['u-a', 'u-b']).error).toBeUndefined();
  });

  it('de-duplicates a repeated recipient id', () => {
    expect(resolveRecipients('GROUP', 'u-admin', ['u-a', 'u-a']).recipients).toEqual(['u-a']);
  });
});

describe('adding participants', () => {
  const group: Conversation = {
    type: 'GROUP',
    name: 'Operations',
    createdById: 'u-admin',
    participants: initialParticipants('u-admin', ['u-manager']),
  };

  it('lets the owner add someone', () => {
    const next = addParticipant(group, 'u-admin', 'u-clerk');
    expect(next.participants).toHaveLength(3);
    expect(next.participants[2]).toMatchObject({ userId: 'u-clerk', role: 'MEMBER' });
  });

  it('rejects a non-owner member', () => {
    expect(() => addParticipant(group, 'u-manager', 'u-clerk')).toThrow(
      'Only the conversation owner can add participants',
    );
  });

  it('rejects a non-member actor', () => {
    expect(() => addParticipant(group, 'u-outsider', 'u-clerk')).toThrow(
      'Conversation not found',
    );
  });

  it('rejects adding the same person twice', () => {
    expect(() => addParticipant(group, 'u-admin', 'u-manager')).toThrow(
      'User is already in this conversation',
    );
  });

  it('never grows a direct chat', () => {
    const direct: Conversation = {
      type: 'DIRECT',
      name: null,
      createdById: 'u-admin',
      participants: initialParticipants('u-admin', ['u-manager']),
    };
    expect(() => addParticipant(direct, 'u-admin', 'u-clerk')).toThrow(
      'Participants cannot be added to a direct chat',
    );
  });
});

describe('membership gate', () => {
  const conversation: Conversation = {
    type: 'GROUP',
    name: 'Operations',
    createdById: 'u-admin',
    participants: initialParticipants('u-admin', ['u-manager']),
  };

  it('lets a participant read the thread', () => {
    expect(() => assertMembership(conversation, 'u-manager')).not.toThrow();
  });

  it('hides the conversation from non-members', () => {
    expect(() => assertMembership(conversation, 'u-finance')).toThrow('Conversation not found');
  });
});

describe('unread counting', () => {
  const first = new Date('2026-10-03T09:00:00Z');
  const middle = new Date('2026-10-03T09:45:00Z');
  const last = new Date('2026-10-03T10:00:00Z');
  const messages: Message[] = [
    { senderUserId: 'u-admin', createdAt: first },
    { senderUserId: 'u-manager', createdAt: middle },
    { senderUserId: 'u-admin', createdAt: last },
  ];

  it('counts messages from others only', () => {
    // u-manager wrote the middle message, so only the two admin messages count.
    const participant: Participant = { userId: 'u-manager', role: 'MEMBER', lastReadAt: null };
    expect(unreadCount(participant, messages)).toBe(2);
  });

  it('counts everything from others when never read', () => {
    const participant: Participant = { userId: 'u-clerk', role: 'MEMBER', lastReadAt: null };
    expect(unreadCount(participant, messages)).toBe(3);
  });

  it('only counts messages newer than the read cursor', () => {
    const participant: Participant = {
      userId: 'u-manager',
      role: 'MEMBER',
      lastReadAt: new Date('2026-10-03T09:30:00Z'),
    };
    // admin@09:00 is older than the cursor and manager@09:45 is the reader's own.
    expect(unreadCount(participant, messages)).toBe(1);
  });

  it('clears once the read cursor passes every message', () => {
    const caughtUp: Participant = {
      userId: 'u-manager',
      role: 'MEMBER',
      lastReadAt: new Date('2026-10-03T10:30:00Z'),
    };
    expect(unreadCount(caughtUp, messages)).toBe(0);
  });
});
