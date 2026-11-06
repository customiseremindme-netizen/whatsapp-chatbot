-- Link-based image/document payloads (validated by @portalflow/shared mediaSchema).
ALTER TABLE "Message" ADD COLUMN "media" JSONB;
ALTER TABLE "InboundEvent" ADD COLUMN "media" JSONB;
