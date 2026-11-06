import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src";
import { defaultConfiguration } from "../../packages/shared/src";
const db = createDatabase();
const tenantIds: string[] = [],
  userIds: string[] = [],
  emails: string[] = [],
  planIds: string[] = [];
class Client {
  cookies = new Map<string, string>();
  tenantId = "";
  userId = "";
  email = "";
  async call(path: string, method = "GET", body?: unknown, csrf = true) {
    const res = await fetch("http://localhost:4000/api/v1" + path, {
      method,
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        "X-CSRF-Token": csrf ? (this.cookies.get("pf_csrf") ?? "") : "invalid",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const value = cookie.split(";")[0]!,
        i = value.indexOf("=");
      this.cookies.set(value.slice(0, i), value.slice(i + 1));
    }
    return res;
  }
  async register() {
    this.email = `admin-test-${randomUUID()}@example.com`;
    emails.push(this.email);
    expect(
      (
        await this.call("/auth/register", "POST", {
          name: "Admin test",
          workspace: "Admin test workspace",
          email: this.email,
          password: "AdminTestPassword!2026",
        })
      ).status,
    ).toBe(201);
    const me = await (await this.call("/auth/me")).json();
    this.tenantId = me.tenant.id;
    this.userId = me.user.id;
    tenantIds.push(this.tenantId);
    userIds.push(this.userId);
  }
}
const admin = new Client(),
  owner = new Client();
let original: typeof defaultConfiguration;
beforeAll(async () => {
  await admin.register();
  await owner.register();
  await db.user.update({
    where: { id: admin.userId },
    data: { platformAdmin: true, emailVerifiedAt: new Date() },
  });
  original = await (await admin.call("/configuration")).json();
});
afterAll(async () => {
  // Restore shared branding without removing another test's audit records.
  if (original) {
    const data = {
      brandName: original.brandName,
      primaryColor: original.primaryColor,
      supportEmail: original.supportEmail,
    };
    await db.platformConfiguration.upsert({
      where: { id: "global" },
      create: data,
      update: { ...data, revision: { increment: 1 } },
    });
  }
  await db.platformAuditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.emailOutbox.deleteMany({ where: { recipient: { in: emails } } });
  await db.$disconnect();
});
describe.sequential(
  "platform administration authorization and persistence",
  () => {
    it("rejects ordinary owners on every admin endpoint", async () => {
      for (const path of [
        "overview",
        "tenants",
        "users",
        "plans",
        "audit-logs",
      ])
        expect((await owner.call(`/admin/${path}`)).status).toBe(403);
      expect(
        (
          await owner.call(`/admin/tenants/${owner.tenantId}/status`, "PATCH", {
            suspended: true,
            reason: "Unauthorized",
          })
        ).status,
      ).toBe(403);
      expect(
        (await owner.call("/admin/configuration", "PATCH", {})).status,
      ).toBe(403);
      expect((await owner.call("/admin/plans", "POST", {})).status).toBe(403);
      expect(
        (await owner.call(`/admin/plans/${randomUUID()}`, "PATCH", {})).status,
      ).toBe(403);
      const anonymous = await fetch(
        "http://localhost:4000/api/v1/admin/overview",
      );
      expect(anonymous.status).toBe(401);
    });
    it("returns stored totals and sanitized user records", async () => {
      const overview = await (await admin.call("/admin/overview")).json();
      expect(overview.tenants).toBe(await db.tenant.count());
      const users = await (
        await admin.call(
          `/admin/users?search=${encodeURIComponent(owner.email)}`,
        )
      ).json();
      expect(users.total).toBe(1);
      expect(users.items[0]).not.toHaveProperty("passwordHash");
      expect((await admin.call("/admin/tenants?limit=10000")).status).toBe(400);
    });
    it("suspends a business, revokes its session, reactivates it and audits both changes", async () => {
      expect(
        (
          await admin.call(
            `/admin/tenants/${owner.tenantId}/status`,
            "PATCH",
            { suspended: true, reason: "Test suspension" },
            false,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await admin.call(`/admin/tenants/${owner.tenantId}/status`, "PATCH", {
            suspended: true,
            reason: "Test suspension",
          })
        ).status,
      ).toBe(200);
      expect((await owner.call("/auth/me")).status).toBe(401);
      expect(
        (await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } }))
          .suspendedAt,
      ).not.toBeNull();
      expect(
        (
          await admin.call(`/admin/tenants/${owner.tenantId}/status`, "PATCH", {
            suspended: false,
            reason: "Test restored",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await owner.call("/auth/login", "POST", {
            email: owner.email,
            password: "AdminTestPassword!2026",
          })
        ).status,
      ).toBe(201);
      expect((await owner.call("/auth/me")).status).toBe(200);
      expect(
        await db.platformAuditLog.count({
          where: { actorId: admin.userId, resourceId: owner.tenantId },
        }),
      ).toBe(2);
    });
    it("prevents administrator workspace lockout", async () => {
      expect(
        (
          await admin.call(`/admin/tenants/${admin.tenantId}/status`, "PATCH", {
            suspended: true,
            reason: "Must reject",
          })
        ).status,
      ).toBe(400);
      expect((await admin.call("/admin/overview")).status).toBe(200);
    });
    it("creates and updates INR plan records, rejecting stale revisions and invalid amounts", async () => {
      const values = {
        name: "Test plan",
        monthlyPaise: 99900,
        yearlyPaise: 999000,
        maxNumbers: 1,
        maxMembers: 3,
        maxContacts: 1000,
        maxBots: 5,
        archived: false,
      };
      const result = await admin.call("/admin/plans", "POST", values);
      expect(result.status).toBe(201);
      const plan = await result.json();
      planIds.push(plan.id);
      const update = {
        ...values,
        monthlyPaise: 109900,
        revision: plan.revision,
      };
      expect(
        (await admin.call(`/admin/plans/${plan.id}`, "PATCH", update)).status,
      ).toBe(200);
      expect(
        (await admin.call(`/admin/plans/${plan.id}`, "PATCH", update)).status,
      ).toBe(409);
      expect(
        (
          await admin.call("/admin/plans", "POST", {
            ...values,
            monthlyPaise: -1,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await db.subscriptionPlan.findUniqueOrThrow({
            where: { id: plan.id },
          })
        ).monthlyPaise,
      ).toBe(109900);
    });
    it("updates safe public branding with optimistic concurrency and records its audit", async () => {
      const change = {
        ...original,
        brandName: "Test brand",
        primaryColor: "#123456",
        supportEmail: "help@example.com",
      };
      expect(
        (await admin.call("/admin/configuration", "PATCH", change)).status,
      ).toBe(200);
      expect(
        (await admin.call("/admin/configuration", "PATCH", change)).status,
      ).toBe(409);
      const value = await (
        await fetch("http://localhost:4000/api/v1/configuration")
      ).json();
      expect(value.brandName).toBe("Test brand");
      expect(
        (
          await admin.call("/admin/configuration", "PATCH", {
            ...change,
            revision: value.revision,
            primaryColor: "url(javascript:alert(1))",
          })
        ).status,
      ).toBe(400);
      expect(
        await db.platformAuditLog.count({
          where: { actorId: admin.userId, action: "configuration.updated" },
        }),
      ).toBe(1);
    });
  },
);
