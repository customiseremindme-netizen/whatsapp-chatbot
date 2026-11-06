import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  callHttpNode,
  httpLimits,
  httpTestOrigins,
  isPublicAddress,
} from "../../packages/core/src/http";
import {
  isSafeHttpTarget,
  makeNode,
  validateFlow,
  type Flow,
} from "../../packages/shared/src";

let server: Server,
  origin = "";
const seen: Array<{ headers: Record<string, unknown>; body: string }> = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ headers: req.headers, body });
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://169.254.169.254/" }).end();
      } else if (req.url === "/big") {
        res.end("x".repeat(httpLimits.responseBytes + 10));
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("{}"), 1000);
      } else if (req.url === "/fail") {
        res.writeHead(500).end("{}");
      } else {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "shipped", nested: { a: 1 } }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  delete process.env.HTTP_NODE_TEST_ORIGINS;
  server.close();
});

describe("HTTP Request node safety", () => {
  it("classifies private, loopback, metadata and mapped addresses as blocked", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.5.4",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });
  it("accepts only https targets on the standard port", () => {
    expect(isSafeHttpTarget("https://hooks.example.com/x")).toBe(true);
    expect(isSafeHttpTarget("https://hooks.example.com:443/x")).toBe(true);
    for (const bad of [
      "http://hooks.example.com/x",
      "https://hooks.example.com:8080/x",
      "https://user:pw@hooks.example.com/x",
      "https://127.0.0.1/x",
      "https://metadata.google.internal/x",
      "https://localhost/x",
      "ftp://hooks.example.com/x",
    ])
      expect(isSafeHttpTarget(bad)).toBe(false);
    expect(
      isSafeHttpTarget("http://127.0.0.1:9/x", ["http://127.0.0.1:9"]),
    ).toBe(true);
  });
  it("validates HTTP Request nodes and requires both branches", () => {
    const flow: Flow = {
      schemaVersion: 1,
      nodes: [
        makeNode("start", "start", 0, 0),
        makeNode("call", "http_request", 0, 100, {
          url: "https://hooks.example.com/order",
          sendVariables: "phone, order_number",
          responseField: "status",
          variable: "order_status",
        }),
        makeNode("ok", "end", 0, 200),
        makeNode("bad", "end", 200, 200),
      ],
      edges: [
        { id: "1", source: "start", target: "call" },
        { id: "2", source: "call", target: "ok", sourceHandle: "true" },
      ],
    };
    expect(validateFlow(flow).join(" ")).toContain("both true and false");
    flow.edges.push({
      id: "3",
      source: "call",
      target: "bad",
      sourceHandle: "false",
    });
    expect(validateFlow(flow)).toEqual([]);
    flow.nodes[1]!.data.url = "http://10.0.0.1/admin";
    expect(validateFlow(flow).join(" ")).toContain("public https://");
    flow.nodes[1]!.data.url = "https://hooks.example.com/order";
    flow.nodes[1]!.data.sendVariables = "ok, bad-name";
    expect(validateFlow(flow).join(" ")).toContain("variable names");
    flow.nodes[1]!.data.sendVariables = "";
    flow.nodes[1]!.data.variable = "";
    expect(validateFlow(flow).join(" ")).toContain("store the response field");
  });
  it("refuses test origins in production", () => {
    process.env.HTTP_NODE_TEST_ORIGINS = "http://127.0.0.1:1";
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => httpTestOrigins()).toThrow();
    } finally {
      process.env.NODE_ENV = env;
    }
  });
  it("blocks loopback without an explicit test origin", async () => {
    delete process.env.HTTP_NODE_TEST_ORIGINS;
    const result = await callHttpNode({
      url: `${origin}/ok`,
      method: "GET",
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
  it("posts JSON with an idempotency key and extracts one scalar field", async () => {
    process.env.HTTP_NODE_TEST_ORIGINS = origin;
    const result = await callHttpNode({
      url: `${origin}/ok`,
      method: "POST",
      body: { variables: { order: "A1" } },
      idempotencyKey: "exec:node:3",
      responseField: "status",
    });
    expect(result).toEqual({ ok: true, status: 200, value: "shipped" });
    const last = seen.at(-1)!;
    expect(last.headers["idempotency-key"]).toBe("exec:node:3");
    expect(JSON.parse(last.body)).toEqual({ variables: { order: "A1" } });
    expect(
      (
        await callHttpNode({
          url: `${origin}/ok`,
          method: "GET",
          idempotencyKey: "k",
          responseField: "nested",
        })
      ).value,
    ).toBe("");
  });
  it("does not follow redirects and bounds size, status and time", async () => {
    process.env.HTTP_NODE_TEST_ORIGINS = origin;
    const redirect = await callHttpNode({
      url: `${origin}/redirect`,
      method: "GET",
      idempotencyKey: "k",
    });
    expect(redirect).toMatchObject({ ok: false, status: 302 });
    const big = await callHttpNode({
      url: `${origin}/big`,
      method: "GET",
      idempotencyKey: "k",
    });
    expect(big).toMatchObject({ ok: false, error: "Response too large" });
    const failed = await callHttpNode({
      url: `${origin}/fail`,
      method: "GET",
      idempotencyKey: "k",
    });
    expect(failed).toMatchObject({ ok: false, status: 500 });
    const limit = httpLimits.timeoutMs;
    httpLimits.timeoutMs = 200;
    try {
      const slow = await callHttpNode({
        url: `${origin}/slow`,
        method: "GET",
        idempotencyKey: "k",
      });
      expect(slow).toMatchObject({ ok: false, error: "Timed out" });
    } finally {
      httpLimits.timeoutMs = limit;
    }
    const tooLarge = await callHttpNode({
      url: `${origin}/ok`,
      method: "POST",
      body: { x: "y".repeat(httpLimits.requestBytes) },
      idempotencyKey: "k",
    });
    expect(tooLarge).toMatchObject({ ok: false, error: "Request too large" });
  });
});
