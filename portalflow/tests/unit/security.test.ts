import { describe, it, expect } from "vitest";
import {
  canManage,
  canChangeMember,
  registerSchema,
  tenantSchema,
} from "../../packages/shared/src";
import {
  opaqueToken,
  hashToken,
  verifyCsrf,
  requireActive,
} from "../../apps/api/src/security";
describe("role policy", () => {
  it("only owners and admins manage workspaces", () => {
    expect(canManage("OWNER")).toBe(true);
    expect(canManage("ADMIN")).toBe(true);
    for (const role of ["MANAGER", "AGENT", "VIEWER"] as const)
      expect(canManage(role)).toBe(false);
  });
  it("protects owners and prevents administrator escalation", () => {
    expect(canChangeMember("OWNER", "OWNER")).toBe(false);
    expect(canChangeMember("ADMIN", "ADMIN")).toBe(false);
    expect(canChangeMember("ADMIN", "AGENT")).toBe(true);
    expect(canChangeMember("VIEWER", "AGENT")).toBe(false);
  });
});
describe("account validation", () => {
  it("normalizes email and rejects client-controlled roles", () => {
    const input = {
      email: " TEST@example.com ",
      password: "Correct horse battery staple",
      name: "Alice",
      workspace: "Example",
    };
    expect(registerSchema.parse(input).email).toBe("test@example.com");
    expect(
      registerSchema.safeParse({ ...input, platformAdmin: true }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...input, password: "short" }).success,
    ).toBe(false);
  });
  it("rejects invalid timezone and unsupported language", () => {
    expect(
      tenantSchema.safeParse({
        name: "Acme",
        timezone: "Mars/Olympus",
        language: "en",
      }).success,
    ).toBe(false);
    expect(
      tenantSchema.safeParse({
        name: "Acme",
        timezone: "Asia/Kolkata",
        language: "ta",
      }).success,
    ).toBe(true);
  });
});
describe("session primitives", () => {
  it("generates unpredictable tokens and stores only hashes", () => {
    const a = opaqueToken(),
      b = opaqueToken();
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
    expect(hashToken(a)).not.toBe(a);
  });
  it("rejects absent and incorrect CSRF tokens", () => {
    const token = opaqueToken();
    expect(() => verifyCsrf(token, hashToken(token))).not.toThrow();
    expect(() => verifyCsrf(undefined, hashToken(token))).toThrow();
    expect(() => verifyCsrf(opaqueToken(), hashToken(token))).toThrow();
  });
  it("rejects expired or revoked sessions", () => {
    expect(() => requireActive(new Date(0), null)).toThrow();
    expect(() =>
      requireActive(new Date(Date.now() + 60000), new Date()),
    ).toThrow();
    expect(() =>
      requireActive(new Date(Date.now() + 60000), null),
    ).not.toThrow();
  });
});
