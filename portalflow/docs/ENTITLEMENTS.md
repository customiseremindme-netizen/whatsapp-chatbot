# Workspace access and capacity

This milestone implements manual administrator grants and a bounded default trial. It does not collect payments, generate paid invoices, or integrate Razorpay.

## Policy

A workspace without a TenantSubscription receives a 14-day trial from its original Tenant.createdAt: 1,000 non-archived contacts, 25 non-archived flows and 3 team members including the owner. These initial trial defaults are fixed in packages/core/src/entitlements.ts; no trial-policy editor exists yet. Existing workspaces older than 14 days will need an administrator grant when this migration is deployed. Reads remain available so administrators and users can inspect/reduce usage and recover access.

A platform administrator can assign a non-archived plan with ACTIVE/PAUSED/CANCELLED status, an explicit expiry and an audit reason. ACTIVE grants require a future expiry. Each grant stores a snapshot of the selected plan name, revision, prices and limits. Catalogue edits never silently change existing grants. Reassign to apply a new revision. Archive blocks new active grants; it does not silently revoke existing snapshots. A downgrade below active contacts/flows or members plus reserved invitation seats is rejected without deleting data. Mutations require a matching grant revision and write a platform audit event.

This is source MANUAL, not a claim of a paid subscription. Pricing remains informational until billing is implemented. The WhatsApp-number limit is stored for future connections but cannot be enforced against a connection module that does not exist. Message-rate/monthly-send quotas, feature-tier restrictions, automatic renewals, invoices and payment-provider events remain future work.

## Atomic enforcement

Creation entry points take a PostgreSQL Tenant row lock before checking usage and writing. Contact creation, bot creation, invitation creation/acceptance and worker-created contacts share the same rules. Two requests cannot both consume the last slot. Non-deleted contacts and flows count; archiving releases capacity while preserving history/suppression. Existing unique phone constraints remain in force.

An unexpired, unaccepted invitation reserves one member seat. Reissuing the same email's invitation expires the old one within the locked transaction before reserving the replacement. Acceptance rechecks active access/member capacity and only consumes the invitation if joining succeeds. Expired/revoked invitations do not reserve seats. Members include all tenant roles, including the owner.

Engine lock order is tenant → contact → conversation. Batch inbound/outbound selection uses tenant order to keep cross-tenant lock acquisition consistent. Manual assignment uses the same tenant lock. Resource reads are tenant-scoped; users cannot grant their own plans or query other tenants' subscription records.

## Expiry and worker behavior

Inactive/expired access blocks new contacts/flows/invitations/member joins and human outbound enqueue. Existing notes/history/profile edits and resource archive/removal remain available. The worker rechecks access before sending already queued messages; invalidated sends become FAILED with a reason. Engine entry cancels active sessions on access expiry/inactivity and clears deadlines rather than sending overdue automation after a later renewal. No automatic resurrection of cancelled flows is implied.

Existing customer conversations still receive inbound records and STOP/UNSUBSCRIBE suppression while inactive. If a new contact cannot be admitted, its persisted InboundEvent becomes QUOTA_BLOCKED with a safe reason. It is not silently discarded or endlessly retried. The Plan and usage page shows the blocked count; an owner/admin can explicitly requeue up to 25 events after freeing capacity or obtaining a new grant. The worker checks eligibility again. Original inbound timestamps and external-ID deduplication are preserved, so retry does not manufacture a new 24-hour service window. Queued does not mean successfully processed or delivered.

## UI and routes

- Platform admin → Businesses → Manage plan access: inspect usage, select plan/status/expiry, enter reason, save manual grant.
- Tenant sidebar → Plan and usage: current grant/trial, expiry, actual counts/limits, reserved invitation seats, blocked inbound count and explicit retry.
- GET/PATCH /api/v1/admin/tenants/:id/subscription: platform-only read/assignment.
- GET /api/v1/billing/subscription: current authorized workspace only.
- POST /api/v1/billing/retry-blocked: current workspace owner/admin only, CSRF/Origin protected.

API quota errors are HTTP 403 with code ENTITLEMENT_LIMIT. Admin stale revisions and over-capacity downgrades return 409. Invalid/archived plan selection returns 400. No payment redirect endpoint or fake successful checkout was added.
