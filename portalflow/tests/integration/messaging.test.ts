import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src";
import { recordStatus } from "../../packages/core/src";
import { io } from "../../apps/web/src/lib/socket";
const db = createDatabase();
const base = "http://localhost:4000/api/v1";
const origin = "http://localhost:3000";
const ids: string[] = [],
  tenants: string[] = [],
  emails: string[] = [];
class Client {
  cookies = new Map<string, string>();
  tenantId = "";
  userId = "";
  sessionId = "";
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call(path: string, method = "GET", data?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: this.header(),
        "Content-Type": "application/json",
        "X-CSRF-Token": this.cookies.get("pf_csrf") ?? "",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    for (const value of res.headers.getSetCookie()) {
      const part = value.split(";")[0]!,
        index = part.indexOf("=");
      this.cookies.set(part.slice(0, index), part.slice(index + 1));
    }
    return res;
  }
  async register() {
    const email = `messaging-${randomUUID()}@example.com`;
    emails.push(email);
    expect(
      (
        await this.call("/auth/register", "POST", {
          email,
          name: "Inbox Owner",
          password: "MessagingPassword!2026",
          workspace: "Messaging Test",
        })
      ).status,
    ).toBe(201);
    const me = await (await this.call("/auth/me")).json();
    this.tenantId = me.tenant.id;
    this.userId = me.user.id;
    this.sessionId = me.sessionId;
    ids.push(this.userId);
    tenants.push(this.tenantId);
  }
  socket() {
    return io("http://localhost:4000", {
      transports: ["websocket"],
      extraHeaders: { Origin: origin, Cookie: this.header() },
      reconnection: false,
    });
  }
}
const a = new Client(),
  b = new Client();
let worker: ChildProcess;
let conversationId = "",
  contactId = "",
  messageId = "";
let aSocket: ReturnType<typeof io>, bSocket: ReturnType<typeof io>;
let bEvents = 0;
async function until<T>(
  fn: () => Promise<T>,
  valid: (value: T) => boolean,
): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const value = await fn();
    if (valid(value)) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Timed out waiting for background processing");
}
function event(socket: ReturnType<typeof io>, name: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Missing socket event: ${name}`)),
      10000,
    );
    socket.once(name, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
beforeAll(async () => {
  await Promise.all([a.register(), b.register()]);
  worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
    env: { ...process.env, EMAIL_DELIVERY_ENABLED: "false" },
    stdio: "ignore",
  });
  aSocket = a.socket();
  bSocket = b.socket();
  await Promise.all([event(aSocket, "ready"), event(bSocket, "ready")]);
  bSocket.on("inbox.changed", () => bEvents++);
});
afterAll(async () => {
  aSocket?.disconnect();
  bSocket?.disconnect();
  if (worker) {
    worker.kill("SIGTERM");
    await once(worker, "exit");
  }
  await db.tenant.deleteMany({ where: { id: { in: tenants } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.emailOutbox.deleteMany({ where: { recipient: { in: emails } } });
  await db.$disconnect();
});
describe.sequential(
  "mock WhatsApp through real BullMQ worker and sockets",
  () => {
    it("persists contact CRUD without granting marketing consent", async () => {
      const result = await a.call("/contacts", "POST", {
        name: "Customer One",
        phone: "+919000000001",
        tags: ["Lead"],
      });
      expect(result.status).toBe(201);
      const contact = await result.json();
      contactId = contact.id;
      expect(contact.optedInAt).toBeNull();
      expect((await b.call(`/contacts/${contactId}`)).status).toBe(404);
      expect(
        (await b.call(`/contacts/${contactId}`, "PATCH", { name: "Intruder" }))
          .status,
      ).toBe(404);
      expect(
        (
          await a.call(`/contacts/${contactId}`, "PATCH", {
            name: "Customer Updated",
          })
        ).status,
      ).toBe(200);
    });
    it("deduplicates incoming events and pushes changes only to the authorized tenant", async () => {
      const incoming = {
        externalId: randomUUID(),
        phone: "+919000000001",
        text: "Hello from customer",
      };
      const notified = event(aSocket, "inbox.changed");
      const responses = await Promise.all([
        a.call("/whatsapp/mock/inbound", "POST", incoming),
        a.call("/whatsapp/mock/inbound", "POST", incoming),
      ]);
      for (const response of responses) expect(response.status).toBe(201);
      await notified;
      const rows = await until(
        () => db.conversation.findMany({ where: { tenantId: a.tenantId } }),
        (value) => value.length === 1,
      );
      conversationId = rows[0]!.id;
      expect(await db.message.count({ where: { tenantId: a.tenantId } })).toBe(
        1,
      );
      expect(await db.contact.count({ where: { tenantId: a.tenantId } })).toBe(
        1,
      );
      expect(bEvents).toBe(0);
      const other = await (await b.call("/conversations")).json();
      expect(other.total).toBe(0);
      expect(
        (await b.call(`/conversations/${conversationId}/messages`)).status,
      ).toBe(404);
    });
    it("persists idempotent replies, queues delivery, and records status events once", async () => {
      const input = { text: "Reply from agent", idempotencyKey: randomUUID() };
      const sent = await a.call(
        `/conversations/${conversationId}/messages`,
        "POST",
        input,
      );
      expect(sent.status).toBe(201);
      messageId = (await sent.json()).id;
      const replay = await a.call(
        `/conversations/${conversationId}/messages`,
        "POST",
        input,
      );
      expect((await replay.json()).id).toBe(messageId);
      const message = await until(
        () => db.message.findUniqueOrThrow({ where: { id: messageId } }),
        (m) => m.status === "DELIVERED",
      );
      expect(message.providerId).toBe(`mock-out-${messageId}`);
      expect(await db.messageEvent.count({ where: { messageId } })).toBe(2);
      await db.$transaction(async (tx) => {
        await recordStatus(tx, a.tenantId, messageId, "READ");
        await recordStatus(tx, a.tenantId, messageId, "SENT");
        await recordStatus(tx, a.tenantId, messageId, "DELIVERED");
      });
      expect(
        (await db.message.findUniqueOrThrow({ where: { id: messageId } }))
          .status,
      ).toBe("READ");
      expect(await db.messageEvent.count({ where: { messageId } })).toBe(3);
    });
    it("assigns only tenant members and persists human takeover, notes, closure and release", async () => {
      expect(
        (
          await a.call(`/conversations/${conversationId}/assign`, "POST", {
            userId: b.userId,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await a.call(`/conversations/${conversationId}/assign`, "POST", {
            userId: a.userId,
          })
        ).status,
      ).toBe(201);
      expect(
        (await a.call(`/conversations/${conversationId}/takeover`, "POST"))
          .status,
      ).toBe(201);
      expect(
        (
          await a.call(`/conversations/${conversationId}/notes`, "POST", {
            text: "Internal context",
          })
        ).status,
      ).toBe(201);
      expect(
        (await b.call(`/conversations/${conversationId}/notes`)).status,
      ).toBe(404);
      expect(
        (
          await a.call(`/conversations/${conversationId}`, "PATCH", {
            status: "CLOSED",
          })
        ).status,
      ).toBe(200);
      expect(
        (await a.call(`/conversations/${conversationId}/release`, "POST"))
          .status,
      ).toBe(201);
      const conversation = await db.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(conversation.humanTakeover).toBe(false);
      expect(conversation.status).toBe("CLOSED");
      expect(conversation.assignedUserId).toBe(a.userId);
    });
    it("blocks free-form replies outside the service window", async () => {
      await db.conversation.update({
        where: { id: conversationId },
        data: { lastInboundAt: new Date(Date.now() - 86400001) },
      });
      expect(
        (
          await a.call(`/conversations/${conversationId}/messages`, "POST", {
            text: "Must not send",
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(403);
    });
    it("suppresses STOP contacts and records consent evidence", async () => {
      await a.call("/whatsapp/mock/inbound", "POST", {
        externalId: randomUUID(),
        phone: "+919000000001",
        text: "STOP",
      });
      await until(
        () => db.contact.findUniqueOrThrow({ where: { id: contactId } }),
        (c) => !!c.optedOutAt,
      );
      expect(
        (
          await a.call(`/conversations/${conversationId}/messages`, "POST", {
            text: "Suppressed",
            idempotencyKey: randomUUID(),
          })
        ).status,
      ).toBe(403);
      expect(
        await db.contactConsent.count({ where: { contactId, optedIn: false } }),
      ).toBe(1);
      expect(
        (
          await a.call(`/contacts/${contactId}/consent`, "POST", {
            optedIn: true,
            source: "Explicit consent recorded in test",
          })
        ).status,
      ).toBe(201);
      expect(await db.contactConsent.count({ where: { contactId } })).toBe(2);
    });
    it("enforces composite foreign keys against cross-tenant message insertion", async () => {
      await expect(
        db.message.create({
          data: {
            tenantId: b.tenantId,
            conversationId,
            direction: "OUTBOUND",
            status: "QUEUED",
            text: "Forbidden",
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toThrow();
    });
    it("disconnects a revoked session before delivering another websocket update", async () => {
      const disconnected = event(aSocket, "disconnect");
      expect(
        (await a.call(`/auth/sessions/${a.sessionId}`, "DELETE")).status,
      ).toBe(200);
      await db.inboundEvent.create({
        data: {
          tenantId: a.tenantId,
          externalId: randomUUID(),
          phone: "+919000000001",
          text: "After session revocation",
        },
      });
      await disconnected;
      expect(bEvents).toBe(0);
    });
  },
);
