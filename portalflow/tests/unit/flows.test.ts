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
