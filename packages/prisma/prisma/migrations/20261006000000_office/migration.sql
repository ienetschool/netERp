-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "visitorNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "hostEmployeeId" TEXT,
    "purpose" TEXT,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "callerName" TEXT NOT NULL,
    "callerPhone" TEXT,
    "recipientEmployeeId" TEXT,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "callTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correspondence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "correspondenceNo" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "correspondenceType" TEXT NOT NULL DEFAULT 'LETTER',
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "documentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Correspondence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "fileNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "locationCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "issuedToEmployeeId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileMovement" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "issuedToEmployeeId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visitor_companyId_status_idx" ON "Visitor"("companyId", "status");

-- CreateIndex
CREATE INDEX "Visitor_companyId_checkInAt_idx" ON "Visitor"("companyId", "checkInAt");

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_companyId_visitorNo_key" ON "Visitor"("companyId", "visitorNo");

-- CreateIndex
CREATE INDEX "CallLog_companyId_callTime_idx" ON "CallLog"("companyId", "callTime");

-- CreateIndex
CREATE INDEX "CallLog_companyId_status_idx" ON "CallLog"("companyId", "status");

-- CreateIndex
CREATE INDEX "Correspondence_companyId_status_idx" ON "Correspondence"("companyId", "status");

-- CreateIndex
CREATE INDEX "Correspondence_companyId_direction_idx" ON "Correspondence"("companyId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "Correspondence_companyId_correspondenceNo_key" ON "Correspondence"("companyId", "correspondenceNo");

-- CreateIndex
CREATE INDEX "FileRecord_companyId_status_idx" ON "FileRecord"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FileRecord_companyId_fileNo_key" ON "FileRecord"("companyId", "fileNo");

-- CreateIndex
CREATE INDEX "FileMovement_fileId_at_idx" ON "FileMovement"("fileId", "at");

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correspondence" ADD CONSTRAINT "Correspondence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRecord" ADD CONSTRAINT "FileRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileMovement" ADD CONSTRAINT "FileMovement_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

