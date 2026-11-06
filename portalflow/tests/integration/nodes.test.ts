import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createDatabase } from "../../packages/database/src";
import {
  Flow,
  InteractiveReply,
  MediaMessage,
  makeNode,
} from "../../packages/shared/src";
const db = createDatabase(),
  origin = "http://localhost:3000";
const userIds: string[] = [],
  tenantIds: string[] = [],
  emails: string[] = [];
class Client {
  cookies = new Map<string, string>();
  tenantId = "";
  userId = "";
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
    const email = `nodes-${randomUUID()}@example.com`;
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
    this.userId = me.user.id;
    userIds.push(me.user.id);
    tenantIds.push(this.tenantId);
  }
}
const a = new Client(),
  b = new Client();
let worker: ChildProcess;
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
  media?: MediaMessage,
) {
  const data = {
    externalId: randomUUID(),
    phone,
    text,
    ...(reply ? { reply } : {}),
    ...(media ? { media } : {}),
  };
  const result = await a.call(
    bot ? `/bots/${bot}/simulate` : "/whatsapp/mock/inbound",
    "POST",
    data,
  );
  expect(result.status).toBe(201);
  return data.externalId;
}
async function save(flow: Flow, name: string, owner = a) {
  const created = await (await owner.call("/bots", "POST", { name })).json();
  const saved = await owner.call(`/bots/${created.id}`, "PATCH", {
    name,
    revision: created.revision,
    draft: flow,
  });
  expect(saved.status).toBe(200);
  return { id: created.id as string, revision: (await saved.json()).revision };
}
async function publish(flow: Flow, name: string, owner = a) {
  const created = await (await owner.call("/bots", "POST", { name })).json();
  const saved = await owner.call(`/bots/${created.id}`, "PATCH", {
    name,
    revision: created.revision,
    draft: flow,
  });
  expect(saved.status).toBe(200);
  const result = await owner.call(`/bots/${created.id}/publish`, "POST", {
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
const doc: MediaMessage = {
  kind: "document",
  url: "https://files.example.com/price-list.pdf",
  filename: "Price list.pdf",
};
function catalogueFlow(assignee: string): Flow {
  return {
    schemaVersion: 1,
    nodes: [
      makeNode("start", "start", 0, 0),
      makeNode("match", "keyword_match", 0, 100, {
        variable: "trigger_text",
        operator: "contains",
        value: "price, brochure",
      }),
      makeNode("doc", "send_document", 0, 200, {
        mediaUrl: doc.url,
        filename: doc.filename!,
        text: "Here is our price list.",
      }),
      makeNode("feedback", "save_input", 0, 300, { variable: "feedback" }),
      makeNode("assign", "assign_agent", 0, 400, { value: assignee }),
      makeNode("done", "end", 0, 500),
      makeNode("image", "send_image", 300, 200, {
        mediaUrl: "https://files.example.com/menu.jpg",
      }),
      makeNode("other", "end", 300, 300),
    ],
    edges: [
      { id: "1", source: "start", target: "match" },
      { id: "2", source: "match", target: "doc", sourceHandle: "true" },
      { id: "3", source: "match", target: "image", sourceHandle: "false" },
      { id: "4", source: "doc", target: "feedback" },
      { id: "5", source: "feedback", target: "assign" },
      { id: "6", source: "assign", target: "done" },
      { id: "7", source: "image", target: "other" },
    ],
  };
}
const execFor = (phone: string) => () =>
  db.botExecution.findFirst({
    where: { tenantId: a.tenantId, contact: { phone } },
  });
describe.sequential("media, keyword, save-input and assignment nodes", () => {
  it("refuses to publish an assignment to another workspace's user", async () => {
    const draft = await save(catalogueFlow(b.userId), "Foreign assignee");
    const result = await a.call(`/bots/${draft.id}/publish`, "POST", {
      revision: draft.revision,
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(await result.json())).toContain(
      "not an active agent",
    );
    const check = await (
      await a.call(`/bots/${draft.id}/validate`, "POST")
    ).json();
    expect(check.valid).toBe(false);
  });
  it("branches on keywords, sends a document, saves the reply and assigns the owner", async () => {
    const id = await publish(catalogueFlow(a.userId), "Catalogue");
    const phone = "+15555550301";
    await incoming("Please send the PRICE list", phone, id);
    const waiting = await until(execFor(phone), (e) => e?.status === "WAITING");
    expect(waiting!.currentNode).toBe("feedback");
    const sent = await until(
      () =>
        db.message.findFirst({
          where: {
            conversationId: waiting!.conversationId,
            direction: "OUTBOUND",
          },
        }),
      (m) => m?.status === "DELIVERED",
    );
    expect(sent!.media).toEqual(doc);
    expect(sent!.text).toBe("Here is our price list.");
    await incoming("Looks good, thanks", phone, id);
    const done = await until(execFor(phone), (e) => e?.status === "COMPLETED");
    expect((done!.variables as Record<string, string>).feedback).toBe(
      "Looks good, thanks",
    );
    expect(JSON.stringify(done!.logs)).toContain('"state":"assigned"');
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: done!.conversationId },
    });
    expect(conversation.assignedUserId).toBe(a.userId);
    const listed = await (
      await a.call(`/conversations/${done!.conversationId}/messages`)
    ).json();
    expect(
      listed.items.find((m: { media: unknown }) => m.media)?.media,
    ).toEqual(doc);
  });
  it("takes the no-match branch and sends an image without a caption", async () => {
    const id = await publish(catalogueFlow(a.userId), "Catalogue 2");
    const phone = "+15555550302";
    await incoming("Hello there", phone, id);
    const done = await until(execFor(phone), (e) => e?.status === "COMPLETED");
    expect(JSON.stringify(done!.logs)).toContain('"branch":false');
    const image = await until(
      () =>
        db.message.findFirst({
          where: {
            conversationId: done!.conversationId,
            direction: "OUTBOUND",
          },
        }),
      (m) => m?.status === "DELIVERED",
    );
    expect(image!.media).toEqual({
      kind: "image",
      url: "https://files.example.com/menu.jpg",
    });
    expect(image!.text).toBe("");
  });
  it("stores customer media, replays idempotently and rejects changed payloads", async () => {
    const phone = "+15555550303",
      media: MediaMessage = {
        kind: "image",
        url: "https://cdn.example.com/photo.jpg",
      },
      payload = { externalId: randomUUID(), phone, text: "", media };
    expect(
      (await a.call("/whatsapp/mock/inbound", "POST", payload)).status,
    ).toBe(201);
    const message = await until(
      () =>
        db.message.findFirst({
          where: {
            tenantId: a.tenantId,
            idempotencyKey: `in:${payload.externalId}`,
          },
        }),
      (m) => !!m,
    );
    expect(message!.media).toEqual(media);
    expect(
      (await a.call("/whatsapp/mock/inbound", "POST", payload)).status,
    ).toBe(201);
    expect(
      (
        await a.call("/whatsapp/mock/inbound", "POST", {
          ...payload,
          media: { ...media, url: "https://cdn.example.com/other.jpg" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await a.call("/whatsapp/mock/inbound", "POST", {
          externalId: randomUUID(),
          phone,
          text: "",
          media: { kind: "image", url: "http://cdn.example.com/photo.jpg" },
        })
      ).status,
    ).toBe(400);
    const conversationId = message!.conversationId;
    const unsafe = await a.call(
      `/conversations/${conversationId}/messages`,
      "POST",
      {
        text: "See attached",
        idempotencyKey: randomUUID(),
        media: { kind: "document", url: "https://127.0.0.1/x.pdf" },
      },
    );
    expect(unsafe.status).toBe(400);
    const reply = {
      text: "Our catalogue",
      idempotencyKey: randomUUID(),
      media: doc,
    };
    const sent = await a.call(
      `/conversations/${conversationId}/messages`,
      "POST",
      reply,
    );
    expect(sent.status).toBe(201);
    expect(
      (await a.call(`/conversations/${conversationId}/messages`, "POST", reply))
        .status,
    ).toBe(201);
    const delivered = await until(
      () =>
        db.message.findFirst({
          where: { tenantId: a.tenantId, idempotencyKey: reply.idempotencyKey },
        }),
      (m) => m?.status === "DELIVERED",
    );
    expect(delivered!.media).toEqual(doc);
    expect(
      (await b.call(`/conversations/${conversationId}/messages`)).status,
    ).toBe(404);
  });
  it("calls an allowed HTTP endpoint from the worker and branches on the result", async () => {
    const received: Array<{ key: unknown; body: string }> = [];
    let respond = 200;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ key: req.headers["idempotency-key"], body });
        res.writeHead(respond, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "shipped" }));
      });
    });
    await new Promise<void>((r) => server.listen(47811, "127.0.0.1", r));
    try {
      const flow: Flow = {
        schemaVersion: 1,
        nodes: [
          makeNode("start", "start", 0, 0),
          makeNode("order", "ask", 0, 100, {
            text: "Order number?",
            variable: "order_number",
          }),
          makeNode("call", "http_request", 0, 200, {
            url: "http://127.0.0.1:47811/orders",
            sendVariables: "order_number",
            responseField: "status",
            variable: "order_status",
          }),
          makeNode("ok", "text", 0, 300, { text: "Order is {{order_status}}" }),
          makeNode("bad", "text", 300, 300, { text: "Lookup failed" }),
          makeNode("end1", "end", 0, 400),
          makeNode("end2", "end", 300, 400),
        ],
        edges: [
          { id: "1", source: "start", target: "order" },
          { id: "2", source: "order", target: "call" },
          { id: "3", source: "call", target: "ok", sourceHandle: "true" },
          { id: "4", source: "call", target: "bad", sourceHandle: "false" },
          { id: "5", source: "ok", target: "end1" },
          { id: "6", source: "bad", target: "end2" },
        ],
      };
      const id = await publish(flow, "Order lookup");
      const phone = "+15555550304";
      await incoming("Hi", phone, id);
      await until(execFor(phone), (e) => e?.status === "WAITING");
      await incoming("A-1001", phone, id);
      const done = await until(
        execFor(phone),
        (e) => e?.status === "COMPLETED",
      );
      expect((done!.variables as Record<string, string>).order_status).toBe(
        "shipped",
      );
      expect(JSON.stringify(done!.logs)).toContain('"state":"succeeded"');
      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0]!.body).variables).toEqual({
        order_number: "A-1001",
      });
      expect(String(received[0]!.key)).toContain(done!.id);
      expect(
        await db.message.count({
          where: {
            conversationId: done!.conversationId,
            text: "Order is shipped",
          },
        }),
      ).toBe(1);
      respond = 503;
      const failPhone = "+15555550305";
      await incoming("Hi", failPhone, id);
      await until(execFor(failPhone), (e) => e?.status === "WAITING");
      await incoming("A-1002", failPhone, id);
      const failed = await until(
        execFor(failPhone),
        (e) => e?.status === "COMPLETED",
      );
      expect(JSON.stringify(failed!.logs)).toContain('"httpStatus":503');
      expect(
        await db.message.count({
          where: {
            conversationId: failed!.conversationId,
            text: "Lookup failed",
          },
        }),
      ).toBe(1);
    } finally {
      server.close();
    }
  });
  it("refuses to publish an HTTP node aimed at a private address", async () => {
    const draft = await save(
      {
        schemaVersion: 1,
        nodes: [
          makeNode("start", "start", 0, 0),
          makeNode("call", "http_request", 0, 100, {
            url: "https://169.254.169.254/latest/meta-data",
          }),
          makeNode("a", "end", 0, 200),
          makeNode("b", "end", 200, 200),
        ],
        edges: [
          { id: "1", source: "start", target: "call" },
          { id: "2", source: "call", target: "a", sourceHandle: "true" },
          { id: "3", source: "call", target: "b", sourceHandle: "false" },
        ],
      },
      "Metadata probe",
    );
    expect(
      (
        await a.call(`/bots/${draft.id}/publish`, "POST", {
          revision: draft.revision,
        })
      ).status,
    ).toBe(400);
  });
  it("starts tag-added and API-triggered flows only through their own triggers", async () => {
    const tagFlow: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0, {
          trigger: "tag_added",
          value: "VIP",
        }),
        makeNode("hello", "text", 0, 100, { text: "Welcome to VIP support" }),
        makeNode("end", "end", 0, 200),
      ],
      edges: [
        { id: "1", source: "start", target: "hello" },
        { id: "2", source: "hello", target: "end" },
      ],
    };
    const apiFlow: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0, { trigger: "api" }),
        makeNode("ask", "ask", 0, 100, {
          text: "Rate our service from 1 to 5",
          variable: "rating",
          inputKind: "number",
        }),
        makeNode("end", "end", 0, 200),
      ],
      edges: [
        { id: "1", source: "start", target: "ask" },
        { id: "2", source: "ask", target: "end" },
      ],
    };
    const tagId = await publish(tagFlow, "VIP welcome", b);
    const apiId = await publish(apiFlow, "Feedback", b);
    const phone = "+15555550306";
    // Customer text equal to the tag must not start a tag-triggered flow.
    expect(
      (
        await b.call("/whatsapp/mock/inbound", "POST", {
          externalId: randomUUID(),
          phone,
          text: "VIP",
        })
      ).status,
    ).toBe(201);
    const contact = await until(
      () =>
        db.contact.findFirst({
          where: { tenantId: b.tenantId, phone },
          include: { conversation: true },
        }),
      (c) => !!c?.conversation,
    );
    await new Promise((r) => setTimeout(r, 1000));
    expect(
      await db.botExecution.count({ where: { tenantId: b.tenantId } }),
    ).toBe(0);
    expect(
      (await b.call(`/contacts/${contact!.id}`, "PATCH", { tags: ["vip"] }))
        .status,
    ).toBe(200);
    const tagged = await until(
      () =>
        db.botExecution.findFirst({
          where: { tenantId: b.tenantId, contactId: contact!.id },
        }),
      (e) => e?.status === "COMPLETED",
    );
    await until(
      () =>
        db.message.findFirst({
          where: {
            conversationId: tagged!.conversationId,
            text: "Welcome to VIP support",
          },
        }),
      (m) => m?.status === "DELIVERED",
    );
    // Saving the same tags again does not re-trigger.
    await b.call(`/contacts/${contact!.id}`, "PATCH", { tags: ["vip"] });
    expect(
      await db.botExecution.count({ where: { tenantId: b.tenantId } }),
    ).toBe(1);
    // The API trigger only starts flows whose Start trigger is "api".
    expect(
      (
        await b.call(`/bots/${tagId}/trigger`, "POST", {
          contactId: contact!.id,
        })
      ).status,
    ).toBe(409);
    const started = await b.call(`/bots/${apiId}/trigger`, "POST", {
      contactId: contact!.id,
    });
    expect(started.status).toBe(201);
    const outcome = await started.json();
    expect(outcome).toMatchObject({ started: true, flowId: apiId });
    const waiting = await db.botExecution.findUniqueOrThrow({
      where: { id: outcome.executionId },
    });
    expect(waiting.status).toBe("WAITING");
    const again = await b.call(`/bots/${apiId}/trigger`, "POST", {
      contactId: contact!.id,
    });
    expect(again.status).toBe(409);
    expect(JSON.stringify(await again.json())).toContain("already running");
    // Contacts that never messaged have no conversation to run in.
    const fresh = await (
      await b.call("/contacts", "POST", {
        name: "No chat",
        phone: "+15555550307",
      })
    ).json();
    expect(
      (await b.call(`/bots/${apiId}/trigger`, "POST", { contactId: fresh.id }))
        .status,
    ).toBe(409);
    // Another workspace cannot trigger this flow or target this contact.
    expect(
      (
        await a.call(`/bots/${apiId}/trigger`, "POST", {
          contactId: contact!.id,
        })
      ).status,
    ).toBe(404);
  });
});
