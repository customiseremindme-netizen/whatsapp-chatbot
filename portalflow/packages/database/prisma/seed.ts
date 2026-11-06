import "dotenv/config";
import { createDatabase } from "../src";
import { hash } from "argon2";
import { quotationFlow } from "../../shared/src";
if (process.env.NODE_ENV === "production")
  throw new Error("Development seed is forbidden in production");
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12)
  throw new Error("Set SEED_PASSWORD (12+ characters)");
const db = createDatabase();
async function main() {
  const admin = await db.user.upsert({
    where: { email: "admin@portalflow.example" },
    update: {},
    create: {
      email: "admin@portalflow.example",
      name: "Platform Administrator",
      passwordHash: await hash(password!),
      emailVerifiedAt: new Date(),
      platformAdmin: true,
      memberships: {
        create: {
          role: "OWNER",
          tenant: { create: { name: "PortalFlow Operations" } },
        },
      },
    },
  });
  if (!admin.platformAdmin)
    throw new Error(
      "Development admin email already belongs to a regular account; refusing automatic promotion",
    );
  for (const [name, monthlyPaise, maxMembers, maxNumbers] of [
    ["STARTER", 99900, 1, 1],
    ["GROWTH", 249900, 3, 1],
    ["BUSINESS", 599900, 10, 3],
  ] as const) {
    if (!(await db.subscriptionPlan.findFirst({ where: { name } })))
      await db.subscriptionPlan.create({
        data: {
          name,
          monthlyPaise,
          yearlyPaise: monthlyPaise * 12,
          maxMembers,
          maxNumbers,
          maxContacts: 1000,
          maxBots: 5,
        },
      });
  }
  for (const [email, name, workspace] of [
    ["owner@lotus.example", "Priya Raman", "Lotus Studio"],
    ["owner@cedar.example", "Arjun Shah", "Cedar Services"],
  ]) {
    if (!email || !name || !workspace) throw new Error("Invalid seed");
    const user = await db.user.upsert({
      where: { email },
      include: { memberships: { include: { tenant: true } } },
      update: {},
      create: {
        email,
        name,
        passwordHash: await hash(password!),
        emailVerifiedAt: new Date(),
        memberships: {
          create: { role: "OWNER", tenant: { create: { name: workspace } } },
        },
      },
    });
    const membership = user.memberships.find(
      (m) => m.tenant.name === workspace,
    );
    if (!membership) continue;
    const tenantId = membership.tenantId;
    if (
      !(await db.botFlow.findFirst({
        where: { tenantId, name: "Sample quotation flow", deletedAt: null },
      }))
    )
      await db.botFlow.create({
        data: { tenantId, name: "Sample quotation flow", draft: quotationFlow },
      });
    const contact = await db.contact.upsert({
      where: { tenantId_phone: { tenantId, phone: "+15555550101" } },
      create: {
        tenantId,
        phone: "+15555550101",
        name: "Sample Customer",
        source: "development-seed",
        tags: ["Demo"],
        notes: "Development sample for the mock WhatsApp inbox.",
      },
      update: {},
    });
    const conversation = await db.conversation.upsert({
      where: { contactId: contact.id },
      create: { tenantId, contactId: contact.id, lastInboundAt: new Date() },
      update: {},
    });
    await db.message.upsert({
      where: {
        tenantId_idempotencyKey: { tenantId, idempotencyKey: "seed:welcome" },
      },
      create: {
        tenantId,
        conversationId: conversation.id,
        idempotencyKey: "seed:welcome",
        direction: "INBOUND",
        status: "RECEIVED",
        text: "Hello! This is a sample customer conversation. Try replying through the mock provider.",
        providerId: `mock-seed-${tenantId}`,
        events: { create: { status: "RECEIVED" } },
      },
      update: {},
    });
  }
}
void main().finally(() => db.$disconnect());
