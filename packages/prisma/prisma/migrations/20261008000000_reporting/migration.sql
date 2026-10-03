-- CreateTable
CREATE TABLE "ReportDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "queryDefinition" JSONB NOT NULL,
    "permission" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportDefinitionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "sorting" JSONB NOT NULL DEFAULT '{}',
    "grouping" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "reportDefinitionId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "outputFormat" TEXT NOT NULL DEFAULT 'CSV',
    "deliveryChannel" TEXT NOT NULL DEFAULT 'IN_APP',
    "recipientConfiguration" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastDeliveryStatus" TEXT,
    "lastDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "reportDefinitionId" TEXT,
    "requestedById" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "storageKey" TEXT,
    "rowCount" INTEGER,
    "sizeBytes" INTEGER,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportDefinition_code_key" ON "ReportDefinition"("code");

-- CreateIndex
CREATE INDEX "ReportDefinition_status_module_idx" ON "ReportDefinition"("status", "module");

-- CreateIndex
CREATE INDEX "ReportDefinition_companyId_idx" ON "ReportDefinition"("companyId");

-- CreateIndex
CREATE INDEX "SavedReport_userId_idx" ON "SavedReport"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedReport_userId_reportDefinitionId_name_key" ON "SavedReport"("userId", "reportDefinitionId", "name");

-- CreateIndex
CREATE INDEX "ScheduledReport_status_nextRunAt_idx" ON "ScheduledReport"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduledReport_ownerUserId_idx" ON "ScheduledReport"("ownerUserId");

-- CreateIndex
CREATE INDEX "ReportExport_requestedById_requestedAt_idx" ON "ReportExport"("requestedById", "requestedAt");

-- CreateIndex
CREATE INDEX "ReportExport_status_expiresAt_idx" ON "ReportExport"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "ReportDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

