import { z } from "zod";
export const nodeKinds = [
  "start",
  "text",
  "ask",
  "buttons",
  "list",
  "delay",
  "condition",
  "set_variable",
  "apply_tag",
  "remove_tag",
  "create_lead",
  "handoff",
  "end",
] as const;
export type NodeKind = (typeof nodeKinds)[number];
const key = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/)
  .refine((v) => !["constructor", "prototype", "__proto__"].includes(v));
export const flowNodeSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum(nodeKinds),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    data: z
      .object({
        options: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
                title: z.string().trim().min(1).max(20),
              })
              .strict(),
          )
          .max(10)
          .default([]),
        label: z.string().max(100),
        text: z.string().max(4096).default(""),
        variable: z.string().max(50).default(""),
        value: z.string().max(1000).default(""),
        operator: z
          .enum(["equals", "contains", "exists", "gte"])
          .default("equals"),
        delaySeconds: z.number().int().min(1).max(604800).default(60),
        timeoutSeconds: z.number().int().min(1).max(86400).default(86400),
        inputKind: z.enum(["text", "email", "number"]).default("text"),
        trigger: z.enum(["first", "keyword"]).default("first"),
      })
      .strict(),
  })
  .strict();
export const flowSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(flowNodeSchema).max(100),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            source: z.string(),
            target: z.string(),
            sourceHandle: z
              .string()
              .regex(/^(true|false|option:[a-zA-Z][a-zA-Z0-9_]{0,39})$/)
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type Flow = z.infer<typeof flowSchema>;
export type FlowNode = Flow["nodes"][number];
export function validateFlow(input: unknown): string[] {
  const parsed = flowSchema.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const flow = parsed.data,
    errors: string[] = [],
    ids = new Set(flow.nodes.map((n) => n.id));
  if (ids.size !== flow.nodes.length) errors.push("Node IDs must be unique");
  if (new Set(flow.edges.map((e) => e.id)).size !== flow.edges.length)
    errors.push("Edge IDs must be unique");
  const starts = flow.nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) errors.push("Exactly one Start node is required");
  for (const edge of flow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      errors.push(`Edge ${edge.id} references a missing node`);
    if (edge.source === edge.target) errors.push("Self loops are not allowed");
  }
  for (const node of flow.nodes) {
    const outgoing = flow.edges.filter((e) => e.source === node.id),
      incoming = flow.edges.filter((e) => e.target === node.id);
    if (node.type === "start" && incoming.length)
      errors.push("Start cannot have incoming connections");
    if (
      node.type === "start" &&
      node.data.trigger === "keyword" &&
      !node.data.value.trim()
    )
      errors.push("Keyword trigger needs a keyword");
    if (
      ["text", "ask", "buttons", "list"].includes(node.type) &&
      !node.data.text.trim()
    )
      errors.push(`${node.id}: message text is required`);
    if (
      ["ask", "buttons", "list", "condition", "set_variable"].includes(
        node.type,
      ) &&
      !key.safeParse(node.data.variable).success
    )
      errors.push(`${node.id}: use a valid variable name`);
    if (
      ["apply_tag", "remove_tag"].includes(node.type) &&
      (!node.data.value.trim() || node.data.value.length > 40)
    )
      errors.push(`${node.id}: a tag of 1–40 characters is required`);
    if (["buttons", "list"].includes(node.type)) {
      const options = node.data.options;
      if (
        options.length < 1 ||
        options.length > (node.type === "buttons" ? 3 : 10)
      )
        errors.push(
          `${node.id}: provide 1–${node.type === "buttons" ? 3 : 10} options`,
        );
      if (new Set(options.map((o) => o.id)).size !== options.length)
        errors.push(`${node.id}: option IDs must be unique`);
      if (
        new Set(options.map((o) => o.title.toLowerCase())).size !==
        options.length
      )
        errors.push(`${node.id}: option titles must be unique`);
      if (
        outgoing.length !== options.length ||
        options.some(
          (o) =>
            outgoing.filter((e) => e.sourceHandle === `option:${o.id}`)
              .length !== 1,
        )
      )
        errors.push(`${node.id}: connect exactly one branch per option`);
    } else if (node.type === "condition") {
      if (
        outgoing.length !== 2 ||
        !outgoing.some((e) => e.sourceHandle === "true") ||
        !outgoing.some((e) => e.sourceHandle === "false")
      )
        errors.push(`${node.id}: connect both true and false branches`);
    } else if (["end", "handoff"].includes(node.type)) {
      if (outgoing.length)
        errors.push(
          `${node.id}: terminal nodes cannot have outgoing connections`,
        );
    } else if (outgoing.length !== 1 || outgoing.some((e) => e.sourceHandle))
      errors.push(
        `${node.id}: exactly one default outgoing connection is required`,
      );
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) {
      errors.push("Cycles are not allowed");
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of flow.edges.filter((e) => e.source === id))
      if (ids.has(edge.target)) visit(edge.target);
    visiting.delete(id);
    visited.add(id);
  }
  if (starts[0]) visit(starts[0].id);
  if (visited.size !== ids.size)
    errors.push("All nodes must be reachable from Start");
  return [...new Set(errors)];
}
export function condition(
  value: string | undefined,
  operator: FlowNode["data"]["operator"],
  expected: string,
) {
  switch (operator) {
    case "exists":
      return !!value;
    case "contains":
      return (value ?? "").toLowerCase().includes(expected.toLowerCase());
    case "gte":
      return (
        value !== undefined &&
        value.trim() !== "" &&
        expected.trim() !== "" &&
        Number.isFinite(Number(value)) &&
        Number.isFinite(Number(expected)) &&
        Number(value) >= Number(expected)
      );
    default:
      return (value ?? "").toLowerCase() === expected.toLowerCase();
  }
}
export function interpolate(text: string, variables: Record<string, string>) {
  return text
    .replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g, (_match, key: string) =>
      Object.hasOwn(variables, key) ? variables[key]! : "",
    )
    .slice(0, 4096);
}
export function makeNode(
  id: string,
  type: NodeKind,
  x: number,
  y: number,
  data: Partial<FlowNode["data"]> = {},
): FlowNode {
  return {
    id,
    type,
    position: { x, y },
    data: {
      options: [],
      label: type.replaceAll("_", " "),
      text: "",
      variable: "",
      value: "",
      operator: "equals",
      inputKind: "text",
      trigger: "first",
      delaySeconds: 60,
      timeoutSeconds: 86400,
      ...data,
    },
  };
}
export const quotationFlow: Flow = {
  schemaVersion: 1,
  nodes: [
    makeNode("start", "start", 240, 0),
    makeNode("welcome", "text", 240, 130, {
      text: "Welcome! Let’s prepare your quotation.",
    }),
    makeNode("name", "ask", 240, 260, {
      text: "What is your name?",
      variable: "name",
    }),
    makeNode("requirement", "ask", 240, 390, {
      text: "What do you need?",
      variable: "requirement",
    }),
    makeNode("quantity", "ask", 240, 520, {
      text: "What quantity do you need?",
      variable: "quantity",
      inputKind: "number",
    }),
    makeNode("lead", "create_lead", 240, 650),
    makeNode("tag", "apply_tag", 240, 780, { value: "Quotation Lead" }),
    makeNode("confirm", "text", 240, 910, {
      text: "Thanks {{name}}. Your request for {{quantity}} × {{requirement}} has been recorded.",
    }),
    makeNode("end", "end", 240, 1040),
  ],
  edges: [
    "start",
    "welcome",
    "name",
    "requirement",
    "quantity",
    "lead",
    "tag",
    "confirm",
  ].map((source, i) => ({
    id: `edge-${i}`,
    source,
    target: [
      "welcome",
      "name",
      "requirement",
      "quantity",
      "lead",
      "tag",
      "confirm",
      "end",
    ][i]!,
  })),
};

function linearTemplate(nodes: FlowNode[]): Flow {
  return {
    schemaVersion: 1,
    nodes,
    edges: nodes.slice(0, -1).map((node, i) => ({
      id: `edge-${i}`,
      source: node.id,
      target: nodes[i + 1]!.id,
    })),
  };
}
export const flowTemplates: Array<{ name: string; flow: Flow }> = [
  {
    name: "Welcome Bot",
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("welcome", "text", 240, 150, {
        text: "Welcome! A teammate will help with your enquiry.",
      }),
      makeNode("end", "end", 240, 300),
    ]),
  },
  {
    name: "Lead Generation Bot",
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("name", "ask", 240, 150, {
        text: "What is your name?",
        variable: "name",
      }),
      makeNode("email", "ask", 240, 300, {
        text: "What is your email address?",
        variable: "email",
        inputKind: "email",
      }),
      makeNode("lead", "create_lead", 240, 450),
      makeNode("thanks", "text", 240, 600, {
        text: "Thanks {{name}}. Your enquiry has been recorded.",
      }),
      makeNode("end", "end", 240, 750),
    ]),
  },
  ...[
    ["Product Enquiry Bot", "product", "Which product interests you?"],
    ["Service Enquiry Bot", "service", "Which service do you need?"],
  ].map(([name, variable, text]) => ({
    name: name!,
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("question", "ask", 240, 150, {
        text: text!,
        variable: variable!,
      }),
      makeNode("lead", "create_lead", 240, 300),
      makeNode("handoff", "handoff", 240, 450, {
        text: "Your enquiry is recorded. A teammate will share verified details.",
      }),
    ]),
  })),
  { name: "Quotation Request Bot", flow: quotationFlow },
  {
    name: "Order Status Bot",
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("order", "ask", 240, 150, {
        text: "Please share your order number.",
        variable: "order_number",
      }),
      makeNode("handoff", "handoff", 240, 300, {
        text: "A teammate will check order {{order_number}} and confirm its status.",
      }),
    ]),
  },
  {
    name: "Appointment Booking Bot",
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("date", "ask", 240, 150, {
        text: "What date and time would you prefer?",
        variable: "requested_time",
      }),
      makeNode("lead", "create_lead", 240, 300),
      makeNode("handoff", "handoff", 240, 450, {
        text: "Your appointment request is recorded. A teammate must confirm availability; it is not yet booked.",
      }),
    ]),
  },
  {
    name: "FAQ Bot",
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("question", "ask", 240, 150, {
        text: "What would you like to know?",
        variable: "question",
      }),
      makeNode("handoff", "handoff", 240, 300, {
        text: "A teammate will answer using verified business information.",
      }),
    ]),
  },
  {
    name: "Customer Support Bot",
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("issue", "ask", 240, 150, {
        text: "Please describe the issue.",
        variable: "issue",
      }),
      makeNode("handoff", "handoff", 240, 300, {
        text: "Your support request has been handed to the team.",
      }),
    ]),
  },
  {
    name: "Human Agent Transfer Bot",
    flow: linearTemplate([
      makeNode("start", "start", 240, 0),
      makeNode("handoff", "handoff", 240, 150, {
        text: "Connecting you with a teammate. Please wait for their reply.",
      }),
    ]),
  },
];
