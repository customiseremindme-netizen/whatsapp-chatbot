import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
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
async function save(flow: Flow, name: string) {
  const created = await (await a.call("/bots", "POST", { name })).json();
  const saved = await a.call(`/bots/${created.id}`, "PATCH", {
    name,
    revision: created.revision,
    draft: flow,
  });
  expect(saved.status).toBe(200);
  return { id: created.id as string, revision: (await saved.json()).revision };
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
});
