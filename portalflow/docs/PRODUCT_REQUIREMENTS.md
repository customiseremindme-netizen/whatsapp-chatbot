# PortalFlow target specification for continuation

This document preserves the owner's intended product. It is a REQUIREMENT, not a claim of implementation. Use CAPABILITY_MATRIX.md for actual availability. Prefer robust end-to-end functionality over superficial feature counts. The owner is nontechnical and expects routine alterations through dashboards.

## Product, architecture and stack

Multi-tenant B2B WhatsApp Business Automation SaaS for India. Product PortalFlow; INR; English with Tamil/Hindi-ready localization; Asia/Kolkata default tenant timezone, configurable. Original design inspired by CRM/automation capabilities, never copied proprietary assets/source. Official Meta Cloud API only; no WhatsApp Web scraping, QR automation, reverse-engineered libraries or restriction bypass.

Mandatory stack: Next.js App Router, React, strict TypeScript, Tailwind, shadcn-style reusable UI, Lucide, React Hook Form, Zod, TanStack Query, @xyflow/react, Recharts. NestJS REST/OpenAPI and authorized WebSockets. PostgreSQL/Prisma/migrations. Redis/BullMQ with dedicated worker. pnpm workspaces/Turborepo/Docker/Compose/GitHub Actions. S3-compatible media, SMTP, official Meta, Razorpay, optional LLM. Check maintained compatible versions and official docs before adding/upgrading dependencies.

Monorepo: apps/web, apps/api, apps/worker; packages/database, shared, ui, config; infrastructure/docker; docs; scripts; .github/workflows. Existing packages/core is shared server logic; keep API/worker dependencies acyclic. Keep .env.example, production environment example, package lock, turbo.json, Compose and README current. No secrets in source.

## User interface and public pages

Premium responsive desktop/tablet/mobile SaaS, light/dark themes, accessible keyboard navigation. Default primary #2563EB, secondary #0F172A, accent #22C55E, background #F8FAFC, surface white, border #E2E8F0; Inter/comparable open-source font. White-label configuration should drive supported branding consistently.

Dashboard layout: collapsible sidebar, sticky top navigation, workspace switcher, notifications, profile, functional global search, breadcrumbs. Reusable tables/cards/forms/dialogs/drawers/charts/badges/pagination/filters/empty/loading/error/toast/confirmation components. No disconnected decorative controls.

Public routes: /, /features, /pricing, /solutions, /contact, /login, /register, /forgot-password, /privacy, /terms. Landing: hero, honest dashboard illustration, feature highlights, visual builder, CRM/inbox, broadcasts, use cases, pricing, FAQ, CTA/footer. No fabricated customers/testimonials or misleading Meta partner badges.

Tenant navigation target: Overview, Inbox, Contacts, Chatbot Builder, Automations, Broadcasts, Templates, Campaigns, Analytics, Integrations, Team, Billing, Settings, Help. Do not add dead pages merely to satisfy this list.

## Identity and isolation

Roles: platform super-admin, tenant owner/admin/manager/agent/viewer. Registration/login/logout, secure email verification/reset, workspace creation/switch, invitations/acceptance/member-role change/removal, profile/session management, suspension, subscription checks. Argon2, HTTP-only secure cookies, refresh-token rotation, CSRF and strict Origin/CORS rules.

Every tenant-owned resource includes tenantId. Resolve authorized tenant on the server, never from unchecked client input. Isolate contacts, messages, credentials, flows, campaigns, analytics and billing; use composite relational constraints and automated two-tenant tests. Platform configuration/plan catalogue/audit are explicitly global and require platform authorization for mutations. Do not make ordinary tenant owners platform admins.

## Metrics

DB-derived KPIs: total contacts/new leads/sent/received/delivered/failed messages, active bots, running campaigns, open conversations, average response time. Daily messaging, lead growth, delivery/campaign performance and conversation trends. Filters today/yesterday/7 days/30 days/custom date range interpreted in tenant timezone. Never fabricate engagement/conversions or revenue.

## Official WhatsApp and mock providers

Shared WhatsAppProvider with MetaCloudProvider and MockWhatsAppProvider. Local simulation must support incoming/outgoing text, delivery states, templates, interactive replies and practical image/document handling without credentials.

Connections: Meta app/WABA/phone-number IDs, display number, authorization/connection/webhook subscription states, encrypted tokens. Authorized Embedded Signup with server-side exchange, phone registration/access validation and exact safe errors. Do not claim app approval. Supply a manual authorized Meta test-number path.

Messaging: text/images/documents/audio, official templates, reply buttons/lists, read receipts and status updates. GET /webhooks/meta must verify challenge; POST must verify X-Hub-Signature-256 against raw body, validate schema, resolve tenant from authorized phone_number_id, persist/deduplicate/queue quickly, handle retries and out-of-order sent/delivered/read/failed states. Never log secrets/message content unnecessarily. Graph API version must be configured and officially supported.

Track latest customer message and 24-hour service window. Require approved templates for applicable business-initiated sends outside it. Respect opt-out/suppression. Live webhook paths need provider-specific signature authorization; do not simply remove browser CSRF/origin protections globally to make them work.

## Visual builder and execution (highest-priority capability)

Library left, canvas centre, node properties right; flow name/status/save/test/publish top; validation/execution logs below. Drag/drop/connect/delete/duplicate/zoom/pan/minimap/undo/redo/autosave/validate/publish/unpublish/version history/JSON import/export.

Required node types:
1. Start Trigger
2. Send Text
3. Send Image
4. Send Document
5. Interactive Buttons
6. Interactive List
7. Ask Question
8. Save User Input
9. Condition
10. Keyword Match
11. Delay
12. Set Variable
13. Apply Tag
14. Remove Tag
15. HTTP Request (restricted)
16. Assign Agent
17. Human Handoff
18. Send Approved Template
19. End Flow

Existing Create Lead is an intentional extra node. Required triggers: first message, keyword, button/list response, contact tag added, contact created, scheduled event, authorized API event. No arbitrary JavaScript from flows.

Validated versioned JSON with separate draft/published snapshots. Persist execution tenant/contact/conversation/version/current node/variables/status/waiting state/timestamps/errors. Inbound lifecycle: resolve tenant/contact → honor human takeover → deterministically choose/resume flow → execute/persist → queue outgoing → wait/capture/branch → complete safely. Support conditions, attributes, variable substitution, validated input, timeouts/follow-ups, handoff, bounded steps/loop detection and idempotency. Redis/BullMQ scheduling with durable state; no in-memory-only sessions. Preserve existing prompt-bound interactive replay protection.

Simulator MUST use the real engine via mock provider. Type messages, click options, observe replies/branches/variables/errors, reset synthetic conversation. Ten importable executable templates: Welcome, Lead Generation, Product Enquiry, Service Enquiry, Quotation Request, Order Status, Appointment Booking, FAQ, Customer Support, Human Transfer.

Example welcome menu: products/pricing/quotation/support (use official menu limits appropriately). Quotation asks name/requirement/quantity, persists contact data, tags Quotation Lead, creates lead, notifies assigned agent, confirms. Unknown order/stock/availability/prices must use verified sources or escalate, never invent.

## Inbox and CRM

Three-panel shared inbox: conversation list, chat, contact profile/notes. Search/filter assignment/status, history search, media display, delivery/read indicators, assign/unassign, open/close/unread, notes/tags/saved replies/contact editing, human takeover/resume. Pause bot on takeover; explicit workflow rules determine release behavior. Authorize every WebSocket room/event, including revoked sessions.

Contacts: name/phone/email/company/source/tags/notes/assignment/lead status/custom fields/consent evidence and timestamps/create/update. Add/edit/delete, CSV import/export, merge duplicates, custom-field definitions, bulk tags, filters/timeline. Imported contacts are NOT automatically opted in. Pipeline New/Contacted/Qualified/Quotation Sent/Follow-up/Won/Lost and complete activity history.

## Campaigns/templates

Create audience from valid opt-in contacts; suppress opt-outs; deduplicate recipients; require correct approved template; personalize variables/preview; schedule/launch/pause/cancel; validate entitlements and Meta limits; BullMQ rate-limited jobs; recipient states/progress/metrics. Statuses Draft/Scheduled/Running/Paused/Completed/Cancelled/Failed. Recheck eligibility at send time. No scraping/cold spam/bypass.

Templates: Marketing/Utility/Authentication; name/language/category/header/body/footer/buttons/variables/approval/rejection. Create/submit/sync/preview/filter/archive when allowed. Meta approval must come from Meta. Mock states must be visibly mock, never presented as official approval.

Analytics: sent/delivered/read/failed/incoming/outgoing; campaign audience/attempted/delivered/read/failed/opt-outs; bot triggers/completions/abandonments/errors/handoffs/leads; agent assigned/resolved/first response/resolution; estimates/subscription/AI/billing trends. Derive all from stored events.

## Subscription billing and Meta cost estimates

Billing-provider abstraction: Razorpay plus local mock. Trial/monthly/yearly/upgrade/downgrade/renew/cancel/failure/history/invoices/quotas. Configurable sample plans Starter ₹999 (1 number/1 member), Growth ₹2499 (1/3), Business ₹5999 (3/10); features and other limits editable by platform admin. Prices are software fees, not Meta charges. Verify Razorpay signatures; only authoritative verified events may mark invoices paid, never frontend redirects. Make retries/idempotency/concurrency safe. Enforce entitlements on API and worker paths.

Separate configurable effective-dated Meta pricing engine. The owner supplied these INDIA PLANNING ASSUMPTIONS effective 1 October 2026: Marketing ₹0.8631, Utility ₹0.115, Authentication ₹0.115 per delivered message; Service ₹0.115 after first 1,000 eligible service messages per business phone per calendar month. These are NOT independently verified current Meta tariffs. Validate current official pricing before live billing and label estimates clearly.

Database-managed regions/categories/versions/effective dates/allowances/usage/estimated costs/adjustments; country rates/tiers/free entry-point exceptions/taxes/provider fees as applicable. Never hardcode prices into sender. Estimate on eligible delivered events, not send requests, and never double-charge retries/webhooks. Official Meta billing is authoritative. Clients pay Meta directly where supported; SaaS subscription billed separately.

## Optional AI and integrations

Feature-flagged business-specific AI only: FAQ/product enquiries/lead qualification/order support/appointments/suggested replies. Provider interface, encrypted keys, tenant instructions and approved knowledge base, safe uploads/extraction/retrieval, confidence fallback/human escalation, usage/token/cost limits. Explicit mock when no key. Isolate all content. No general-purpose assistant or invented factual business data.

Connector abstraction for Shopify/WooCommerce/Google Sheets/CRMs/webhooks/REST. MVP generic authenticated outgoing webhook and restricted HTTP node. SSRF defenses: private/internal/link-local/metadata address blocking, DNS/IP validation against rebinding, strict redirects, timeouts, response/payload limits and encrypted credentials. Claim integrations only when authenticated behavior is implemented/tested.

## Super-admin target

Separate /admin with server-side platform authorization. Navigation/capabilities: overview, businesses/users, WhatsApp connections, plans/subscriptions/payments, platform usage/message costs, health/audit/configuration. Search/suspend/reactivate tenants; manage real plan prices/limits/entitlements; view payments/connections/queues/webhook failures/safe errors; update versioned message prices; configure supported branding/settings. Tenant admins cannot grant themselves platform access. Keep sensitive credentials write-only/redacted and encrypted.

## Relational data/security

Use UUIDs, foreign keys, unique constraints/indexes, deliberate cascades, timestamps, soft deletion where appropriate, transactions/migrations/seeds. Target concepts include User, Tenant, Membership, Invitation, Session, reset/verification tokens, WhatsAppConnection, Contact/Tag/Consent/CustomField, Conversation/Message/Attachment/Assignment/Note, BotFlow/Version/Execution/Variable/Trigger, ScheduledJob, MessageTemplate, Campaign/Recipient, UsageEvent/MessagePricingRate/PricingAllowance, SubscriptionPlan/TenantSubscription, Payment/Invoice, WebhookEvent, AuditLog, IntegrationCredential, Notification, ApiKey, Lead/Activity. Existing consolidated AccountToken, JSON variables/tags and outboxes need not be duplicated merely for naming; document intentional normalization choices.

Validation/auth/RBAC/tenant checks/rate limiting/CSRF/cookies/HTTPS/secret validation/encryption/signatures/audits/reset safety/file limits/type checks/URL protections/timeouts/retry limits/structured errors/minimal logs. Secure headers/restrictive CORS, data export/deletion, Indian data-protection and Meta obligations documentation without claiming legal compliance. No secrets to browser or logs.

## REST target under /api/v1

Auth register/login/logout/refresh/forgot/reset; tenants current/profile/members/invitations/switch; contacts CRUD/import/export; conversations list/detail/messages/assign/takeover/release; bots CRUD/validate/publish/unpublish/simulate/history; campaigns CRUD/schedule/launch/pause/cancel; templates create/submit/sync; WhatsApp connections/test/onboarding-exchange/disconnect; analytics overview/messages/campaigns/bots/agents; billing plans/subscription/checkout/invoices; Meta GET/POST and Razorpay POST webhooks; admin tenants/usage/subscriptions/system-health/audit/configuration/pricing/plans. Extend as needed. Use DTO/Zod validation, pagination/filtering, structured errors and Swagger. Existing route conventions are in docs/API.md.

## Local execution, tests and deployment

No paid services required locally: Postgres, Redis, Mailpit, mock WhatsApp/payment/AI where relevant, development-only sample users/two businesses/flows/messages. Demonstrate login→visual edit→save→publish→simulate→real engine reply→lead→inbox→takeover→eligible test campaign→analytics→admin. Never seed default credentials in production.

Unit: auth/authorization/tenant resolution/pricing/conditions/session progression/template validation. Integration: contacts/messaging/webhooks/campaign scheduling/subscription events/workers. Browser: full journey with two concurrent isolated tenants. Test duplicate webhooks, retries/out-of-order statuses, concurrent entitlement usage and stale revisions.

Provide actual Dockerfiles/Compose/production env/migration and worker commands/reverse proxy/HTTPS/health/logs/backups/restore/monitoring/CI. Support Linux VPS/DigitalOcean/AWS. Document domain/Postgres/Redis/SMTP/S3/Meta callback/token/App Review/Razorpay setup. Hostinger Web Hosting alone is not a verified target for this complete stack; choose a suitable VPS. Validate application images and clean checkout startup, do not claim that config files alone prove deployment.

Required docs: README, ARCHITECTURE, DATABASE, API, WHATSAPP_SETUP, META_APP_REVIEW, CHATBOT_ENGINE, BILLING, SECURITY, DEPLOYMENT, TESTING. Keep the nontechnical guide/current matrix/handoff updated too.

## Acceptance A–N (all must pass before calling MVP complete)

A Two independent businesses register.
B Each manages its own contacts/messages without cross-tenant access.
C Owner visually creates a chatbot.
D Validate/save/publish/execute work.
E Simulated inbound triggers the published bot.
F Bot asks/captures/branches/creates lead.
G Responses appear in the inbox.
H Agent takes over.
I Eligible campaign can be created and simulated.
J Delivered events correctly update analytics/cost estimates without duplicates.
K Subscription limits are enforced.
L Super-admin manages businesses and real plans/platform operations.
M Unit/integration/browser tests pass for all implemented acceptance paths.
N Clean checkout starts using documented commands.

## Execution discipline

Original build order: foundation → mock inbox → builder/engine → Meta → templates/campaigns/analytics/costs → billing/admin → optional AI/integrations → hardening/deployment. The owner's later request prioritized an initial admin panel; finish its real billing/entitlement integrations rather than mistaking catalogue CRUD for completed billing. Work in verifiable increments, run appropriate checks, fix failures, update TASKS, commit logical changes. If unable to finish everything in one execution, leave a working repository, exact incomplete checklist and next executable task. Never claim a phase complete unless it actually works.
