# PortalFlow

A real, incremental WhatsApp automation SaaS project. **This checkout currently implements the account foundation, mock text-messaging core, a persistent visual chatbot/lead-capture engine, and an initial platform admin panel; the full SaaS specification remains in progress.** Start with [START_HERE.md](START_HERE.md). See [CAPABILITY_MATRIX.md](docs/CAPABILITY_MATRIX.md) for current availability, [TASKS.md](TASKS.md) for verification history, and [CLAUDE_PROMPT.md](CLAUDE_PROMPT.md) for continuation.

## Implemented
- Next.js App Router + React + Tailwind dashboard, shared shadcn-style primitives, light/dark theme, responsive sidebar.
- NestJS REST API, PostgreSQL/Prisma migrations and shared Zod validation.
- Registration creates a user, workspace and owner membership transactionally.
- Argon2id passwords, opaque HTTP-only access/refresh cookies, refresh rotation, CSRF and Origin checks, Redis rate limiting, session revocation.
- Email verification and password reset with hashed single-use tokens; durable PostgreSQL outbox delivered by a dedicated BullMQ SMTP worker.
- Workspace creation/switching, profile settings, invitations, acceptance, team roles/removal, activity history and session management.
- Server-side tenant authorization on every protected request, with two independent demo tenants, each with a sample conversation and a draft quotation flow.

- Tenant-scoped contacts with search/pagination, editing, tags, notes, soft archive and explicit consent history.
- Real-time text inbox with persisted incoming/outgoing messages, internal notes, assignment, close/reopen, unread state and human takeover.
- Visual chatbot editing, immutable publishing, persisted questions/branches/lead capture, and a simulator using the real engine.
- Reply-button/list nodes with editable options, validated branches, context-bound selections, and clickable simulator replies.
- Durable Delay nodes, configurable answer deadlines, restart recovery, and takeover-aware scheduled resumes.
- A mock WhatsApp provider backed by durable inbound/message tables and a BullMQ worker; duplicate suppression, monotonic status updates, bounded provider retries, STOP suppression and the 24-hour service window.

No Meta approval or real phone delivery is implied. Campaigns, payment collection, message/number quotas, full super-admin operations, media/template messaging, advanced automation nodes and live integrations are **not yet implemented**.

- Initial `/admin`: platform-authorized totals/business suspension and reactivation/user directory/INR plan catalogue/branding and support settings/audit history. Manual plan assignment now enforces contact, chatbot and team capacity; it never implies payment.
- Development-only platform operator: `admin@portalflow.example`, using `SEED_PASSWORD`, plus the two customer demo businesses. See [ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).

- Tenant Plan and usage page, bounded trial, revisioned manual access grants, concurrency-safe capacity checks, and explicit retry of quota-blocked inbound events. See [ENTITLEMENTS.md](docs/ENTITLEMENTS.md).

## Local startup

Requires Node 24 LTS, pnpm 11.25.0, Docker with Compose. Run from this directory:

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm dev
```

In a second terminal, start the worker for transactional email and mock messaging:

```sh
pnpm --filter @portalflow/worker start
```

Web: http://localhost:3000 · API: http://localhost:4000/api/v1 · Swagger: http://localhost:4000/api/docs · Mailpit: http://localhost:8025

`pnpm dev` builds shared packages/API before starting API and Next development mode. Restart it after API changes; Next frontend changes hot reload. For production-mode local testing, start API with `pnpm --filter @portalflow/api start` and web with `pnpm --filter @portalflow/web start` after `pnpm build`.

Development-only demo accounts:

| Workspace | Email | Password |
|---|---|---|
| Lotus Studio | owner@lotus.example | LocalPortalFlow!2026 |
| Cedar Services | owner@cedar.example | LocalPortalFlow!2026 |

Passwords come from `SEED_PASSWORD`, and seeding refuses `NODE_ENV=production`. These are reserved example-domain accounts, not real customer data. New registrations receive verification email in Mailpit. Click the link, then click Confirm; simply previewing a link cannot consume it. Invitation recipients must register/sign in and verify the invited email before accepting.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
# Start API; stop the email worker for the account integration suite.
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

Tests create isolated users/workspaces. Account integration tests clean up their own records; browser tests retain test accounts for inspection. Only run integration/browser tests against a development database. The E2E suite uses seeded accounts for its mobile check. See [testing](docs/TESTING.md).

## Containers

```sh
docker compose -f docker-compose.yml -f docker-compose.app.yml up --build -d
```

The application override is for **local development**, not public deployment. The runtime image runs as a non-root user. See [deployment](docs/DEPLOYMENT.md) for production configuration and [security](docs/SECURITY.md) for current limits. No paid service credentials are needed for the implemented local features.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [WhatsApp setup](docs/WHATSAPP_SETUP.md) · [Meta review](docs/META_APP_REVIEW.md) · [Chatbot engine](docs/CHATBOT_ENGINE.md) · [Billing](docs/BILLING.md) · [Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) · [Testing](docs/TESTING.md)

`pnpm test:worker` starts a temporary dedicated worker and verifies delivery through the real SMTP capture service, then stops the worker. Run after the account integration suite.

## Try the mock inbox

1. Sign in to either demo workspace (each has an explicitly labelled sample contact/conversation).
2. Open Contacts and add a phone in E.164 format. Creation does not grant marketing consent.
3. Open Inbox → Simulate incoming; use that phone and type a customer message.
4. The worker persists the event and message; the inbox receives a tenant-authorized WebSocket notification.
5. Select the conversation and reply. The mock provider records sent/delivered events without contacting any real phone.
6. Assign a teammate, add an internal note, close/reopen, and take over/release. Takeover pauses an active chatbot; explicit release plus a new customer reply resumes it.
7. Simulate STOP to verify suppression. Record new consent only when supported by actual consent evidence.

WebSockets use `NEXT_PUBLIC_API_ORIGIN` (default `http://localhost:4000`). Production must set it at build time and proxy `/socket.io` to the API. See deployment guidance.

## Build and run a chatbot

1. Open **Chatbot Builder**, name a flow and create it. A working quotation graph opens.
2. Select nodes and edit messages/variables; drag new nodes from the library and connect their handles. For a condition, connect both true and false outputs.
3. Fix any validation errors, save, and publish. Draft autosaves do not alter the published version.
4. Open **Test**, send `Hi`, then answer the name, requirement and quantity questions.
5. The real worker persists each waiting state, captures answers, creates a lead and sends the confirmation through the mock provider.
6. Open **Leads** to review the captured values; open **Inbox** to reply or take over.
7. To test automatic triggering, use Inbox → Simulate incoming with a new customer phone. A first-message flow will trigger normally. The builder simulator can explicitly target a published flow.

The ten included templates can be loaded into a draft through the editor. The simulator requires a published version. See [engine documentation](docs/CHATBOT_ENGINE.md) for exact supported nodes, limits and remaining features.
