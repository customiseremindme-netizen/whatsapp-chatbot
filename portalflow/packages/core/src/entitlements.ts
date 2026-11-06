import { Prisma } from "@portalflow/database";
import { SubscriptionSummary } from "@portalflow/shared";
export class EntitlementError extends Error {
  readonly code = "ENTITLEMENT_LIMIT";
}
export async function lockTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;
}
export async function subscriptionSummary(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<SubscriptionSummary> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: { subscription: true },
  });
  const sub = tenant.subscription;
  const expiresAt =
    sub?.expiresAt ?? new Date(tenant.createdAt.getTime() + 14 * 86400000);
  const [contacts, bots, members, invitations, blockedInbound] =
    await Promise.all([
      tx.contact.count({ where: { tenantId, deletedAt: null } }),
      tx.botFlow.count({ where: { tenantId, deletedAt: null } }),
      tx.tenantMembership.count({ where: { tenantId } }),
      tx.invitation.count({
        where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
      }),
      tx.inboundEvent.count({ where: { tenantId, status: "QUOTA_BLOCKED" } }),
    ]);
  return {
    source: sub ? "MANUAL" : "TRIAL",
    status: expiresAt <= new Date() ? "EXPIRED" : (sub?.status ?? "TRIAL"),
    active:
      !tenant.suspendedAt &&
      expiresAt > new Date() &&
      (!sub || sub.status === "ACTIVE"),
    planName: sub?.planName ?? "14-day development trial",
    planId: sub?.planId ?? null,
    planRevision: sub?.planRevision ?? null,
    revision: sub?.revision ?? 0,
    expiresAt: expiresAt.toISOString(),
    limits: {
      contacts: sub?.maxContacts ?? 1000,
      bots: sub?.maxBots ?? 25,
      members: sub?.maxMembers ?? 3,
      numbers: sub?.maxNumbers ?? 1,
    },
    usage: { contacts, bots, members, invitations, blockedInbound },
  };
}
export async function assertActive(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  await lockTenant(tx, tenantId);
  const summary = await subscriptionSummary(tx, tenantId);
  if (!summary.active)
    throw new EntitlementError(
      "Workspace access is inactive or expired. Contact the platform administrator.",
    );
  return summary;
}
export async function assertCapacity(
  tx: Prisma.TransactionClient,
  tenantId: string,
  resource: "contacts" | "bots" | "members",
  reserveInvitations = false,
) {
  const summary = await assertActive(tx, tenantId);
  const used =
    summary.usage[resource] +
    (resource === "members" && reserveInvitations
      ? summary.usage.invitations
      : 0);
  if (used >= summary.limits[resource])
    throw new EntitlementError(
      `${resource} limit reached (${summary.limits[resource]}). Archive unused resources or ask your administrator to change the plan.`,
    );
}
