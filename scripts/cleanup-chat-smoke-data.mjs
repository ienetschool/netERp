/**
 * Removes chat smoke-test residue from the demo database so the seeded
 * conversation history reads cleanly. Only deletes rows created by
 * scripts/verify-chat-flow.mjs and manual UI checks (test group names and
 * messages whose content begins with the smoke markers).
 *
 *   node scripts/cleanup-chat-smoke-data.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MESSAGE_MARKERS = ['Smoke:', 'Browser check:'];
const GROUP_NAMES = ['Smoke Group', 'Front Office'];

try {
  const groups = await prisma.conversation.findMany({
    where: { name: { in: GROUP_NAMES } },
    select: { id: true },
  });
  const messages = await prisma.message.findMany({
    where: { OR: MESSAGE_MARKERS.map((m) => ({ content: { startsWith: m } })) },
    select: { id: true },
  });

  const deletedMessages = await prisma.message.deleteMany({
    where: { OR: MESSAGE_MARKERS.map((m) => ({ content: { startsWith: m } })) },
  });
  const deletedConversations = await prisma.conversation.deleteMany({
    where: { name: { in: GROUP_NAMES } },
  });

  console.log(`removed ${deletedMessages.count} smoke messages`);
  console.log(`removed ${deletedConversations.count} smoke conversations`);
  console.log(
    `remaining: ${await prisma.conversation.count()} conversations, ${await prisma.message.count()} messages`,
  );
  if (groups.length === 0 && messages.length === 0) {
    console.log('nothing to clean (already tidy)');
  }
} finally {
  await prisma.$disconnect();
}
