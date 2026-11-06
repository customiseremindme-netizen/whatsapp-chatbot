# Engineering handoff

Read START_HERE.md for the nontechnical owner and CLAUDE_PROMPT.md for continuation instructions. This project is NOT finished. PRODUCT_REQUIREMENTS.md is the target; CAPABILITY_MATRIX.md describes actual behavior.

## Architecture map

- apps/web: Next.js App Router dashboard and public/auth UI. components/flow-builder.tsx contains the visual editor/simulator. app/dashboard/inbox/page.tsx is the real-time inbox. app/admin/page.tsx is the new platform management UI. components/branding.tsx reads only safe public configuration.
- apps/api: Nest app.ts registers controllers and global auth/security. accounts.ts and controllers.ts manage auth/workspaces/team; messaging.ts handles contacts/inbox/mock events; bots.ts handles flows/leads; admin.ts contains the platform guard/admin APIs/public branding read.
- apps/worker: BullMQ recurring SMTP and messaging-outbox jobs. EMAIL_DELIVERY_ENABLED=false disables only email for tests.
- packages/core: shared persistent engine, mock provider, durable inbound/outbound drain and scheduled-execution reconciliation. Do not create a second simulator engine.
- packages/database: Prisma schema/client factory/migrations/seed. Eight migrations at this handoff, including global plan/configuration/platform-audit tables and tenant-scoped manual grant snapshots.
- packages/shared: Zod contracts, flow schemas/validation/templates and admin configuration contracts.
- packages/ui/config: reusable primitives and strict compiler defaults.

All tenant resources have tenant-aware relations. Global platform plans/settings/audits are not tenant-owned. AuthGuard resolves membership from an opaque server-side session; admin guard checks the current database user's platformAdmin flag. No RLS is claimed. Audit actors are historical UUIDs rather than cascading user relations.

## Commands (repository root)

```sh
cp .env.example .env                     # only on a new checkout
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm db:generate
pnpm db:migrate
pnpm db:seed                             # development only
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Run API in a separate terminal: `pnpm --filter @portalflow/api start`.
Run web: `pnpm --filter @portalflow/web start` (or web dev for active development).
Run worker for ordinary usage: `pnpm --filter @portalflow/worker start`.

For tests: stop the standalone worker first. `pnpm test:integration` starts workers with email delivery disabled; account tests intentionally inspect their own undelivered email tokens. Then `pnpm test:e2e` (built web is started automatically if no existing server). Then `pnpm test:worker` to test real SMTP/Mailpit delivery. Do not run integration/browser suites together against this shared DB, or heavy builds alongside timing-sensitive tests on a small runner. Browser tests leave development accounts and archived test plans behind. Use a disposable development database.

API localhost:4000; web localhost:3000; Swagger /api/docs on API; Mailpit localhost:8025. .env.example holds only safe local values. Development admin is admin@portalflow.example, with SEED_PASSWORD. No real Meta/Razorpay/AI/SMTP/storage credentials were supplied. Follow each provider's official current setup requirements.

## Existing engine invariants to preserve

- Draft revisions use compare-and-swap. Published versions are immutable and active executions pin a version.
- Tenant→contact→conversation row locks serialize engine entry paths. Inbound persistence/execution/output enqueue commit together. Outbox ordering uses Message.sequence.
- Questions and interactive prompts persist absolute answer deadlines; invalid input does not extend them.
- Delays persist wakeAt. Recurring BullMQ reconciliation recovers after downtime and rechecks status/window/takeover/suspension/suppression.
- Contextual menu replies require the current delivered prompt in the same tenant/conversation/execution/node-step. A stale reply cannot answer a later text question or start a new flow.
- Human takeover pauses sessions and holds pending bot replies. Explicit release restores state; waiting questions need new input, due delays resume on the worker. Terminal-failure outputs must not be delivered late.
- STOP/UNSUBSCRIBE records suppression. Free-form replies respect the service window. Live Meta is not implemented; mock delivery is explicit.
- Manual grants now snapshot plan limits and enforce contact/bot/team capacity transactionally in API and worker paths. See ENTITLEMENTS.md for trial/expiry/retry behavior. Payment-backed billing, message/number/feature quotas and provider renewals remain unfinished. Platform mutations are separately audited; normal owners get 403.

## Deployment and archive

The source archive excludes .env, node_modules, compiled output, test traces, database data, credentials and .git history. Install dependencies and build rather than expecting bundled binaries. README and operational docs describe existing configuration. Full application Docker image/HTTPS/backup restore deployment still needs execution validation. No GitHub remote/push or public hosting was performed. The owner's Hostinger plan is Web Hosting, not a confirmed VPS.

## What to do next

Run the baseline checks, then choose the next unfinished milestone in PRODUCT_REQUIREMENTS.md. Highest-impact gaps are remaining media/automation actions, official Meta with authenticated webhook ingress, opt-in campaigns/template management, delivered-event pricing, and payment-provider integration and remaining subscription quotas with the initial admin panel. Finish no-code management interfaces as those backend capabilities become real. Keep local mock paths and production provider states explicitly separated.
