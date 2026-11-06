import {
  assertActive,
  assertCapacity,
  EntitlementError,
  lockTenant,
} from "./entitlements";
export * from "./entitlements";
export * from "./http";
import {
  interactiveSchema,
  mediaSchema,
  replySchema,
  type InteractiveMessage,
  type MediaMessage,
} from "@portalflow/shared";
import { executeInbound } from "./engine";
export {
  executeInbound,
  processScheduledExecutions,
  startTriggeredFlow,
  type TriggerOutcome,
} from "./engine";
import { PrismaClient, Prisma, MessageStatus } from "@portalflow/database";
export interface OutboundPayload {
  messageId: string;
  to: string;
  /** Message body, or the caption when media is attached. */
  text: string;
  interactive?: InteractiveMessage;
  media?: MediaMessage;
}
export interface WhatsAppProvider {
  readonly name: string;
  send(
    input: OutboundPayload,
  ): Promise<{ providerId: string; status: "SENT" | "DELIVERED" }>;
}
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  async send(input: OutboundPayload) {
    if (input.interactive) interactiveSchema.parse(input.interactive);
    if (input.media) mediaSchema.parse(input.media);
    if (input.interactive && input.media)
      throw new Error("A message cannot combine media and interactive options");
    return {
      providerId: `mock-out-${input.messageId}`,
      status: "DELIVERED" as const,
    };
  }
}
export function withinServiceWindow(
  lastInbound: Date | null,
  now = new Date(),
) {
  return (
    !!lastInbound &&
    lastInbound.getTime() <= now.getTime() &&
    now.getTime() - lastInbound.getTime() < 24 * 60 * 60 * 1000
  );
}
const ranks: Record<MessageStatus, number> = {
  QUEUED: 0,
  RECEIVED: 0,
  SENT: 1,
  FAILED: 2,
  DELIVERED: 3,
  READ: 4,
};
export function advanceStatus(
  current: MessageStatus,
  incoming: MessageStatus,
): MessageStatus {
  return ranks[incoming] > ranks[current] ? incoming : current;
}
export interface InboxEvent {
  tenantId: string;
  conversationId: string;
}
export async function drainMessaging(
  db: PrismaClient,
  provider: WhatsAppProvider,
): Promise<InboxEvent[]> {
  const changed: InboxEvent[] = [];
  await db.$transaction(
    async (tx) => {
      const events = await tx.$queryRaw<
        Array<{
          id: string;
          tenantId: string;
          externalId: string;
          reply: Prisma.JsonValue;
          media: Prisma.JsonValue;
          simulationFlowId: string | null;
          phone: string;
          text: string;
          createdAt: Date;
        }>
      >`SELECT e.* FROM "InboundEvent" e JOIN "Tenant" t ON t.id=e."tenantId" WHERE e.status='PENDING' AND t."suspendedAt" IS NULL ORDER BY e."tenantId", e."createdAt" LIMIT 20 FOR UPDATE OF e SKIP LOCKED`;
      for (const event of events) {
        await lockTenant(tx, event.tenantId);
        const existing = await tx.contact.findUnique({
          where: {
            tenantId_phone: { tenantId: event.tenantId, phone: event.phone },
          },
        });
        if (!existing) {
          try {
            await assertCapacity(tx, event.tenantId, "contacts");
          } catch (error) {
            if (!(error instanceof EntitlementError)) throw error;
            await tx.inboundEvent.update({
              where: { id: event.id },
              data: { status: "QUOTA_BLOCKED", error: error.message },
            });
            continue;
          }
        }
        const contact = await tx.contact.upsert({
          where: {
            tenantId_phone: { tenantId: event.tenantId, phone: event.phone },
          },
          create: {
            tenantId: event.tenantId,
            name: event.phone,
            phone: event.phone,
            source: "mock-whatsapp",
          },
          update: {},
        });
        await tx.$queryRaw`SELECT id FROM "Contact" WHERE id=${contact.id}::uuid AND "tenantId"=${event.tenantId}::uuid FOR UPDATE`;
        if (contact.deletedAt) {
          await tx.inboundEvent.update({
            where: { id: event.id },
            data: { status: "SUPPRESSED", processedAt: new Date() },
          });
          continue;
        }
        if (/^(stop|unsubscribe)$/i.test(event.text.trim())) {
          await tx.contact.update({
            where: { id: contact.id },
            data: { optedOutAt: event.createdAt, optedInAt: null },
          });
          await tx.contactConsent.create({
            data: {
              tenantId: event.tenantId,
              contactId: contact.id,
              optedIn: false,
              source: "Customer STOP/UNSUBSCRIBE message",
            },
          });
        }
        const conversation = await tx.conversation.upsert({
          where: { contactId: contact.id },
          create: {
            tenantId: event.tenantId,
            contactId: contact.id,
            lastInboundAt: event.createdAt,
            lastActivityAt: event.createdAt,
          },
          update: { unread: true, status: "OPEN" },
        });
        await tx.conversation.updateMany({
          where: {
            id: conversation.id,
            OR: [
              { lastInboundAt: null },
              { lastInboundAt: { lt: event.createdAt } },
            ],
          },
          data: {
            lastInboundAt: event.createdAt,
            lastActivityAt: event.createdAt,
          },
        });
        await tx.message.create({
          data: {
            createdAt: event.createdAt,
            tenantId: event.tenantId,
            conversationId: conversation.id,
            direction: "INBOUND",
            status: "RECEIVED",
            text: event.text,
            ...(event.reply ? { reply: replySchema.parse(event.reply) } : {}),
            ...(event.media ? { media: mediaSchema.parse(event.media) } : {}),
            idempotencyKey: `in:${event.externalId}`,
            providerId: `mock-in-${event.id}`,
            events: { create: { status: "RECEIVED" } },
          },
        });
        await executeInbound(
          tx,
          {
            ...event,
            reply: event.reply ? replySchema.parse(event.reply) : undefined,
          },
          conversation.id,
          contact.id,
        );
        await tx.inboundEvent.update({
          where: { id: event.id },
          data: { status: "PROCESSED", processedAt: new Date() },
        });
        changed.push({
          tenantId: event.tenantId,
          conversationId: conversation.id,
        });
      }
    },
    { timeout: 30000 },
  );
  await db.$transaction(
    async (tx) => {
      const messages = await tx.$queryRaw<
        Array<{
          id: string;
          tenantId: string;
          conversationId: string;
          text: string;
          attempts: number;
          botExecutionId: string | null;
          executionStatus: string | null;
          interactive: Prisma.JsonValue;
          media: Prisma.JsonValue;
        }>
      >`SELECT m.*, b.status AS "executionStatus" FROM "Message" m JOIN "Tenant" t ON t.id=m."tenantId" JOIN "Conversation" c ON c.id=m."conversationId" LEFT JOIN "BotExecution" b ON b.id=m."botExecutionId" WHERE m.status='QUEUED' AND t."suspendedAt" IS NULL AND (m."botExecutionId" IS NULL OR NOT c."humanTakeover" OR b.status='HANDOFF') ORDER BY m."tenantId", m.sequence LIMIT 20 FOR UPDATE OF m SKIP LOCKED`;
      for (const message of messages) {
        try {
          await assertActive(tx, message.tenantId);
        } catch (error) {
          if (!(error instanceof EntitlementError)) throw error;
          await tx.message.update({
            where: { id: message.id },
            data: {
              status: "FAILED",
              error: error.message,
              events: { create: { status: "FAILED" } },
            },
          });
          changed.push({
            tenantId: message.tenantId,
            conversationId: message.conversationId,
          });
          continue;
        }
        const conversation = await tx.conversation.findFirstOrThrow({
          where: { id: message.conversationId, tenantId: message.tenantId },
          include: { contact: true },
        });
        if (
          (message.executionStatus !== null &&
            ["TIMED_OUT", "CANCELLED", "FAILED"].includes(
              message.executionStatus,
            )) ||
          conversation.contact.deletedAt ||
          conversation.contact.optedOutAt ||
          !withinServiceWindow(conversation.lastInboundAt)
        ) {
          await tx.message.update({
            where: { id: message.id },
            data: {
              status: "FAILED",
              error:
                "Contact suppressed, execution terminated, or service window closed",
              events: { create: { status: "FAILED" } },
            },
          });
        } else {
          let sent: { providerId: string; status: "SENT" | "DELIVERED" };
          try {
            sent = await provider.send({
              messageId: message.id,
              to: conversation.contact.phone,
              text: message.text,
              ...(message.interactive
                ? { interactive: interactiveSchema.parse(message.interactive) }
                : {}),
              ...(message.media
                ? { media: mediaSchema.parse(message.media) }
                : {}),
            });
          } catch {
            const exhausted = message.attempts + 1 >= 3;
            await tx.message.update({
              where: { id: message.id },
              data: {
                attempts: { increment: 1 },
                error: "Provider send failed",
                ...(exhausted
                  ? {
                      status: "FAILED",
                      events: { create: { status: "FAILED" } },
                    }
                  : {}),
              },
            });
            changed.push({
              tenantId: message.tenantId,
              conversationId: message.conversationId,
            });
            continue;
          }
          await tx.message.update({
            where: { id: message.id },
            data: {
              status: sent.status,
              error: null,
              providerId: sent.providerId,
              attempts: { increment: 1 },
              events: {
                create:
                  sent.status === "DELIVERED"
                    ? [{ status: "SENT" }, { status: "DELIVERED" }]
                    : [{ status: "SENT" }],
              },
            },
          });
        }
        changed.push({
          tenantId: message.tenantId,
          conversationId: message.conversationId,
        });
      }
    },
    { timeout: 30000 },
  );
  return changed;
}
export async function recordStatus(
  tx: Prisma.TransactionClient,
  tenantId: string,
  messageId: string,
  status: MessageStatus,
) {
  await tx.$queryRaw`SELECT id FROM "Message" WHERE id=${messageId}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
  const message = await tx.message.findFirstOrThrow({
    where: { id: messageId, tenantId },
  });
  await tx.messageEvent.upsert({
    where: { messageId_status: { messageId, status } },
    create: { tenantId, messageId, status },
    update: {},
  });
  return tx.message.update({
    where: { id: messageId },
    data: { status: advanceStatus(message.status, status) },
  });
}
