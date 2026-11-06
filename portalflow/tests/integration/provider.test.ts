import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src";
import { drainMessaging, recordStatus } from "../../packages/core/src";
it("bounds provider failure retries and serializes competing status callbacks", async () => {
  const db = createDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Provider failure test" },
  });
  try {
    const contact = await db.contact.create({
      data: { tenantId: tenant.id, name: "Test", phone: "+919000000099" },
    });
    const conversation = await db.conversation.create({
      data: {
        tenantId: tenant.id,
        contactId: contact.id,
        lastInboundAt: new Date(),
      },
    });
    const message = await db.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        status: "QUEUED",
        text: "Retry test",
        idempotencyKey: randomUUID(),
      },
    });
    let calls = 0;
    const failing = {
      name: "test-failure",
      async send(): Promise<never> {
        calls++;
        throw new Error("Injected provider failure");
      },
    };
    for (let i = 0; i < 4; i++) await drainMessaging(db, failing);
    const failed = await db.message.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(calls).toBe(3);
    expect(failed.attempts).toBe(3);
    expect(failed.status).toBe("FAILED");
    expect(
      await db.messageEvent.count({
        where: { messageId: message.id, status: "FAILED" },
      }),
    ).toBe(1);
    await Promise.all(
      ["READ", "SENT", "DELIVERED", "DELIVERED"].map((status) =>
        db.$transaction((tx) =>
          recordStatus(
            tx,
            tenant.id,
            message.id,
            status as "READ" | "SENT" | "DELIVERED",
          ),
        ),
      ),
    );
    expect(
      (await db.message.findUniqueOrThrow({ where: { id: message.id } }))
        .status,
    ).toBe("READ");
    expect(
      await db.messageEvent.count({
        where: { messageId: message.id, status: "DELIVERED" },
      }),
    ).toBe(1);
  } finally {
    await db.tenant.delete({ where: { id: tenant.id } });
    await db.$disconnect();
  }
});
