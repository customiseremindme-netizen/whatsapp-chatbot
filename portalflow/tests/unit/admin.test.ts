import { describe, expect, it } from "vitest";
import { planSchema, configurationSchema } from "../../packages/shared/src";
describe("admin input contracts", () => {
  it("requires integer minor-unit prices and bounded limits", () => {
    const plan = {
      name: "Starter",
      monthlyPaise: 99900,
      yearlyPaise: 999000,
      maxNumbers: 1,
      maxMembers: 1,
      maxContacts: 1000,
      maxBots: 5,
    };
    expect(planSchema.safeParse(plan).success).toBe(true);
    expect(planSchema.safeParse({ ...plan, monthlyPaise: 1.1 }).success).toBe(
      false,
    );
    expect(planSchema.safeParse({ ...plan, maxMembers: 0 }).success).toBe(
      false,
    );
    expect(
      planSchema.safeParse({ ...plan, tenantId: "injected" }).success,
    ).toBe(false);
  });
  it("restricts brand configuration to public strings and a hex colour", () => {
    const value = {
      brandName: "PortalFlow",
      primaryColor: "#2563EB",
      supportEmail: "support@example.com",
    };
    expect(configurationSchema.safeParse(value).success).toBe(true);
    expect(
      configurationSchema.safeParse({
        ...value,
        primaryColor: "red;display:none",
      }).success,
    ).toBe(false);
    expect(
      configurationSchema.safeParse({ ...value, secret: "no" }).success,
    ).toBe(false);
  });
});
