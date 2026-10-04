/**
 * Removes throwaway rows left by manual UI checks and this pass's own upload
 * probe, so the demo database reads like the seed. Only rows carrying the smoke
 * markers or the exact test-document title are touched.
 *
 *   node scripts/cleanup-demo-smoke-data.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TEST_DOCUMENT_TITLE = 'Envelope audit note';

try {
  const documents = await prisma.document.findMany({
    where: { title: TEST_DOCUMENT_TITLE },
    select: { id: true, versions: { select: { id: true } } },
  });
  let deletedVersions = 0;
  for (const doc of documents) {
    deletedVersions += doc.versions.length;
  }
  await prisma.documentLink.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
  await prisma.documentVersion.deleteMany({ where: { documentId: { in: documents.map((d) => d.id) } } });
  const deletedDocuments = await prisma.document.deleteMany({
    where: { id: { in: documents.map((d) => d.id) } },
  });

  const visitors = await prisma.visitor.deleteMany({
    where: { OR: [{ name: 'Smoke Tester' }, { companyName: 'SmokeCo' }] },
  });
  const calls = await prisma.callLog.deleteMany({
    where: { OR: [{ callerName: 'Smoke Caller' }, { subject: 'Stage 9 smoke call' }] },
  });
  const correspondence = await prisma.correspondence.deleteMany({
    where: { subject: 'Smoke parcel' },
  });
  const files = await prisma.fileRecord.deleteMany({
    where: { title: 'Smoke file' },
  });

  console.log(`removed ${deletedDocuments.count} test documents (${deletedVersions} versions)`);
  console.log(`removed ${visitors.count} visitors, ${calls.count} calls`);
  console.log(`removed ${correspondence.count} correspondence rows, ${files.count} file-room items`);
} finally {
  await prisma.$disconnect();
}