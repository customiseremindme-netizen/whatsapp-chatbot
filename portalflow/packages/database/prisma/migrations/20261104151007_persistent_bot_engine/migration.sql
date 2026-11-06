-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "InboundEvent" ADD COLUMN     "simulationFlowId" UUID;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "botExecutionId" UUID;

-- CreateTable
CREATE TABLE "BotFlow" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "publishedVersion" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotFlowVersion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "flowId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotFlowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotExecution" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "flowVersionId" UUID NOT NULL,
    "currentNode" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "waitingKey" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "logs" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "values" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotFlow_tenantId_priority_createdAt_idx" ON "BotFlow"("tenantId", "priority", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotFlow_id_tenantId_key" ON "BotFlow"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BotFlowVersion_flowId_number_key" ON "BotFlowVersion"("flowId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "BotFlowVersion_id_tenantId_key" ON "BotFlowVersion"("id", "tenantId");

-- CreateIndex
CREATE INDEX "BotExecution_tenantId_conversationId_status_idx" ON "BotExecution"("tenantId", "conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BotExecution_id_tenantId_key" ON "BotExecution"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_executionId_key" ON "Lead"("executionId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_createdAt_idx" ON "Lead"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_executionId_tenantId_key" ON "Lead"("executionId", "tenantId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_botExecutionId_tenantId_fkey" FOREIGN KEY ("botExecutionId", "tenantId") REFERENCES "BotExecution"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEvent" ADD CONSTRAINT "InboundEvent_simulationFlowId_tenantId_fkey" FOREIGN KEY ("simulationFlowId", "tenantId") REFERENCES "BotFlow"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotFlow" ADD CONSTRAINT "BotFlow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotFlowVersion" ADD CONSTRAINT "BotFlowVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotFlowVersion" ADD CONSTRAINT "BotFlowVersion_flowId_tenantId_fkey" FOREIGN KEY ("flowId", "tenantId") REFERENCES "BotFlow"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotExecution" ADD CONSTRAINT "BotExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotExecution" ADD CONSTRAINT "BotExecution_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotExecution" ADD CONSTRAINT "BotExecution_conversationId_tenantId_fkey" FOREIGN KEY ("conversationId", "tenantId") REFERENCES "Conversation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotExecution" ADD CONSTRAINT "BotExecution_flowVersionId_tenantId_fkey" FOREIGN KEY ("flowVersionId", "tenantId") REFERENCES "BotFlowVersion"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_conversationId_tenantId_fkey" FOREIGN KEY ("conversationId", "tenantId") REFERENCES "Conversation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_executionId_tenantId_fkey" FOREIGN KEY ("executionId", "tenantId") REFERENCES "BotExecution"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
