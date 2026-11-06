import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src";
import { makeNode, type Flow } from "../../packages/shared/src";
import {
  executeInbound,
  processScheduledExecutions,
} from "../../packages/core/src/engine";
import { drainMessaging, MockWhatsAppProvider } from "../../packages/core/src";
const db = createDatabase();
const tenants: string[] = [];
async function fixture(kind: "delay" | "ask" = "delay") {
  const tenant = await db.tenant.create({
    data: { name: "Timer isolation test" },
  });
  tenants.push(tenant.id);
  const tenantId = tenant.id;
  const contact = await db.contact.create({
    data: { tenantId, name: "Customer", phone: "+15555550199" },
  });
  const conversation = await db.conversation.create({
    data: { tenantId, contactId: contact.id, lastInboundAt: new Date() },
  });
  const graph: Flow = {
    schemaVersion: 1,
    nodes: [
      makeNode("start", "start", 0, 0),
      makeNode("wait", kind, 0, 100, {
        delaySeconds: 60,
        timeoutSeconds: 60,
        text: "Your name?",
        variable: "name",
      }),
      makeNode("reply", "text", 0, 200, { text: "Scheduled reply {{name}}" }),
      makeNode("end", "end", 0, 300),
    ],
    edges: [
      { id: "1", source: "start", target: "wait" },
      { id: "2", source: "wait", target: "reply" },
      { id: "3", source: "reply", target: "end" },
    ],
  };
  const flow = await db.botFlow.create({
    data: { tenantId, name: "Timer", draft: graph, publishedVersion: 1 },
  });
  await db.botFlowVersion.create({
    data: { tenantId, flowId: flow.id, number: 1, data: graph },
  });
  await db.$transaction((tx) =>
    executeInbound(
      tx,
      { id: randomUUID(), tenantId, text: "hello", simulationFlowId: flow.id },
      conversation.id,
      contact.id,
    ),
  );
  const execution = await db.botExecution.findFirstOrThrow({
    where: { tenantId },
  });
  return { tenantId, contact, conversation, execution, flow };
}
async function due(id: string, question = false) {
  await db.botExecution.update({
    where: { id },
    data: question ? { waitExpiresAt: new Date(0) } : { wakeAt: new Date(0) },
  });
}
afterAll(async () => {
  await db.tenant.deleteMany({ where: { id: { in: tenants } } });
  await db.$disconnect();
});
describe.sequential("durable execution deadlines", () => {
  it("persists a delay, ignores early inbound, and resumes once under concurrent reconcilers", async () => {
    const f = await fixture();
    expect(f.execution.status).toBe("SLEEPING");
    expect(f.execution.wakeAt!.getTime()).toBeGreaterThan(Date.now());
    await db.$transaction((tx) =>
      executeInbound(
        tx,
        { id: randomUUID(), tenantId: f.tenantId, text: "early answer" },
        f.conversation.id,
        f.contact.id,
      ),
    );
    expect(await db.message.count({ where: { tenantId: f.tenantId } })).toBe(0);
    await due(f.execution.id);
    await Promise.all([
      processScheduledExecutions(db),
      processScheduledExecutions(db),
    ]);
    expect(
      (
        await db.botExecution.findUniqueOrThrow({
          where: { id: f.execution.id },
        })
      ).status,
    ).toBe("COMPLETED");
    expect(
      await db.message.count({
        where: { tenantId: f.tenantId, text: "Scheduled reply " },
      }),
    ).toBe(1);
  });
  it("expires unanswered questions without another inbound message", async () => {
    const f = await fixture("ask");
    expect(f.execution.status).toBe("WAITING");
    expect(f.execution.waitExpiresAt).not.toBeNull();
    await due(f.execution.id, true);
    await processScheduledExecutions(db);
    expect(
      (
        await db.botExecution.findUniqueOrThrow({
          where: { id: f.execution.id },
        })
      ).status,
    ).toBe("TIMED_OUT");
    expect(
      await db.message.count({
        where: { tenantId: f.tenantId, text: { startsWith: "Scheduled" } },
      }),
    ).toBe(0);
    await drainMessaging(db, new MockWhatsAppProvider());
    const prompt = await db.message.findFirstOrThrow({
      where: { tenantId: f.tenantId },
    });
    expect(prompt.status).toBe("FAILED");
    expect(prompt.error).toContain("execution terminated");
  });
  it.each(["takeover", "closed", "suspended"])(
    "holds due work while %s and resumes after release",
    async (reason) => {
      const f = await fixture();
      await due(f.execution.id);
      if (reason === "suspended")
        await db.tenant.update({
          where: { id: f.tenantId },
          data: { suspendedAt: new Date() },
        });
      else
        await db.conversation.update({
          where: { id: f.conversation.id },
          data:
            reason === "takeover"
              ? { humanTakeover: true }
              : { status: "CLOSED" },
        });
      await processScheduledExecutions(db);
      expect(
        (
          await db.botExecution.findUniqueOrThrow({
            where: { id: f.execution.id },
          })
        ).status,
      ).toBe("SLEEPING");
      await db.tenant.update({
        where: { id: f.tenantId },
        data: { suspendedAt: null },
      });
      await db.conversation.update({
        where: { id: f.conversation.id },
        data: { humanTakeover: false, status: "OPEN" },
      });
      await processScheduledExecutions(db);
      expect(
        (
          await db.botExecution.findUniqueOrThrow({
            where: { id: f.execution.id },
          })
        ).status,
      ).toBe("COMPLETED");
    },
  );
  it("cancels a suppressed contact and refuses a closed service window", async () => {
    const a = await fixture(),
      b = await fixture();
    await due(a.execution.id);
    await due(b.execution.id);
    await db.contact.update({
      where: { id: a.contact.id },
      data: { optedOutAt: new Date() },
    });
    await db.conversation.update({
      where: { id: b.conversation.id },
      data: { lastInboundAt: new Date(Date.now() - 86400001) },
    });
    await processScheduledExecutions(db);
    expect(
      (
        await db.botExecution.findUniqueOrThrow({
          where: { id: a.execution.id },
        })
      ).status,
    ).toBe("CANCELLED");
    expect(
      (
        await db.botExecution.findUniqueOrThrow({
          where: { id: b.execution.id },
        })
      ).status,
    ).toBe("TIMED_OUT");
    expect(
      await db.message.count({
        where: { tenantId: { in: [a.tenantId, b.tenantId] } },
      }),
    ).toBe(0);
  });
});
