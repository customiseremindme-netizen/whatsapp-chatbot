import { createDatabase } from "../packages/database/src";
import { emailSchema } from "../packages/shared/src";
const email = emailSchema.parse(
  process.argv.slice(2).filter((a) => a !== "--")[0],
);
const db = createDatabase();
async function main() {
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email },
      include: { memberships: { include: { tenant: true } } },
    });
    if (
      !user?.emailVerifiedAt ||
      !user.memberships.some((m) => !m.tenant.suspendedAt)
    )
      throw new Error(
        "The account must exist, have verified email, and belong to an active workspace",
      );
    await tx.user.update({
      where: { id: user.id },
      data: { platformAdmin: true },
    });
    await tx.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "admin.granted.cli",
        resourceId: user.id,
        details: { source: "Server operator CLI" },
      },
    });
  });
  console.log(
    "Platform administrator access granted to the specified account.",
  );
}
void main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Admin grant failed",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
