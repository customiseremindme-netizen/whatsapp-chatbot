import { describe, it, expect } from "vitest";
import {
  flowTemplates,
  quotationFlow,
  validateFlow,
  condition,
  interpolate,
  makeNode,
  Flow,
  flowSchema,
  isSafeMediaUrl,
  keywordMatch,
  mediaSchema,
  messageSchema,
} from "../../packages/shared/src";
describe("flow contract", () => {
  it.each(flowTemplates)("validates the $name template", ({ flow }) =>
    expect(validateFlow(flow)).toEqual([]),
  );
  it("rejects cycles, missing branches and unreachable nodes", () => {
    const flow: Flow = structuredClone(quotationFlow);
    flow.edges.push({ id: "cycle", source: "confirm", target: "name" });
    expect(validateFlow(flow).join(" ")).toContain("Cycles");
    flow.nodes.push(makeNode("orphan", "end", 0, 0));
    expect(validateFlow(flow).join(" ")).toContain("reachable");
    const branch: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0),
        makeNode("branch", "condition", 0, 100, { variable: "quantity" }),
        makeNode("end", "end", 0, 200),
      ],
      edges: [
        { id: "one", source: "start", target: "branch" },
        { id: "two", source: "branch", target: "end", sourceHandle: "true" },
      ],
    };
    expect(validateFlow(branch).join(" ")).toContain("both true and false");
  });
  it("evaluates conditions without executing user code", () => {
    expect(condition("12", "gte", "10")).toBe(true);
    expect(condition("NaN", "gte", "10")).toBe(false);
    expect(condition("", "gte", "0")).toBe(false);
    expect(condition("Hello", "contains", "ELL")).toBe(true);
    expect(condition(undefined, "exists", "")).toBe(false);
    expect(condition("constructor", "equals", "constructor")).toBe(true);
  });
  it("substitutes variables as plain text and ignores inherited properties", () => {
    expect(interpolate("Hi {{name}}. {{missing}}", { name: "Priya" })).toBe(
      "Hi Priya. ",
    );
    expect(interpolate("{{constructor}}", {})).toBe("");
    expect(interpolate("{{name}}", { name: "<script>alert(1)</script>" })).toBe(
      "<script>alert(1)</script>",
    );
  });
});

it("preserves old graph defaults and rejects invalid timer durations", () => {
  const legacy = {
    ...quotationFlow,
    nodes: quotationFlow.nodes.map((node) => {
      const data: Partial<typeof node.data> = { ...node.data };
      delete data.delaySeconds;
      delete data.timeoutSeconds;
      return { ...node, data };
    }),
  };
  const parsed = flowSchema.parse(legacy);
  expect(parsed.nodes[0]!.data.timeoutSeconds).toBe(86400);
  expect(parsed.nodes[0]!.data.delaySeconds).toBe(60);
  for (const duration of [0, -1, 604801, 1.5]) {
    legacy.nodes[0]!.data.delaySeconds = duration;
    expect(flowSchema.safeParse(legacy).success).toBe(false);
  }
});

it("requires one distinct branch per menu option and limits reply buttons", () => {
  const menu = makeNode("menu", "buttons", 0, 100, {
    text: "Choose",
    variable: "choice",
    options: [
      { id: "yes", title: "Yes" },
      { id: "no", title: "No" },
    ],
  });
  const flow: Flow = {
    schemaVersion: 1,
    nodes: [
      makeNode("start", "start", 0, 0),
      menu,
      makeNode("end", "end", 0, 200),
    ],
    edges: [
      { id: "1", source: "start", target: "menu" },
      { id: "2", source: "menu", target: "end", sourceHandle: "option:yes" },
      { id: "3", source: "menu", target: "end", sourceHandle: "option:no" },
    ],
  };
  expect(validateFlow(flow)).toEqual([]);
  flow.edges.pop();
  expect(validateFlow(flow).join(" ")).toContain("one branch per option");
  menu.data.options.push(
    { id: "yes", title: "Again" },
    { id: "more", title: "More" },
  );
  expect(validateFlow(flow).join(" ")).toContain("option IDs must be unique");
  expect(validateFlow(flow).join(" ")).toContain("1–3 options");
});
describe("media, keyword and assignment nodes", () => {
  const linear = (middle: ReturnType<typeof makeNode>): Flow => ({
    schemaVersion: 1,
    nodes: [
      makeNode("start", "start", 0, 0),
      middle,
      makeNode("end", "end", 0, 200),
    ],
    edges: [
      { id: "a", source: "start", target: middle.id },
      { id: "b", source: middle.id, target: "end" },
    ],
  });
  it("accepts only public https media links without credentials", () => {
    expect(isSafeMediaUrl("https://cdn.example.com/a.jpg")).toBe(true);
    for (const bad of [
      "http://cdn.example.com/a.jpg",
      "https://user:pw@cdn.example.com/a.jpg",
      "https://localhost/a.jpg",
      "https://printer.local/a.jpg",
      "https://10.0.0.5/a.jpg",
      "https://[::1]/a.jpg",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not a url",
    ])
      expect(isSafeMediaUrl(bad)).toBe(false);
  });
  it("validates the media message contract", () => {
    expect(
      mediaSchema.safeParse({
        kind: "document",
        url: "https://example.com/list.pdf",
        filename: "Price list.pdf",
      }).success,
    ).toBe(true);
    expect(
      mediaSchema.safeParse({
        kind: "document",
        url: "https://example.com/list.pdf",
        filename: "../etc/passwd",
      }).success,
    ).toBe(false);
    expect(
      mediaSchema.safeParse({
        kind: "image",
        url: "https://example.com/a.jpg",
        filename: "a.jpg",
      }).success,
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        text: "",
        idempotencyKey: crypto.randomUUID(),
        media: { kind: "image", url: "https://example.com/a.jpg" },
      }).success,
    ).toBe(true);
    expect(
      messageSchema.safeParse({ text: "", idempotencyKey: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(
      messageSchema.safeParse({
        text: "x".repeat(1025),
        idempotencyKey: crypto.randomUUID(),
        media: { kind: "image", url: "https://example.com/a.jpg" },
      }).success,
    ).toBe(false);
  });
  it("validates media nodes", () => {
    expect(
      validateFlow(
        linear(
          makeNode("doc", "send_document", 0, 100, {
            mediaUrl: "https://example.com/list.pdf",
            filename: "List.pdf",
          }),
        ),
      ),
    ).toEqual([]);
    expect(
      validateFlow(
        linear(
          makeNode("img", "send_image", 0, 100, {
            mediaUrl: "http://x.com/a.png",
          }),
        ),
      ).join(" "),
    ).toContain("https://");
    expect(
      validateFlow(
        linear(
          makeNode("img", "send_image", 0, 100, {
            mediaUrl: "https://example.com/a.png",
            text: "x".repeat(1025),
          }),
        ),
      ).join(" "),
    ).toContain("1024");
  });
  it("matches keywords case-insensitively in exact or contains mode", () => {
    expect(keywordMatch("Send PRICE list", "price, brochure", "contains")).toBe(
      true,
    );
    expect(keywordMatch("Send PRICE list", "price", "equals")).toBe(false);
    expect(keywordMatch(" Price ", "price", "equals")).toBe(true);
    expect(keywordMatch("", "price", "contains")).toBe(false);
    expect(keywordMatch(undefined, "price", "contains")).toBe(false);
  });
  it("requires keyword branches, keywords and a teammate", () => {
    const flow: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0),
        makeNode("match", "keyword_match", 0, 100, { value: "price" }),
        makeNode("end", "end", 0, 200),
      ],
      edges: [
        { id: "1", source: "start", target: "match" },
        { id: "2", source: "match", target: "end", sourceHandle: "true" },
      ],
    };
    expect(validateFlow(flow).join(" ")).toContain("both true and false");
    flow.nodes.push(makeNode("other", "end", 0, 300));
    flow.edges.push({
      id: "3",
      source: "match",
      target: "other",
      sourceHandle: "false",
    });
    expect(validateFlow(flow)).toEqual([]);
    flow.nodes[1]!.data.value = " , ";
    expect(validateFlow(flow).join(" ")).toContain("keywords");
    expect(
      validateFlow(linear(makeNode("assign", "assign_agent", 0, 100))).join(
        " ",
      ),
    ).toContain("teammate");
    expect(
      validateFlow(
        linear(
          makeNode("assign", "assign_agent", 0, 100, {
            value: crypto.randomUUID(),
          }),
        ),
      ),
    ).toEqual([]);
    expect(
      validateFlow(
        linear(makeNode("save", "save_input", 0, 100, { variable: "note" })),
      ),
    ).toEqual([]);
  });
  it("still parses flows saved before media fields existed", () => {
    const legacy = structuredClone(quotationFlow) as unknown as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    for (const node of legacy.nodes) {
      delete node.data.mediaUrl;
      delete node.data.filename;
    }
    expect(flowSchema.parse(legacy).nodes[0]!.data.mediaUrl).toBe("");
  });
});
