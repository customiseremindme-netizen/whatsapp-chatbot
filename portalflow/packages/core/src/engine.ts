import { assertActive, EntitlementError, lockTenant } from "./entitlements";
import { callHttpNode, httpTestOrigins, type HttpCallResult } from "./http";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@portalflow/database";
import {
  Flow,
  flowSchema,
  validateFlow,
  condition,
  interpolate,
  emailSchema,
  keywordMatch,
  splitList,
  type InteractiveReply,
  type InteractiveMessage,
  type MediaMessage,
} from "@portalflow/shared";
function jsonVariables(value: Prisma.JsonValue): Record<string, string> {
  const result: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value))
    for (const [key, item] of Object.entries(value))
      if (
        typeof item === "string" &&
        !["__proto__", "constructor", "prototype"].includes(key)
      )
        result[key] = item;
  return result;
}
function nextNode(flow: Flow, id: string, branch?: boolean) {
  return flow.edges.find(
    (e) =>
      e.source === id &&
      (branch === undefined
        ? !e.sourceHandle
        : e.sourceHandle === String(branch)),
  )?.target;
}
export async function executeInbound(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    tenantId: string;
    text: string;
    simulationFlowId?: string | null;
    timerExecutionId?: string;
    reply?: InteractiveReply;
    /** Result of an HTTP Request node call made by the worker outside this transaction. */
    httpResult?: HttpCallResult;
  },
  conversationId: string,
  contactId: string,
) {
  await lockTenant(tx, event.tenantId);
  // Every entry path uses tenant → contact → conversation locks, including scheduled work.
  await tx.$queryRaw`SELECT id FROM "Contact" WHERE id=${contactId}::uuid AND "tenantId"=${event.tenantId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${conversationId}::uuid AND "tenantId"=${event.tenantId}::uuid FOR UPDATE`;
  const conversation = await tx.conversation.findFirstOrThrow({
    where: { id: conversationId, tenantId: event.tenantId },
    include: { contact: true, tenant: true },
  });
  if (conversation.tenant.suspendedAt) return;
  let execution = await tx.botExecution.findFirst({
    where: {
      tenantId: event.tenantId,
      conversationId,
      status: { in: ["RUNNING", "WAITING", "SLEEPING", "PAUSED"] },
      ...(event.timerExecutionId ? { id: event.timerExecutionId } : {}),
    },
    include: { flowVersion: true },
    orderBy: { createdAt: "desc" },
  });
  try {
    await assertActive(tx, event.tenantId);
  } catch (error) {
    if (!(error instanceof EntitlementError)) throw error;
    if (execution)
      await tx.botExecution.update({
        where: { id: execution.id },
        data: {
          status: "CANCELLED",
          wakeAt: null,
          waitExpiresAt: null,
          error: error.message,
        },
      });
    return;
  }
  if (conversation.contact.optedOutAt || conversation.contact.deletedAt) {
    if (execution)
      await tx.botExecution.update({
        where: { id: execution.id },
        data: {
          status: "CANCELLED",
          wakeAt: null,
          waitExpiresAt: null,
          error: "Contact suppressed",
        },
      });
    return;
  }
  if (conversation.humanTakeover || conversation.status !== "OPEN") return;
  if (execution?.status === "PAUSED") return;
  if (
    execution?.status === "WAITING" &&
    execution.waitExpiresAt &&
    execution.waitExpiresAt <= new Date()
  ) {
    await tx.botExecution.update({
      where: { id: execution.id },
      data: {
        status: "TIMED_OUT",
        waitingKey: null,
        waitExpiresAt: null,
        error: "Question answer deadline expired",
      },
    });
    return;
  }
  if (event.timerExecutionId && !execution) return;
  if (execution?.status === "SLEEPING") {
    // Incoming messages during a delay are stored, but never skip the delay or become an answer.
    if (
      !event.timerExecutionId ||
      !execution.wakeAt ||
      execution.wakeAt > new Date()
    )
      return;
    const sleepingAt = execution.flowVersion.data as {
      nodes?: Array<{ id?: unknown; type?: unknown }>;
    };
    const httpWait =
      sleepingAt.nodes?.find((n) => n.id === execution!.currentNode)?.type ===
      "http_request";
    if (httpWait && !event.httpResult) return;
    if (
      !httpWait &&
      (!conversation.lastInboundAt ||
        Date.now() - conversation.lastInboundAt.getTime() >= 86400000)
    ) {
      await tx.botExecution.update({
        where: { id: execution.id },
        data: {
          status: "TIMED_OUT",
          wakeAt: null,
          error: "Customer service window closed before scheduled resume",
        },
      });
      return;
    }
  } else if (event.timerExecutionId) return;
  if (!execution && event.reply) return;
  if (!execution) {
    const inboundCount = await tx.message.count({
      where: { tenantId: event.tenantId, conversationId, direction: "INBOUND" },
    });
    const flows = await tx.botFlow.findMany({
      where: {
        tenantId: event.tenantId,
        deletedAt: null,
        publishedVersion: { not: null },
        ...(event.simulationFlowId ? { id: event.simulationFlowId } : {}),
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    for (const candidate of flows) {
      const version = await tx.botFlowVersion.findUnique({
        where: {
          flowId_number: {
            flowId: candidate.id,
            number: candidate.publishedVersion!,
          },
        },
      });
      if (!version) continue;
      const parsed = flowSchema.safeParse(version.data);
      if (
        !parsed.success ||
        validateFlow(parsed.data, { httpOrigins: httpTestOrigins() }).length
      )
        continue;
      const start = parsed.data.nodes.find((n) => n.type === "start")!;
      // Tag and API triggers never start from customer text; see startTriggeredFlow.
      const matches =
        !!event.simulationFlowId ||
        (start.data.trigger === "first"
          ? inboundCount === 1
          : start.data.trigger === "keyword" &&
            event.text.trim().toLowerCase() ===
              start.data.value.trim().toLowerCase());
      if (!matches) continue;
      execution = await tx.botExecution.create({
        data: {
          tenantId: event.tenantId,
          contactId,
          conversationId,
          flowVersionId: version.id,
          currentNode: start.id,
          // trigger_text lets Keyword Match branch on the message that started the flow.
          variables: {
            phone: conversation.contact.phone,
            trigger_text: event.text.slice(0, 1000),
          },
        },
        include: { flowVersion: true },
      });
      break;
    }
  }
  if (!execution || execution.status === "PAUSED") return;
  const parsed = flowSchema.safeParse(execution.flowVersion.data);
  if (
    !parsed.success ||
    validateFlow(parsed.data, { httpOrigins: httpTestOrigins() }).length
  ) {
    await tx.botExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", error: "Published flow is invalid" },
    });
    return;
  }
  const flow = parsed.data,
    variables = jsonVariables(execution.variables);
  const logs: Prisma.InputJsonValue[] = Array.isArray(execution.logs)
    ? (execution.logs.filter((v) => v !== null) as Prisma.InputJsonValue[])
    : [];
  let current = execution.currentNode,
    steps = execution.steps,
    status = "RUNNING",
    waitingKey: string | null = null,
    wakeAt: Date | null = null,
    waitExpiresAt: Date | null = null,
    error: string | null = null;
  async function send(
    text: string,
    key: string,
    interactive?: InteractiveMessage,
    media?: MediaMessage,
  ) {
    if (!text.trim() && !media) return;
    await tx.message.createMany({
      data: [
        {
          tenantId: event.tenantId,
          conversationId,
          direction: "OUTBOUND",
          status: "QUEUED",
          text: interpolate(text, variables).slice(0, media ? 1024 : 4096),
          idempotencyKey: `bot:${execution!.id}:${key}`,
          botExecutionId: execution!.id,
          ...(interactive ? { interactive } : {}),
          ...(media ? { media } : {}),
        },
      ],
      skipDuplicates: true,
    });
  }
  if (execution.status === "SLEEPING") {
    const delay = flow.nodes.find((n) => n.id === current);
    if (delay?.type === "http_request" && event.httpResult) {
      const result = event.httpResult;
      if (delay.data.variable)
        variables[delay.data.variable] = delay.data.responseField
          ? result.value
          : String(result.status);
      logs.push({
        nodeId: current,
        type: "http_request",
        state: result.ok ? "succeeded" : "failed",
        httpStatus: result.status,
        ...(result.error ? { error: result.error } : {}),
        at: new Date().toISOString(),
      });
      current = nextNode(flow, current, result.ok) ?? "";
    } else if (!delay || delay.type !== "delay") {
      await tx.botExecution.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          wakeAt: null,
          error: "Invalid scheduled state",
        },
      });
      return;
    } else {
      logs.push({
        nodeId: current,
        type: "delay",
        state: "resumed",
        at: new Date().toISOString(),
      });
      current = nextNode(flow, current) ?? "";
    }
  }
  if (
    execution.status === "WAITING" &&
    ["buttons", "list"].includes(
      flow.nodes.find((n) => n.id === current)?.type ?? "",
    )
  ) {
    const waiting = flow.nodes.find((n) => n.id === current)!;
    const option = waiting.data.options.find(
      (o) => o.id === event.reply?.optionId,
    );
    const prompt =
      event.reply &&
      (await tx.message.findFirst({
        where: {
          id: event.reply.messageId,
          tenantId: event.tenantId,
          conversationId,
          botExecutionId: execution.id,
          idempotencyKey: `bot:${execution.id}:${current}:${execution.steps}`,
          status: { in: ["SENT", "DELIVERED", "READ"] },
        },
      }));
    if (!option || !prompt) {
      await send(
        "Please select an option from the latest menu.",
        `invalid:${event.id}`,
      );
      return;
    }
    variables[execution.waitingKey!] = option.id;
    logs.push({
      nodeId: current,
      type: waiting.type,
      state: "selected",
      optionId: option.id,
      at: new Date().toISOString(),
    });
    current =
      flow.edges.find(
        (e) => e.source === current && e.sourceHandle === `option:${option.id}`,
      )?.target ?? "";
  } else if (execution.status === "WAITING") {
    // A replayed menu reply must never answer a subsequent free-text question.
    if (event.reply) return;
    const waiting = flow.nodes.find((n) => n.id === current);
    if (
      !waiting ||
      !["ask", "save_input"].includes(waiting.type) ||
      !execution.waitingKey
    ) {
      await tx.botExecution.update({
        where: { id: execution.id },
        data: { status: "FAILED", error: "Invalid waiting state" },
      });
      return;
    }
    const input = event.text.trim();
    const valid =
      waiting.data.inputKind === "email"
        ? emailSchema.safeParse(input).success
        : waiting.data.inputKind === "number"
          ? input !== "" && Number.isFinite(Number(input)) && Number(input) >= 0
          : input.length > 0;
    if (!valid) {
      await send(
        `Please enter a valid ${waiting.data.inputKind === "number" ? "non-negative number" : waiting.data.inputKind === "email" ? "email address" : "answer"}.`,
        `invalid:${event.id}`,
      );
      return;
    }
    variables[execution.waitingKey] = input;
    logs.push({
      nodeId: current,
      type: waiting.type,
      state: "answered",
      at: new Date().toISOString(),
    });
    current = nextNode(flow, current) ?? "";
  }
  while (status === "RUNNING") {
    if (++steps > 100) {
      status = "FAILED";
      error = "Maximum execution steps exceeded";
      break;
    }
    const node = flow.nodes.find((n) => n.id === current);
    if (!node) {
      status = "FAILED";
      error = "Missing current node";
      break;
    }
    logs.push({
      nodeId: node.id,
      type: node.type,
      state: "executed",
      at: new Date().toISOString(),
    });
    switch (node.type) {
      case "start":
        break;
      case "text":
        await send(node.data.text, `${node.id}:${steps}`);
        break;
      case "send_image":
      case "send_document":
        await send(node.data.text, `${node.id}:${steps}`, undefined, {
          kind: node.type === "send_image" ? "image" : "document",
          url: node.data.mediaUrl,
          ...(node.type === "send_document" && node.data.filename
            ? { filename: node.data.filename }
            : {}),
        });
        break;
      case "save_input":
        // Waits silently for the customer's next message and stores it.
        waitingKey = node.data.variable;
        status = "WAITING";
        waitExpiresAt = new Date(Date.now() + node.data.timeoutSeconds * 1000);
        break;
      case "keyword_match": {
        const branch = keywordMatch(
          variables[node.data.variable],
          node.data.value,
          node.data.operator,
        );
        logs.push({ nodeId: node.id, branch });
        current = nextNode(flow, node.id, branch) ?? "";
        continue;
      }
      case "assign_agent": {
        // Only active, non-viewer members of this tenant can receive a conversation.
        const member = await tx.tenantMembership.findFirst({
          where: {
            tenantId: event.tenantId,
            userId: node.data.value,
            role: { not: "VIEWER" },
          },
          select: { userId: true },
        });
        if (member)
          await tx.conversation.update({
            where: { id: conversationId },
            data: { assignedUserId: member.userId },
          });
        logs.push({
          nodeId: node.id,
          type: "assign_agent",
          state: member ? "assigned" : "skipped_not_member",
          at: new Date().toISOString(),
        });
        break;
      }
      case "buttons":
      case "list":
        await send(node.data.text, `${node.id}:${steps}`, {
          kind: node.type,
          options: node.data.options,
        });
        waitingKey = node.data.variable;
        status = "WAITING";
        waitExpiresAt = new Date(Date.now() + node.data.timeoutSeconds * 1000);
        break;
      case "ask":
        await send(node.data.text, `${node.id}:${steps}`);
        waitingKey = node.data.variable;
        status = "WAITING";
        waitExpiresAt = new Date(Date.now() + node.data.timeoutSeconds * 1000);
        break;
      case "delay":
        status = "SLEEPING";
        wakeAt = new Date(Date.now() + node.data.delaySeconds * 1000);
        break;
      case "http_request":
        // Yield; the worker performs the call outside any transaction and resumes.
        status = "SLEEPING";
        wakeAt = new Date();
        break;
      case "set_variable":
        variables[node.data.variable] = interpolate(node.data.value, variables);
        break;
      case "condition": {
        const branch = condition(
          variables[node.data.variable],
          node.data.operator,
          interpolate(node.data.value, variables),
        );
        logs.push({ nodeId: node.id, branch });
        current = nextNode(flow, node.id, branch) ?? "";
        continue;
      }
      case "apply_tag":
      case "remove_tag": {
        const contact = await tx.contact.findUniqueOrThrow({
          where: { id: contactId },
        });
        const tags =
          node.type === "apply_tag"
            ? [...new Set([...contact.tags, node.data.value])]
            : contact.tags.filter((t) => t !== node.data.value);
        await tx.contact.update({
          where: { id: contactId },
          data: { tags: tags.slice(0, 20) },
        });
        break;
      }
      case "create_lead": {
        await tx.lead.upsert({
          where: { executionId: execution.id },
          create: {
            tenantId: event.tenantId,
            contactId,
            conversationId,
            executionId: execution.id,
            values: variables,
          },
          update: { values: variables },
        });
        await tx.contact.update({
          where: { id: contactId },
          data: {
            ...(variables.name ? { name: variables.name.slice(0, 100) } : {}),
            ...(variables.email &&
            emailSchema.safeParse(variables.email).success
              ? { email: variables.email }
              : {}),
            customFields: variables,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: event.tenantId,
            action: "lead.created",
            resourceId: execution.id,
          },
        });
        break;
      }
      case "handoff":
        await send(
          node.data.text || "A teammate will help you shortly.",
          `${node.id}:${steps}`,
        );
        await tx.conversation.update({
          where: { id: conversationId },
          data: { humanTakeover: true },
        });
        status = "HANDOFF";
        break;
      case "end":
        status = "COMPLETED";
        break;
    }
    if (status === "RUNNING") current = nextNode(flow, node.id) ?? "";
  }
  await tx.botExecution.update({
    where: { id: execution.id },
    data: {
      currentNode: current,
      steps,
      variables,
      status,
      waitingKey,
      wakeAt,
      waitExpiresAt,
      logs: logs.slice(-200),
      error,
    },
  });
}

/** Durable timer reconciliation, driven by BullMQ's recurring messaging job.
 * PostgreSQL deadlines are authoritative; Redis loss or worker downtime cannot lose timers.
 * Row locks and a fresh status/deadline check prevent duplicate execution by multiple workers.
 */
export async function processScheduledExecutions(db: PrismaClient) {
  const now = new Date();
  const due = await db.botExecution.findMany({
    where: {
      tenant: { suspendedAt: null },
      conversation: { status: "OPEN", humanTakeover: false },
      OR: [
        { status: "SLEEPING", wakeAt: { lte: now } },
        { status: "WAITING", waitExpiresAt: { lte: now } },
      ],
    },
    select: { id: true, tenantId: true, contactId: true, conversationId: true },
    orderBy: { updatedAt: "asc" },
    take: 25,
  });
  // HTTP Request nodes are called concurrently so one slow endpoint cannot stall other timers.
  const httpResults = await Promise.all(
    due.map((execution) => pendingHttpCall(db, execution.id)),
  );
  for (const [index, execution] of due.entries()) {
    const httpResult = httpResults[index];
    await db.$transaction(
      (tx) =>
        executeInbound(
          tx,
          {
            id: `timer-${execution.id}`,
            tenantId: execution.tenantId,
            text: "",
            timerExecutionId: execution.id,
            ...(httpResult ? { httpResult } : {}),
          },
          execution.conversationId,
          execution.contactId,
        ),
      { timeout: 30000 },
    );
  }
  return due.map(({ tenantId, conversationId }) => ({
    tenantId,
    conversationId,
  }));
}

/** If a due execution is parked on an HTTP Request node, perform that call now,
 * outside any database transaction or row lock. At-least-once: a crash after the
 * call but before commit repeats it with the same Idempotency-Key header. */
async function pendingHttpCall(
  db: PrismaClient,
  executionId: string,
): Promise<HttpCallResult | undefined> {
  const execution = await db.botExecution.findUnique({
    where: { id: executionId },
    include: { flowVersion: true },
  });
  if (!execution || execution.status !== "SLEEPING") return undefined;
  const parsed = flowSchema.safeParse(execution.flowVersion.data);
  if (!parsed.success) return undefined;
  const node = parsed.data.nodes.find((n) => n.id === execution.currentNode);
  if (node?.type !== "http_request") return undefined;
  const variables = jsonVariables(execution.variables);
  const sent: Record<string, string> = {};
  for (const name of splitList(node.data.sendVariables))
    if (Object.hasOwn(variables, name)) sent[name] = variables[name]!;
  return callHttpNode({
    url: node.data.url,
    method: node.data.method,
    body: {
      event: "portalflow.flow.http_request",
      executionId: execution.id,
      nodeId: node.id,
      variables: sent,
    },
    idempotencyKey: `${execution.id}:${node.id}:${execution.steps}`,
    responseField: node.data.responseField || undefined,
  });
}

export type TriggerOutcome =
  | { started: true; executionId: string; flowId: string }
  | {
      started: false;
      reason:
        | "no_conversation"
        | "active_session"
        | "no_matching_flow"
        | "not_started";
    };
/** Starts a flow for a contact from a non-message trigger (tag added, or an
 * authorized API/teammate request). Runs inside the caller's transaction and uses
 * the same engine entry, locks and takeover/suppression/window rules as inbound
 * messages. Bot apply_tag steps do not fire tag triggers, which prevents loops. */
export async function startTriggeredFlow(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    contactId: string;
    trigger: "tag_added" | "api";
    tag?: string;
    flowId?: string;
  },
): Promise<TriggerOutcome> {
  await lockTenant(tx, input.tenantId);
  await tx.$queryRaw`SELECT id FROM "Contact" WHERE id=${input.contactId}::uuid AND "tenantId"=${input.tenantId}::uuid FOR UPDATE`;
  const conversation = await tx.conversation.findFirst({
    where: { tenantId: input.tenantId, contactId: input.contactId },
  });
  if (!conversation) return { started: false, reason: "no_conversation" };
  const active = await tx.botExecution.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      status: { in: ["RUNNING", "WAITING", "SLEEPING", "PAUSED"] },
    },
  });
  if (active) return { started: false, reason: "active_session" };
  const flows = await tx.botFlow.findMany({
    where: {
      tenantId: input.tenantId,
      deletedAt: null,
      publishedVersion: { not: null },
      ...(input.flowId ? { id: input.flowId } : {}),
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  for (const candidate of flows) {
    const version = await tx.botFlowVersion.findUnique({
      where: {
        flowId_number: {
          flowId: candidate.id,
          number: candidate.publishedVersion!,
        },
      },
    });
    const parsed = version && flowSchema.safeParse(version.data);
    if (!parsed || !parsed.success) continue;
    const start = parsed.data.nodes.find((n) => n.type === "start");
    if (
      !start ||
      start.data.trigger !== input.trigger ||
      (input.trigger === "tag_added" &&
        start.data.value.trim().toLowerCase() !==
          (input.tag ?? "").trim().toLowerCase())
    )
      continue;
    const before = await tx.botExecution.findMany({
      where: { tenantId: input.tenantId, conversationId: conversation.id },
      select: { id: true },
    });
    await executeInbound(
      tx,
      {
        id: `trigger-${randomUUID()}`,
        tenantId: input.tenantId,
        text: "",
        simulationFlowId: candidate.id,
      },
      conversation.id,
      input.contactId,
    );
    const execution = await tx.botExecution.findFirst({
      where: {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        flowVersionId: version!.id,
        id: { notIn: before.map((e) => e.id) },
      },
    });
    return execution
      ? { started: true, executionId: execution.id, flowId: candidate.id }
      : { started: false, reason: "not_started" };
  }
  return { started: false, reason: "no_matching_flow" };
}
