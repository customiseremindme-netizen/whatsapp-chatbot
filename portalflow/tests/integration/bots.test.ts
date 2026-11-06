import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src";
import {
  Flow,
  InteractiveReply,
  flowTemplates,
  makeNode,
  quotationFlow,
} from "../../packages/shared/src";
const db = createDatabase(),
  origin = "http://localhost:3000";
const userIds: string[] = [],
  tenantIds: string[] = [],
  emails: string[] = [];
class Client {
  cookies = new Map<string, string>();
  tenantId = "";
  async call(path: string, method = "GET", body?: unknown) {
    const r = await fetch("http://localhost:4000/api/v1" + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        "X-CSRF-Token": this.cookies.get("pf_csrf") ?? "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of r.headers.getSetCookie()) {
      const s = cookie.split(";")[0]!,
        i = s.indexOf("=");
      this.cookies.set(s.slice(0, i), s.slice(i + 1));
    }
    return r;
  }
  async register() {
    const email = `bots-${randomUUID()}@example.com`;
    emails.push(email);
    expect(
      (
        await this.call("/auth/register", "POST", {
          email,
          name: "Bot Owner",
          password: "BotPassword!2026",
          workspace: "Bot Test",
        })
      ).status,
    ).toBe(201);
    const me = await (await this.call("/auth/me")).json();
    this.tenantId = me.tenant.id;
    userIds.push(me.user.id);
    tenantIds.push(this.tenantId);
  }
}
const a = new Client(),
  b = new Client();
let worker: ChildProcess;
let flowId = "",
  conversationId = "",
  executionId = "";
function start() {
  worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
    env: { ...process.env, EMAIL_DELIVERY_ENABLED: "false" },
    stdio: "ignore",
  });
}
async function stop() {
  if (worker) {
    worker.kill("SIGTERM");
    await once(worker, "exit");
  }
}
async function until<T>(
  fn: () => Promise<T>,
  valid: (value: T) => boolean,
): Promise<T> {
  for (let i = 0; i < 80; i++) {
    const value = await fn();
    if (valid(value)) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for bot worker");
}
async function incoming(
  text: string,
  phone = "+15555550201",
  bot?: string,
  reply?: InteractiveReply,
) {
  const data = {
    externalId: randomUUID(),
    phone,
    text,
    ...(reply ? { reply } : {}),
  };
  const result = await a.call(
    bot ? `/bots/${bot}/simulate` : "/whatsapp/mock/inbound",
    "POST",
    data,
  );
  expect(result.status).toBe(201);
  return data.externalId;
}
async function publish(flow: Flow, name: string) {
  const created = await (await a.call("/bots", "POST", { name })).json();
  const saved = await a.call(`/bots/${created.id}`, "PATCH", {
    name,
    revision: created.revision,
    draft: flow,
  });
  expect(saved.status).toBe(200);
  const result = await a.call(`/bots/${created.id}/publish`, "POST", {
    revision: (await saved.json()).revision,
  });
  expect(result.status).toBe(201);
  return created.id as string;
}
beforeAll(async () => {
  await Promise.all([a.register(), b.register()]);
  start();
});
afterAll(async () => {
  await stop();
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.emailOutbox.deleteMany({ where: { recipient: { in: emails } } });
  await db.$disconnect();
});
describe.sequential("persistent automation through API and real worker", () => {
  it("publishes a validated tenant-owned graph and rejects cross-tenant access", async () => {
    flowId = await publish(quotationFlow, "Quotation Bot");
    expect((await b.call(`/bots/${flowId}`)).status).toBe(404);
    expect(
      (await b.call(`/bots/${flowId}/publish`, "POST", { revision: 2 })).status,
    ).toBe(404);
    expect((await b.call(`/bots/${flowId}/executions`)).status).toBe(404);
    expect(
      (
        await a.call(`/bots/${flowId}`, "PATCH", {
          name: "Stale",
          revision: 1,
          draft: quotationFlow,
        })
      ).status,
    ).toBe(409);
  });
  it("starts on a normal incoming message and persists a waiting question", async () => {
    await incoming("Hello");
    const execution = await until(
      () =>
        db.botExecution.findFirst({
          where: { tenantId: a.tenantId, contact: { phone: "+15555550201" } },
        }),
      (e) => e?.status === "WAITING",
    );
    expect(execution?.currentNode).toBe("name");
    executionId = execution!.id;
    conversationId = execution!.conversationId;
    expect(
      await db.message.count({
        where: { conversationId, direction: "OUTBOUND" },
      }),
    ).toBe(2);
    const history = await (
      await a.call(`/conversations/${conversationId}/messages`)
    ).json();
    expect(history.items[1].text).toBe(
      "Welcome! Let’s prepare your quotation.",
    );
    expect(history.items[2].text).toBe("What is your name?");
  });
  it("resumes after worker restart using the pinned published version", async () => {
    const flow = await (await a.call(`/bots/${flowId}`)).json();
    const draft: Flow = structuredClone(quotationFlow);
    draft.nodes.find((n) => n.id === "requirement")!.data.text =
      "Changed in version two";
    const saved = await (
      await a.call(`/bots/${flowId}`, "PATCH", {
        name: "Quotation Bot",
        revision: flow.revision,
        draft,
      })
    ).json();
    expect(
      (
        await a.call(`/bots/${flowId}/publish`, "POST", {
          revision: saved.revision,
        })
      ).status,
    ).toBe(201);
    await stop();
    start();
    await incoming("Priya");
    const execution = await until(
      () =>
        db.botExecution.findUniqueOrThrow({
          where: { id: executionId },
          include: { flowVersion: true },
        }),
      (e) => e.currentNode === "requirement",
    );
    expect(execution.flowVersion.number).toBe(1);
    expect(execution.variables).toMatchObject({ name: "Priya" });
    expect(
      await db.message.count({
        where: { conversationId, text: "What do you need?" },
      }),
    ).toBe(1);
  });
  it("pauses for a human and resumes only after explicit release and new input", async () => {
    expect(
      (await a.call(`/conversations/${conversationId}/takeover`, "POST"))
        .status,
    ).toBe(201);
    await incoming("Do not capture this");
    await until(
      () =>
        db.inboundEvent.findFirst({
          where: { tenantId: a.tenantId, text: "Do not capture this" },
        }),
      (e) => e?.status === "PROCESSED",
    );
    let execution = await db.botExecution.findUniqueOrThrow({
      where: { id: executionId },
    });
    expect(execution.status).toBe("PAUSED");
    expect(execution.variables).not.toHaveProperty("requirement");
    expect(
      (await a.call(`/conversations/${conversationId}/release`, "POST")).status,
    ).toBe(201);
    await incoming("Printed boxes");
    execution = await until(
      () => db.botExecution.findUniqueOrThrow({ where: { id: executionId } }),
      (e) => e.currentNode === "quantity",
    );
    expect(execution.variables).toMatchObject({ requirement: "Printed boxes" });
  });
  it("validates answers, creates one lead, updates contact and confirms in the inbox", async () => {
    await incoming("many");
    await until(
      () =>
        db.message.count({
          where: {
            conversationId,
            text: "Please enter a valid non-negative number.",
          },
        }),
      (n) => n === 1,
    );
    expect(
      (await db.botExecution.findUniqueOrThrow({ where: { id: executionId } }))
        .status,
    ).toBe("WAITING");
    const event = await incoming("250");
    await until(
      () => db.botExecution.findUniqueOrThrow({ where: { id: executionId } }),
      (e) => e.status === "COMPLETED",
    );
    expect(await db.lead.count({ where: { tenantId: a.tenantId } })).toBe(1);
    const contact = await db.contact.findFirstOrThrow({
      where: { tenantId: a.tenantId, phone: "+15555550201" },
    });
    expect(contact.name).toBe("Priya");
    expect(contact.tags).toContain("Quotation Lead");
    expect(contact.customFields).toMatchObject({ quantity: "250" });
    await a.call("/whatsapp/mock/inbound", "POST", {
      externalId: event,
      phone: "+15555550201",
      text: "250",
    });
    expect(await db.lead.count({ where: { tenantId: a.tenantId } })).toBe(1);
    expect((await (await b.call("/leads")).json()).total).toBe(0);
    const messages = await (
      await a.call(`/conversations/${conversationId}/messages`)
    ).json();
    expect(
      messages.items.some((m: { text: string }) =>
        m.text.includes("250 × Printed boxes"),
      ),
    ).toBe(true);
  });
  it("takes the correct condition branch and records it in execution logs", async () => {
    const flow: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0),
        makeNode("quantity", "ask", 0, 100, {
          variable: "quantity",
          inputKind: "number",
          text: "How many?",
        }),
        makeNode("condition", "condition", 0, 200, {
          variable: "quantity",
          operator: "gte",
          value: "10",
        }),
        makeNode("bulk", "text", 0, 300, { text: "Bulk enquiry" }),
        makeNode("small", "text", 200, 300, { text: "Small enquiry" }),
        makeNode("end", "end", 0, 400),
      ],
      edges: [
        { id: "1", source: "start", target: "quantity" },
        { id: "2", source: "quantity", target: "condition" },
        { id: "3", source: "condition", target: "bulk", sourceHandle: "true" },
        {
          id: "4",
          source: "condition",
          target: "small",
          sourceHandle: "false",
        },
        { id: "5", source: "bulk", target: "end" },
        { id: "6", source: "small", target: "end" },
      ],
    };
    const id = await publish(flow, "Branch test");
    await incoming("Hello", "+15555550202", id);
    await until(
      () =>
        db.botExecution.findFirst({
          where: { tenantId: a.tenantId, contact: { phone: "+15555550202" } },
        }),
      (e) => e?.status === "WAITING",
    );
    await incoming("12", "+15555550202", id);
    const execution = await until(
      () =>
        db.botExecution.findFirst({
          where: { tenantId: a.tenantId, contact: { phone: "+15555550202" } },
        }),
      (e) => e?.status === "COMPLETED",
    );
    expect(JSON.stringify(execution!.logs)).toContain('"branch":true');
    expect(
      await db.message.count({
        where: {
          conversationId: execution!.conversationId,
          text: "Bulk enquiry",
        },
      }),
    ).toBe(1);
    expect(
      await db.message.count({
        where: {
          conversationId: execution!.conversationId,
          text: "Small enquiry",
        },
      }),
    ).toBe(0);
  });
  it("resumes a persisted delay after worker restart and explicit human release", async () => {
    const flow: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0),
        makeNode("delay", "delay", 0, 100, { delaySeconds: 60 }),
        makeNode("reply", "text", 0, 200, { text: "Resumed after downtime" }),
        makeNode("end", "end", 0, 300),
      ],
      edges: [
        { id: "1", source: "start", target: "delay" },
        { id: "2", source: "delay", target: "reply" },
        { id: "3", source: "reply", target: "end" },
      ],
    };
    const id = await publish(flow, "Durable delay");
    await incoming("Hello", "+15555550203", id);
    const execution = await until(
      () =>
        db.botExecution.findFirst({
          where: { tenantId: a.tenantId, contact: { phone: "+15555550203" } },
        }),
      (e) => e?.status === "SLEEPING",
    );
    await stop();
    expect(
      (
        await a.call(
          `/conversations/${execution!.conversationId}/takeover`,
          "POST",
        )
      ).status,
    ).toBe(201);
    await db.botExecution.update({
      where: { id: execution!.id },
      data: { wakeAt: new Date(0) },
    });
    start();
    expect(
      (
        await db.botExecution.findUniqueOrThrow({
          where: { id: execution!.id },
        })
      ).status,
    ).toBe("PAUSED");
    expect(
      (
        await a.call(
          `/conversations/${execution!.conversationId}/release`,
          "POST",
        )
      ).status,
    ).toBe(201);
    await until(
      () =>
        db.message.findFirst({
          where: {
            botExecutionId: execution!.id,
            text: "Resumed after downtime",
          },
        }),
      (m) => m?.status === "DELIVERED",
    );
    expect(
      await db.message.count({ where: { botExecutionId: execution!.id } }),
    ).toBe(1);
  });
  it.each(["buttons", "list"] as const)(
    "executes contextual %s replies across restart and rejects stale/foreign selections",
    async (kind) => {
      const phone = kind === "buttons" ? "+15555550301" : "+15555550302";
      const flow: Flow = {
        schemaVersion: 1,
        nodes: [
          makeNode("start", "start", 0, 0),
          makeNode("menu", kind, 0, 100, {
            text: "Select a route",
            variable: "route",
            options: [
              { id: "quote", title: "Quotation" },
              { id: "support", title: "Support" },
            ],
          }),
          makeNode("name", "ask", 0, 200, {
            text: "Your name for the quotation?",
            variable: "name",
          }),
          makeNode("lead", "create_lead", 0, 300),
          makeNode("end", "end", 0, 400),
          makeNode("handoff", "handoff", 300, 200, {
            text: "Support will assist you",
          }),
        ],
        edges: [
          { id: "1", source: "start", target: "menu" },
          {
            id: "2",
            source: "menu",
            sourceHandle: "option:quote",
            target: "name",
          },
          {
            id: "3",
            source: "menu",
            sourceHandle: "option:support",
            target: "handoff",
          },
          { id: "4", source: "name", target: "lead" },
          { id: "5", source: "lead", target: "end" },
        ],
      };
      const id = await publish(flow, `Interactive ${kind}`);
      await incoming("Hello", phone, id);
      const prompt = await until(
        () =>
          db.message.findFirst({
            where: {
              tenantId: a.tenantId,
              conversation: { contact: { phone } },
              text: "Select a route",
            },
          }),
        (m) => m?.status === "DELIVERED",
      );
      expect(prompt!.interactive).toMatchObject({
        kind,
        options: [
          { id: "quote", title: "Quotation" },
          { id: "support", title: "Support" },
        ],
      });
      await stop();
      start();
      await incoming("Quotation", phone, id, {
        messageId: randomUUID(),
        optionId: "quote",
      });
      await until(
        () =>
          db.message.count({
            where: {
              conversationId: prompt!.conversationId,
              text: "Please select an option from the latest menu.",
            },
          }),
        (n) => n === 1,
      );
      const reply = { messageId: prompt!.id, optionId: "quote" };
      const externalId = await incoming("Quotation", phone, id, reply);
      const execution = await until(
        () =>
          db.botExecution.findUniqueOrThrow({
            where: { id: prompt!.botExecutionId! },
          }),
        (e) => e.currentNode === "name",
      );
      expect(execution.variables).toMatchObject({ route: "quote" });
      const replay = await a.call(`/bots/${id}/simulate`, "POST", {
        externalId,
        phone,
        text: "Quotation",
        reply,
      });
      expect(replay.status).toBe(201);
      expect(
        (
          await a.call(`/bots/${id}/simulate`, "POST", {
            externalId,
            phone,
            text: "Quotation",
            reply: { ...reply, optionId: "support" },
          })
        ).status,
      ).toBe(409);
      const staleId = await incoming("Quotation", phone, id, reply);
      await until(
        () =>
          db.inboundEvent.findUniqueOrThrow({
            where: {
              tenantId_externalId: {
                tenantId: a.tenantId,
                externalId: staleId,
              },
            },
          }),
        (e) => e.status === "PROCESSED",
      );
      expect(
        (
          await db.botExecution.findUniqueOrThrow({
            where: { id: execution.id },
          })
        ).variables,
      ).not.toHaveProperty("name");
      await incoming("Meera", phone, id);
      await until(
        () =>
          db.botExecution.findUniqueOrThrow({ where: { id: execution.id } }),
        (e) => e.status === "COMPLETED",
      );
      expect(
        (
          await db.lead.findUniqueOrThrow({
            where: { executionId: execution.id },
          })
        ).values,
      ).toMatchObject({ route: "quote", name: "Meera" });
      // A different conversation cannot reuse the first conversation's prompt ID.
      const otherPhone = kind === "buttons" ? "+15555550303" : "+15555550304";
      await incoming("Hello", otherPhone, id);
      const otherPrompt = await until(
        () =>
          db.message.findFirst({
            where: {
              tenantId: a.tenantId,
              conversation: { contact: { phone: otherPhone } },
              text: "Select a route",
            },
          }),
        (m) => m?.status === "DELIVERED",
      );
      await incoming("Support", otherPhone, id, {
        messageId: prompt!.id,
        optionId: "support",
      });
      await until(
        () =>
          db.message.count({
            where: {
              conversationId: otherPrompt!.conversationId,
              text: "Please select an option from the latest menu.",
            },
          }),
        (n) => n === 1,
      );
      await incoming("Support", otherPhone, id, {
        messageId: otherPrompt!.id,
        optionId: "support",
      });
      await until(
        () =>
          db.botExecution.findUniqueOrThrow({
            where: { id: otherPrompt!.botExecutionId! },
          }),
        (e) => e.status === "HANDOFF",
      );
    },
  );
  it.each(flowTemplates)(
    "executes the $name template in simulator mode",
    async ({ name, flow }) => {
      const id = await publish(flow, name);
      const phone = `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, "0")}`;
      await incoming("Hello", phone, id);
      for (let turn = 0; turn < 8; turn++) {
        const execution = await until(
          () =>
            db.botExecution.findFirst({
              where: { tenantId: a.tenantId, contact: { phone } },
            }),
          (e) => !!e && e.status !== "RUNNING",
        );
        if (["COMPLETED", "HANDOFF"].includes(execution!.status)) return;
        expect(execution!.status).toBe("WAITING");
        const node = flow.nodes.find((n) => n.id === execution!.currentNode)!;
        await incoming(
          node.data.inputKind === "email"
            ? "customer@example.com"
            : node.data.inputKind === "number"
              ? "10"
              : "Test customer",
          phone,
          id,
        );
        await until(
          () =>
            db.botExecution.findUniqueOrThrow({ where: { id: execution!.id } }),
          (e) =>
            e.currentNode !== execution!.currentNode ||
            e.status !== execution!.status,
        );
      }
      throw new Error("Template did not terminate");
    },
  );
});
