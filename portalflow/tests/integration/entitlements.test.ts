import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src";
import {
  drainMessaging,
  MockWhatsAppProvider,
  processScheduledExecutions,
} from "../../packages/core/src";
import { makeNode, type Flow } from "../../packages/shared/src";
const db = createDatabase();
const users: string[] = [],
  tenants: string[] = [],
  plans: string[] = [],
  emails: string[] = [];
class Client {
  cookies = new Map<string, string>();
  tenantId = "";
  userId = "";
  email = "";
  async call(path: string, method = "GET", body?: unknown) {
    const res = await fetch("http://localhost:4000/api/v1" + path, {
      method,
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        "X-CSRF-Token": this.cookies.get("pf_csrf") ?? "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const value = cookie.split(";")[0]!,
        i = value.indexOf("=");
      this.cookies.set(value.slice(0, i), value.slice(i + 1));
    }
    return res;
  }
  async register() {
    this.email = `entitlement-${randomUUID()}@example.com`;
    emails.push(this.email);
    expect(
      (
        await this.call("/auth/register", "POST", {
          name: "Capacity test",
          workspace: "Capacity workspace",
          email: this.email,
          password: "CapacityPassword!2026",
        })
      ).status,
    ).toBe(201);
    const me = await (await this.call("/auth/me")).json();
    this.tenantId = me.tenant.id;
    this.userId = me.user.id;
    users.push(this.userId);
    tenants.push(this.tenantId);
    await db.user.update({
      where: { id: this.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }
}
const admin = new Client();
const expiresAt = () => new Date(Date.now() + 30 * 86400000).toISOString();
async function fixture() {
  const owner = new Client();
  await owner.register();
  const input = {
    name: "Capacity plan",
    monthlyPaise: 99900,
    yearlyPaise: 999000,
    maxNumbers: 1,
    maxMembers: 2,
    maxContacts: 1,
    maxBots: 1,
    archived: false,
  };
  const response = await admin.call("/admin/plans", "POST", input);
  expect(response.status).toBe(201);
  const plan = await response.json();
  plans.push(plan.id);
  expect(
    (
      await admin.call(
        `/admin/tenants/${owner.tenantId}/subscription`,
        "PATCH",
        {
          planId: plan.id,
          status: "ACTIVE",
          expiresAt: expiresAt(),
          revision: 0,
          reason: "Local test grant",
        },
      )
    ).status,
  ).toBe(200);
  return { owner, plan, input };
}
async function incoming(owner: Client, phone: string) {
  const externalId = randomUUID();
  expect(
    (
      await owner.call("/whatsapp/mock/inbound", "POST", {
        externalId,
        phone,
        text: "Hello",
      })
    ).status,
  ).toBe(201);
  await drainMessaging(db, new MockWhatsAppProvider());
  return db.inboundEvent.findUniqueOrThrow({
    where: { tenantId_externalId: { tenantId: owner.tenantId, externalId } },
  });
}
beforeAll(async () => {
  await admin.register();
  await db.user.update({
    where: { id: admin.userId },
    data: { platformAdmin: true },
  });
});
afterAll(async () => {
  await db.platformAuditLog.deleteMany({ where: { actorId: { in: users } } });
  await db.tenant.deleteMany({ where: { id: { in: tenants } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: plans } } });
  await db.emailOutbox.deleteMany({ where: { recipient: { in: emails } } });
  await db.$disconnect();
});
describe.sequential("manual access grants and transactional capacity", () => {
  it("isolates subscription reads and rejects owner assignment", async () => {
    const { owner, plan } = await fixture();
    expect(
      (await owner.call(`/admin/tenants/${admin.tenantId}/subscription`))
        .status,
    ).toBe(403);
    expect(
      (
        await owner.call(
          `/admin/tenants/${owner.tenantId}/subscription`,
          "PATCH",
          {
            planId: plan.id,
            status: "ACTIVE",
            expiresAt: expiresAt(),
            revision: 1,
            reason: "Unauthorized",
          },
        )
      ).status,
    ).toBe(403);
    const value = await (await owner.call("/billing/subscription")).json();
    expect(value.source).toBe("MANUAL");
    expect(value.limits.contacts).toBe(1);
    expect(value.planId).toBe(plan.id);
  });
  it("serializes concurrent contact/bot creation and frees capacity on archive", async () => {
    const { owner } = await fixture();
    const contacts = await Promise.all(
      ["+15555550701", "+15555550702"].map((phone) =>
        owner.call("/contacts", "POST", { name: "Capacity", phone }),
      ),
    );
    expect(contacts.map((r) => r.status).sort()).toEqual([201, 403]);
    const contact = await contacts.find((r) => r.status === 201)!.json();
    const bots = await Promise.all(
      ["One", "Two"].map((name) => owner.call("/bots", "POST", { name })),
    );
    expect(bots.map((r) => r.status).sort()).toEqual([201, 403]);
    expect((await owner.call(`/contacts/${contact.id}`, "DELETE")).status).toBe(
      200,
    );
    expect(
      (
        await owner.call("/contacts", "POST", {
          name: "Replacement",
          phone: "+15555550703",
        })
      ).status,
    ).toBe(201);
  });
  it("reserves invitation seats and converts a reservation into membership", async () => {
    const { owner } = await fixture();
    const guest = new Client();
    await guest.register();
    expect(
      (
        await owner.call("/tenants/invitations", "POST", {
          email: guest.email,
          role: "AGENT",
        })
      ).status,
    ).toBe(201);
    const otherEmail = `unused-${randomUUID()}@example.com`;
    emails.push(otherEmail);
    expect(
      (
        await owner.call("/tenants/invitations", "POST", {
          email: otherEmail,
          role: "AGENT",
        })
      ).status,
    ).toBe(403);
    const mail = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: guest.email, subject: "Your PortalFlow invitation" },
    });
    const token = mail.text.match(/token=([a-f0-9]{64})/)![1];
    expect(
      (await guest.call("/tenants/invitations/accept", "POST", { token }))
        .status,
    ).toBe(201);
    const value = await (await owner.call("/billing/subscription")).json();
    expect(value.usage.members).toBe(2);
    expect(value.usage.invitations).toBe(0);
  });
  it("pins plan revisions and rejects stale grants and over-capacity downgrades", async () => {
    const { owner, plan, input } = await fixture();
    expect(
      (
        await admin.call(`/admin/plans/${plan.id}`, "PATCH", {
          ...input,
          maxContacts: 2,
          revision: plan.revision,
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await owner.call("/billing/subscription")).json()).limits
        .contacts,
    ).toBe(1);
    const assignment = {
      planId: plan.id,
      status: "ACTIVE",
      expiresAt: expiresAt(),
      revision: 1,
      reason: "Apply larger snapshot",
    };
    expect(
      (
        await admin.call(
          `/admin/tenants/${owner.tenantId}/subscription`,
          "PATCH",
          assignment,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.call(
          `/admin/tenants/${owner.tenantId}/subscription`,
          "PATCH",
          assignment,
        )
      ).status,
    ).toBe(409);
    await owner.call("/contacts", "POST", {
      name: "One",
      phone: "+15555550711",
    });
    await owner.call("/contacts", "POST", {
      name: "Two",
      phone: "+15555550712",
    });
    expect(
      (
        await admin.call(`/admin/plans/${plan.id}`, "PATCH", {
          ...input,
          revision: 2,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.call(
          `/admin/tenants/${owner.tenantId}/subscription`,
          "PATCH",
          { ...assignment, revision: 2 },
        )
      ).status,
    ).toBe(409);
    expect(
      (await (await owner.call("/billing/subscription")).json()).limits
        .contacts,
    ).toBe(2);
  });
  it("preserves quota-blocked inbound events and retries after a larger grant", async () => {
    const { owner, plan, input } = await fixture();
    await owner.call("/contacts", "POST", {
      name: "Full",
      phone: "+15555550721",
    });
    const blocked = await incoming(owner, "+15555550722");
    expect(blocked.status).toBe("QUOTA_BLOCKED");
    expect(
      await db.contact.count({ where: { tenantId: owner.tenantId } }),
    ).toBe(1);
    await admin.call(`/admin/plans/${plan.id}`, "PATCH", {
      ...input,
      maxContacts: 2,
      revision: 1,
    });
    await admin.call(`/admin/tenants/${owner.tenantId}/subscription`, "PATCH", {
      planId: plan.id,
      status: "ACTIVE",
      expiresAt: expiresAt(),
      revision: 1,
      reason: "Capacity increased",
    });
    expect(
      (await (await owner.call("/billing/retry-blocked", "POST")).json())
        .queued,
    ).toBe(1);
    await drainMessaging(db, new MockWhatsAppProvider());
    expect(
      (await db.inboundEvent.findUniqueOrThrow({ where: { id: blocked.id } }))
        .status,
    ).toBe("PROCESSED");
    expect(
      await db.contact.count({ where: { tenantId: owner.tenantId } }),
    ).toBe(2);
    expect(
      (await (await owner.call("/billing/retry-blocked", "POST")).json())
        .queued,
    ).toBe(0);
  });
  it("blocks expired outbound sends and scheduled automation while retaining read access", async () => {
    const { owner } = await fixture();
    const bot = await (
      await owner.call("/bots", "POST", { name: "Expiring delay" })
    ).json();
    const graph: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0),
        makeNode("delay", "delay", 0, 100, { delaySeconds: 60 }),
        makeNode("text", "text", 0, 200, { text: "Should not send" }),
        makeNode("end", "end", 0, 300),
      ],
      edges: [
        { id: "1", source: "start", target: "delay" },
        { id: "2", source: "delay", target: "text" },
        { id: "3", source: "text", target: "end" },
      ],
    };
    await owner.call(`/bots/${bot.id}`, "PATCH", {
      name: bot.name,
      draft: graph,
      revision: bot.revision,
    });
    await owner.call(`/bots/${bot.id}/publish`, "POST", { revision: 2 });
    await incoming(owner, "+15555550731");
    const execution = await db.botExecution.findFirstOrThrow({
      where: { tenantId: owner.tenantId },
    });
    expect(execution.status).toBe("SLEEPING");
    await db.message.create({
      data: {
        tenantId: owner.tenantId,
        conversationId: execution.conversationId,
        direction: "OUTBOUND",
        status: "QUEUED",
        text: "Queued before expiry",
        idempotencyKey: randomUUID(),
      },
    });
    await db.tenantSubscription.update({
      where: { tenantId: owner.tenantId },
      data: { expiresAt: new Date(0) },
    });
    await db.botExecution.update({
      where: { id: execution.id },
      data: { wakeAt: new Date(0) },
    });
    await processScheduledExecutions(db);
    await drainMessaging(db, new MockWhatsAppProvider());
    expect(
      (await db.botExecution.findUniqueOrThrow({ where: { id: execution.id } }))
        .status,
    ).toBe("CANCELLED");
    expect(
      (
        await db.message.findFirstOrThrow({
          where: { tenantId: owner.tenantId, text: "Queued before expiry" },
        })
      ).status,
    ).toBe("FAILED");
    expect(
      (
        await owner.call(
          `/conversations/${execution.conversationId}/messages`,
          "POST",
          { text: "Cannot send", idempotencyKey: randomUUID() },
        )
      ).status,
    ).toBe(403);
    expect((await owner.call("/contacts")).status).toBe(200);
    expect(
      (await (await owner.call("/billing/subscription")).json()).status,
    ).toBe("EXPIRED");
  });
  it("provides bounded default trials and checks their expiry on the server", async () => {
    const owner = new Client();
    await owner.register();
    let value = await (await owner.call("/billing/subscription")).json();
    expect(value.source).toBe("TRIAL");
    expect(value.limits.bots).toBe(25);
    await db.tenant.update({
      where: { id: owner.tenantId },
      data: { createdAt: new Date(Date.now() - 15 * 86400000) },
    });
    value = await (await owner.call("/billing/subscription")).json();
    expect(value.active).toBe(false);
    expect(
      (await owner.call("/bots", "POST", { name: "Expired trial" })).status,
    ).toBe(403);
  });
});
