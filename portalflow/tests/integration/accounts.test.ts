import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src";
const db = createDatabase();
const base = process.env.TEST_API_URL ?? "http://localhost:4000/api/v1";
const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const password = "IntegrationPassword!2026";
const users: string[] = [];
const tenants: string[] = [];
class Client {
  cookies = new Map<string, string>();
  async call(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        "X-CSRF-Token": this.cookies.get("pf_csrf") ?? "",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!,
        index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  async register(workspace: string) {
    const email = `test-${randomUUID()}@example.com`;
    const response = await this.call("/auth/register", "POST", {
      name: "Integration User",
      email,
      password,
      workspace,
    });
    expect(response.status).toBe(201);
    const me = await (await this.call("/auth/me")).json();
    users.push(me.user.id);
    tenants.push(me.tenant.id);
    return { email, ...me } as {
      email: string;
      user: { id: string };
      tenant: { id: string };
      role: string;
      sessionId: string;
    };
  }
}
const a = new Client(),
  b = new Client();
let alice: Awaited<ReturnType<Client["register"]>>,
  bob: Awaited<ReturnType<Client["register"]>>;
beforeAll(async () => {
  [alice, bob] = await Promise.all([
    a.register("Tenant Alpha"),
    b.register("Tenant Beta"),
  ]);
});
afterAll(async () => {
  await db.tenant.deleteMany({ where: { id: { in: tenants } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.emailOutbox.deleteMany({
    where: { recipient: { in: [alice?.email, bob?.email].filter(Boolean) } },
  });
  await db.$disconnect();
});
describe.sequential("PostgreSQL tenant isolation and authentication", () => {
  it("creates two independent owners atomically", () => {
    expect(alice.role).toBe("OWNER");
    expect(bob.role).toBe("OWNER");
    expect(alice.tenant.id).not.toBe(bob.tenant.id);
  });
  it("does not accept another tenant ID or leak membership", async () => {
    expect(
      (await a.call("/tenants/switch", "POST", { tenantId: bob.tenant.id }))
        .status,
    ).toBe(403);
    const members = await (await b.call("/tenants/members")).json();
    expect(members).toHaveLength(1);
    expect(members[0].user.id).toBe(bob.user.id);
    expect(
      (
        await a.call(`/tenants/members/${members[0].id}`, "PATCH", {
          role: "VIEWER",
        })
      ).status,
    ).toBe(404);
    expect(
      (await a.call(`/tenants/members/${members[0].id}`, "DELETE")).status,
    ).toBe(404);
    const spaces = await (await a.call("/tenants")).json();
    expect(spaces.map((s: { id: string }) => s.id)).toEqual([alice.tenant.id]);
  });
  it("rejects forged tenant fields, missing CSRF and foreign origins", async () => {
    const settings = {
      name: "Alpha Updated",
      timezone: "Asia/Kolkata",
      language: "en",
    };
    expect(
      (
        await a.call("/tenants/current", "PATCH", {
          ...settings,
          tenantId: bob.tenant.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await a.call("/tenants/current", "PATCH", settings, {
          "X-CSRF-Token": "",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await a.call("/tenants/current", "PATCH", settings, {
          Origin: "https://attacker.example",
        })
      ).status,
    ).toBe(403);
    expect((await a.call("/tenants/current", "PATCH", settings)).status).toBe(
      200,
    );
    expect((await (await b.call("/tenants/current")).json()).name).toBe(
      "Tenant Beta",
    );
  });
  it("enforces roles from the database on every request", async () => {
    await db.tenantMembership.update({
      where: {
        tenantId_userId: { tenantId: bob.tenant.id, userId: bob.user.id },
      },
      data: { role: "VIEWER" },
    });
    expect(
      (
        await b.call("/tenants/current", "PATCH", {
          name: "Forbidden",
          timezone: "Asia/Kolkata",
          language: "en",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await b.call("/tenants/invitations", "POST", {
          email: "invite@example.com",
          role: "AGENT",
        })
      ).status,
    ).toBe(403);
    await db.tenantMembership.update({
      where: {
        tenantId_userId: { tenantId: bob.tenant.id, userId: bob.user.id },
      },
      data: { role: "OWNER" },
    });
  });
  it("protects owners from removal and prevents cross-user session revocation", async () => {
    const [owner] = await (await a.call("/tenants/members")).json();
    expect(
      (await a.call(`/tenants/members/${owner.id}`, "DELETE")).status,
    ).toBe(403);
    expect(
      (await a.call(`/auth/sessions/${bob.sessionId}`, "DELETE")).status,
    ).toBe(404);
  });
  it("blocks suspended tenants including existing sessions", async () => {
    await db.tenant.update({
      where: { id: bob.tenant.id },
      data: { suspendedAt: new Date() },
    });
    expect((await b.call("/auth/me")).status).toBe(403);
    await db.tenant.update({
      where: { id: bob.tenant.id },
      data: { suspendedAt: null },
    });
  });
  it("hashes passwords and session secrets", async () => {
    const user = await db.user.findUniqueOrThrow({
      where: { id: alice.user.id },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
    const session = await db.session.findUniqueOrThrow({
      where: { id: alice.sessionId },
    });
    expect(session.accessHash).not.toBe(a.cookies.get("pf_access"));
    expect(session.refreshHash).not.toBe(a.cookies.get("pf_refresh"));
  });
  it("rotates refresh tokens and revokes a replayed session", async () => {
    const old = new Map(a.cookies);
    expect((await a.call("/auth/refresh", "POST")).status).toBe(201);
    expect(a.cookies.get("pf_refresh")).not.toBe(old.get("pf_refresh"));
    const attacker = new Client();
    attacker.cookies = old;
    expect((await attacker.call("/auth/refresh", "POST")).status).toBe(401);
    expect((await a.call("/auth/me")).status).toBe(401);
    expect(
      (await a.call("/auth/login", "POST", { email: alice.email, password }))
        .status,
    ).toBe(201);
  });
  it("uses single-use email verification and invitation tokens", async () => {
    // Read the durable outbox before the worker runs; no token-returning production endpoint exists.
    const mail = await db.emailOutbox.findFirstOrThrow({
      where: {
        recipient: alice.email,
        subject: "Verify your PortalFlow email",
      },
      orderBy: { createdAt: "desc" },
    });
    const token = mail.text.match(/token=([a-f0-9]{64})/)?.[1];
    expect(token).toBeTruthy();
    expect((await a.call("/auth/verify-email", "POST", { token })).status).toBe(
      201,
    );
    expect((await a.call("/auth/verify-email", "POST", { token })).status).toBe(
      400,
    );
    expect(
      (
        await a.call("/tenants/invitations", "POST", {
          email: bob.email,
          role: "AGENT",
        })
      ).status,
    ).toBe(201);
    const invitation = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: bob.email, subject: "Your PortalFlow invitation" },
      orderBy: { createdAt: "desc" },
    });
    const invitedToken = invitation.text.match(/token=([a-f0-9]{64})/)?.[1];
    expect(
      (
        await b.call("/tenants/invitations/accept", "POST", {
          token: invitedToken,
        })
      ).status,
    ).toBe(403);
    await db.user.update({
      where: { id: bob.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    expect(
      (
        await b.call("/tenants/invitations/accept", "POST", {
          token: invitedToken,
        })
      ).status,
    ).toBe(201);
    expect(
      (await b.call("/tenants/switch", "POST", { tenantId: alice.tenant.id }))
        .status,
    ).toBe(201);
    expect((await (await b.call("/auth/me")).json()).role).toBe("AGENT");
    expect(
      (
        await b.call("/tenants/current", "PATCH", {
          name: "Forbidden",
          timezone: "Asia/Kolkata",
          language: "en",
        })
      ).status,
    ).toBe(403);
  });
  it("resets passwords using single-use tokens and revokes all sessions", async () => {
    const generic = await (
      await a.call("/auth/forgot-password", "POST", { email: alice.email })
    ).json();
    const unknown = await (
      await a.call("/auth/forgot-password", "POST", {
        email: "missing@example.com",
      })
    ).json();
    expect(generic).toEqual(unknown);
    const mail = await db.emailOutbox.findFirstOrThrow({
      where: {
        recipient: alice.email,
        subject: "Reset your PortalFlow password",
      },
      orderBy: { createdAt: "desc" },
    });
    const token = mail.text.match(/token=([a-f0-9]{64})/)?.[1];
    expect(
      (
        await a.call("/auth/reset-password", "POST", {
          token,
          password: "ChangedPassword!2026",
        })
      ).status,
    ).toBe(201);
    expect((await a.call("/auth/me")).status).toBe(401);
    expect(
      (await a.call("/auth/reset-password", "POST", { token, password }))
        .status,
    ).toBe(400);
    expect(
      (await a.call("/auth/login", "POST", { email: alice.email, password }))
        .status,
    ).toBe(401);
    expect(
      (
        await a.call("/auth/login", "POST", {
          email: alice.email,
          password: "ChangedPassword!2026",
        })
      ).status,
    ).toBe(201);
  });
});
