-- AlterTable
ALTER TABLE "InboundEvent" ADD COLUMN     "reply" JSONB;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "interactive" JSONB,
ADD COLUMN     "reply" JSONB;

