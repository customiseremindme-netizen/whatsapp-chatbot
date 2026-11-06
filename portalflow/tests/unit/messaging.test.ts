import { it, expect } from "vitest";
import {
  withinServiceWindow,
  advanceStatus,
  MockWhatsAppProvider,
} from "../../packages/core/src";
import { contactSchema, incomingSchema } from "../../packages/shared/src";
it("enforces the exact 24-hour boundary and rejects future timestamps", () => {
  const now = new Date();
  expect(withinServiceWindow(null, now)).toBe(false);
  expect(withinServiceWindow(new Date(now.getTime() - 86400000), now)).toBe(
    false,
  );
  expect(withinServiceWindow(new Date(now.getTime() - 86399999), now)).toBe(
    true,
  );
  expect(withinServiceWindow(new Date(now.getTime() + 1), now)).toBe(false);
});
it("never regresses delivered/read statuses on delayed callbacks", () => {
  expect(advanceStatus("READ", "DELIVERED")).toBe("READ");
  expect(advanceStatus("DELIVERED", "FAILED")).toBe("DELIVERED");
  expect(advanceStatus("SENT", "FAILED")).toBe("FAILED");
  expect(advanceStatus("FAILED", "DELIVERED")).toBe("DELIVERED");
});
it("mock sends return a stable provider identifier on retries", async () => {
  const provider = new MockWhatsAppProvider();
  const input = {
    messageId: crypto.randomUUID(),
    to: "+919876543210",
    text: "Hello",
  };
  expect(await provider.send(input)).toEqual(await provider.send(input));
});
it("rejects unapproved consent fields and malformed phone numbers", () => {
  expect(
    contactSchema.safeParse({ name: "Customer", phone: "9876543210" }).success,
  ).toBe(false);
  expect(
    contactSchema.safeParse({
      name: "Customer",
      phone: "+919876543210",
      optedInAt: new Date(),
    }).success,
  ).toBe(false);
  expect(
    incomingSchema.safeParse({
      phone: "+919876543210",
      text: "Hello",
      externalId: "not-an-id",
    }).success,
  ).toBe(false);
});
