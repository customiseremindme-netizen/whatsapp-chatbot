import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { isSafeHttpTarget } from "@portalflow/shared";

/** Addresses an outbound HTTP Request node may never reach. */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  // IPv4-mapped/compatible IPv6 forms are refused outright. (A BlockList rule for
  // ::ffff:0:0/96 would also match every plain IPv4 address.)
  if (family === 6 && /^(::ffff:|::\d+\.)/i.test(address)) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Exact origins (for example http://127.0.0.1:4567) that local tests may call.
 * Refused outright in production so it can never widen a live deployment. */
export function httpTestOrigins(): string[] {
  const raw = process.env.HTTP_NODE_TEST_ORIGINS ?? "";
  if (!raw.trim()) return [];
  if (process.env.NODE_ENV === "production")
    throw new Error("HTTP_NODE_TEST_ORIGINS is not allowed in production");
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => new URL(v).origin);
}

export interface HttpCallResult {
  ok: boolean;
  status: number;
  /** Selected response field, or empty. Never the raw body. */
  value: string;
  error?: string;
}
export const httpLimits = {
  timeoutMs: 5000,
  requestBytes: 16 * 1024,
  responseBytes: 64 * 1024,
};

/** Calls a flow-configured endpoint with SSRF protections:
 * https only (except explicit test origins), DNS answers checked and the socket
 * pinned to the checked address (no rebinding), no redirects, bounded time/size. */
export async function callHttpNode(input: {
  url: string;
  method: "GET" | "POST";
  body?: unknown;
  idempotencyKey: string;
  responseField?: string;
}): Promise<HttpCallResult> {
  const testOrigins = httpTestOrigins();
  if (!isSafeHttpTarget(input.url, testOrigins))
    return { ok: false, status: 0, value: "", error: "Target not allowed" };
  const url = new URL(input.url);
  const testTarget = testOrigins.includes(url.origin);
  let address: { address: string; family: number };
  try {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const answers = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true, verbatim: true });
    if (!answers.length) throw new Error("No address");
    if (!testTarget && answers.some((a) => !isPublicAddress(a.address)))
      return { ok: false, status: 0, value: "", error: "Address not allowed" };
    address = answers[0]!;
  } catch {
    return { ok: false, status: 0, value: "", error: "DNS lookup failed" };
  }
  const pinned: LookupFunction = (_hostname, options, callback) => {
    if (options.all)
      (
        callback as (
          e: null,
          a: Array<{ address: string; family: number }>,
        ) => void
      )(null, [address]);
    else callback(null, address.address, address.family);
  };
  const payload =
    input.method === "POST"
      ? Buffer.from(JSON.stringify(input.body ?? {}))
      : null;
  if (payload && payload.length > httpLimits.requestBytes)
    return { ok: false, status: 0, value: "", error: "Request too large" };
  const client = url.protocol === "https:" ? https : http;
  return new Promise<HttpCallResult>((resolve) => {
    let settled = false;
    const finish = (result: HttpCallResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const request = client.request(
      url,
      {
        method: input.method,
        lookup: pinned,
        agent: false,
        headers: {
          "User-Agent": "PortalFlow-HTTP-Node/1",
          Accept: "application/json",
          "Idempotency-Key": input.idempotencyKey,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(payload.length),
              }
            : {}),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          finish({
            ok: false,
            status,
            value: "",
            error: "Redirects are not followed",
          });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > httpLimits.responseBytes) {
            response.destroy();
            finish({
              ok: false,
              status,
              value: "",
              error: "Response too large",
            });
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", () =>
          finish({ ok: false, status, value: "", error: "Response failed" }),
        );
        response.on("end", () => {
          let value = "";
          if (input.responseField) {
            try {
              const parsed: unknown = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              );
              if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed) &&
                Object.hasOwn(parsed, input.responseField)
              ) {
                const field = (parsed as Record<string, unknown>)[
                  input.responseField
                ];
                if (["string", "number", "boolean"].includes(typeof field))
                  value = String(field).slice(0, 1000);
              }
            } catch {
              value = "";
            }
          }
          finish({ ok: status >= 200 && status < 300, status, value });
        });
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      finish({ ok: false, status: 0, value: "", error: "Timed out" });
    }, httpLimits.timeoutMs);
    request.on("error", () =>
      finish({ ok: false, status: 0, value: "", error: "Connection failed" }),
    );
    if (payload) request.write(payload);
    request.end();
  });
}
