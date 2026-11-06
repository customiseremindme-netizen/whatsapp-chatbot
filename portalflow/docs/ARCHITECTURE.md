# Architecture

Current implementation: accounts, mock text messaging, visual chatbot editing and a persistent lead-capture engine. The browser sends same-origin `/api/v1` requests through a Next rewrite to NestJS. Nest owns authentication and authorization. PostgreSQL is authoritative for identities, memberships, sessions, tokens, audit events and the SMTP outbox. Redis provides API rate limiting and BullMQ scheduling. A separate worker drains the email outbox every five seconds.

`apps/web` uses TanStack Query for server state, React Hook Form + Zod for account/profile forms, shared UI primitives (Radix Slot, class-variance-authority, Tailwind) and Lucide icons. `apps/api` contains modules for accounts, authorization, workspace operations and health. `apps/worker` imports the database and server-only core packages; it never imports the API. `packages/shared` contains validation and role policies. No circular API/worker dependency exists.

The authenticated session determines active tenant. Workspace switching requires a database membership in the requested tenant. All resource operations scope reads/mutations to the authorized tenant. Role checks are refreshed from PostgreSQL on every request. Suspension blocks sessions immediately.

The schema and UI intentionally cover implemented functionality only. The visual builder and persistent execution engine now live in the web/shared/core packages. Campaigns, billing and richer automation actions remain future work.

Version selection checked npm metadata and official Next, Nest and Prisma installation documentation on 4 November 2026. Node 24 is the runtime target. Prisma CLI/client/adapter are pinned together at 7.10.1; the registry's latest CLI tag pointed to an 8.0 release candidate and was avoided. Dependency resolution is committed in pnpm-lock.yaml.


`packages/core` owns server-only messaging application logic and the WhatsAppProvider interface. The API and worker both depend on it; the frontend never imports it. MockWhatsAppProvider returns stable provider IDs and explicitly simulated delivered receipts. Future live providers must report SENT until verified delivery events arrive. The worker scans durable inbound and outgoing queues using PostgreSQL row locks and BullMQ scheduling. Outgoing provider errors are persisted and capped at three attempts. Redis pub/sub notifies the Nest Socket.IO gateway; no message content goes through Redis notifications. Each notification rechecks every receiving socket's current session, tenant membership, expiry and suspension. Browser queries then fetch authorized data. A 10-second polling fallback handles disconnects or lost notifications; it never substitutes for durable state.
