# Database

PostgreSQL 17 and Prisma 7, using the PostgreSQL driver adapter. IDs are UUIDs. Account foundation migration is under `packages/database/prisma/migrations`.

| Model | Purpose and isolation |
|---|---|
| User | Global identity; normalized unique email, Argon2id password hash |
| Tenant | Business workspace; timezone/currency/language, suspension |
| TenantMembership | Unique tenant/user pair; five tenant roles |
| Session | User and active tenant FKs; hashed access/refresh/CSRF tokens, expiry and revocation |
| AccountToken | User-owned verification/reset token; hashed, purpose-bound, expiring, one use |
| Invitation | Tenant-scoped invitation, email-bound, expiring and one use |
| AuditLog | Tenant-scoped account/team events; actor is a historical UUID |
| EmailOutbox | Internal durable delivery resource, never exposed through REST |

Tokens for email must temporarily exist in the internal outbox to deliver their links. Successful delivery redacts message text. Failed messages are bounded to five attempts; operator cleanup/retention is required. Outbox rows are locked with `FOR UPDATE SKIP LOCKED`, so multiple workers do not concurrently deliver the same pending row. SMTP is at-least-once: a crash after send but before commit can resend the same stable Message-ID.

Memberships, sessions, invitations and audit logs cascade on tenant deletion. Account tokens and sessions cascade on user deletion. Registration, account-token consumption and team mutations are transactional. No database RLS is claimed; isolation is enforced in the API and tested against a real database.

Run `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`. To author a development migration: `node --env-file=.env scripts/env.mjs pnpm --filter @portalflow/database exec prisma migrate dev --name descriptive_name`.

The messaging migration adds Contact, ContactConsent, Conversation, Message, MessageEvent, InboundEvent and InternalNote. All carry tenantId. Composite foreign keys bind each conversation to its own tenant's contact and each message/note to its own tenant's conversation. Message events have a unique message/status pair; inbound events have a unique tenant/external-ID pair. Incoming duplicate insertions use ON CONFLICT DO NOTHING through Prisma createMany, including concurrent delivery. Contacts are archived rather than erased, retaining suppression/history. Consent changes record evidence source and actor. Message status transitions lock the row and are monotonic: READ cannot regress to DELIVERED/SENT/FAILED. The seed includes explicitly labelled demo contacts/conversations in both workspaces.

The bot migration adds BotFlow, immutable BotFlowVersion, BotExecution and Lead with composite tenant foreign keys. Contact.customFields stores captured values, InboundEvent optionally targets a simulated flow, and bot-generated messages reference their execution. A separate migration adds an auto-incrementing message sequence to preserve order within a transaction. Campaigns, pricing and billing remain future work.

The fifth migration adds nullable BotExecution.wakeAt and waitExpiresAt deadlines, indexed with status. Existing waiting/paused questions are backfilled to updatedAt + 24 hours. New executions store fixed deadlines; invalid answers and human takeover do not extend them.

The sixth migration adds optional JSONB interactive payloads and contextual replies to Message, plus contextual replies to InboundEvent. Text records remain backward compatible. Flow parsing defaults missing option arrays to empty; published snapshots remain immutable.

The seventh migration adds global SubscriptionPlan (catalogue only), PlatformConfiguration (safe brand/support strings with revision), and PlatformAuditLog (append-only through the API). These are platform resources, not tenant-owned resources. Platform audit actors are historical UUIDs; deleting a tenant does not remove these records. Development seed includes a separate operations workspace/admin in addition to the two customer tenants.

Migration eight adds TenantSubscription: unique tenant FK, restricted plan FK, immutable-per-assignment snapshot fields, manual source, revision, status and expiry. Assignments are audited globally. InboundEvent.error stores a safe quota-block reason; QUOTA_BLOCKED records remain durable until explicit retry. Counts/checks/resource creation serialize on the Tenant row.
