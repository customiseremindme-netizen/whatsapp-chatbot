# PortalFlow implementation ledger

## Current state

The local core journey is implemented and verified: register/login → visually edit/publish a chatbot → simulated inbound message → persisted questions/answers/branches → lead creation → inbox reply and human takeover. Full specification completion is not claimed; richer message/node types, live integrations, campaigns, pricing, billing, quotas and full super-admin operations remain open. An initial platform-admin panel is now implemented; see docs/CAPABILITY_MATRIX.md for current scope.

## Execution plan

1. Establish strict TypeScript monorepo, pinned dependencies, Compose and migrations.
2. Implement database-backed authentication, email outbox, tenant authorization and workspace management.
3. Connect Next.js forms, workspace dashboard, team and settings to the API.
4. Run typecheck, lint, PostgreSQL integration and Playwright tests. Record evidence before starting Phase 2.

## Phase checklist

- [x] Phase 1: tooling, Docker, account schema, authentication, tenant isolation, dashboard shell
- [ ] Phase 2: mock provider, contacts, messages, webhooks, realtime inbox
- [ ] Phase 3: visual builder, persistent engine, simulator, sample flows
- [ ] Phase 4: live Meta integration and onboarding
- [ ] Phase 5: templates, campaigns, analytics and estimated pricing
- [ ] Phase 6: billing, quotas and super-admin operations
- [ ] Phase 7: optional AI and restricted integrations
- [ ] Phase 8: full security review, acceptance E2E and deployment validation

## External setup

No external credentials supplied. Phase 1 uses PostgreSQL, Redis and Mailpit locally. Live Meta, Razorpay, SMTP, S3 and optional AI require credentials in later phases. No partner approval is assumed.

## Scope rules

Only implemented modules appear in navigation. The full domain schema grows with tested functionality; future tables and endpoints are not placeholder implementations. AccountToken intentionally unifies single-use verification and password reset tokens. EmailOutbox is a durable SMTP delivery queue, not a tenant-facing resource.

## Phase 1 verification — 4 November 2026

- Monorepo, initial account migration, authentication, tenant authorization and dashboard foundation implemented.
- PostgreSQL/Redis/Mailpit Compose services healthy; migration applied; two development tenants seeded.
- `pnpm build`: six workspace builds passed.
- `pnpm typecheck`: nine tasks passed. `pnpm lint`: passed.
- `pnpm test`: 7 unit tests passed.
- `pnpm test:integration`: 10 PostgreSQL/HTTP tests passed.
- `pnpm test:e2e`: 2 Chromium journeys passed (desktop account/workspace lifecycle and mobile navigation).
- `pnpm test:worker`: real BullMQ → PostgreSQL outbox → SMTP → Mailpit delivery passed; delivered content redacted.
- `pnpm peers check`: no peer dependency issues after upgrading Swagger to 12.1.0 alongside Nest 12.
- `docker compose -f docker-compose.yml -f docker-compose.app.yml config --quiet`: passed. Full application image build is not yet verified; infrastructure containers and host application are verified.
- Documentation explicitly records Phase 1 limitations; subscription enforcement and platform admin belong to Phase 6, not this checkpoint.

## Phase 2 text-messaging milestone — verified 4 November 2026

- [x] Server-only shared application package and WhatsAppProvider interface.
- [x] Mock text provider with deterministic provider IDs and explicitly simulated delivery.
- [x] Durable incoming-event ingestion, concurrent deduplication, queue processing and recipient suppression.
- [x] Contacts: create, search, paginate, edit, tag, note, archive and evidence-backed consent records.
- [x] Conversations: persisted history, send, assign/unassign, close/reopen, unread state, internal notes, takeover/release.
- [x] NestJS WebSocket gateway with Origin/session checks and tenant/membership reauthorization per notification.
- [x] Service-window checks at enqueue and delivery; STOP/UNSUBSCRIBE handling; bounded provider retries.
- [x] Duplicate-safe, row-locked status progression; composite database tenant constraints.
- [x] Desktop inbox/contacts UI and mock inbound controls; database-backed sample conversations for both demo tenants.
- [ ] Media attachments, interactive and approved-template message representations.
- [ ] Saved replies, CSV import/export and advanced CRM operations.

Verification:

- Production build: 7 tasks passed.
- Typecheck: 11 workspace tasks plus strict test-source typecheck passed.
- Lint: passed. Unit tests: 11 passed.
- Integration tests: 19 passed, including real worker/socket processing, concurrent duplicate input, provider retry exhaustion, out-of-order status races and tenant isolation.
- Browser E2E: 3 passed, including a real WebSocket-connected inbox journey.
- SMTP worker integration: passed after messaging changes.
- Fresh database migration/seed smoke check: both migrations applied; 2 tenants, 2 contacts, 2 conversations and 2 messages created; disposable check database removed.
- Dependency peers: no issues.
- Dashboard and inbox visually inspected using Chromium screenshots.

At the Phase 2 checkpoint, bot execution and lead capture were not yet implemented. They are covered by the later milestone below. Richer message types, broadcasts, live Meta, payment, pricing, quota and admin functionality remain open. No application Docker image build was run; Compose infrastructure and host application are verified.

## Milestone plan recorded after Phase 2

Finish the message payload contract for buttons/lists/templates, then implement Phase 3: versioned flow schema and graph validation, visual @xyflow/react editor, draft/published persistence, durable execution sessions with ask/answer/condition/lead/handoff nodes, and a simulator using this same incoming-event/worker/message pipeline. Tests must cover restart-safe waiting sessions and takeover before the milestone is marked complete.

## Phase 3 visual editor and persistent engine milestone

- [x] Versioned strict graph schema, cycle/reachability/branch validation, bounded execution and no arbitrary code.
- [x] Visual @xyflow/react editor: drag/drop, handles, properties, duplicate/delete, pan/zoom/minimap, undo/redo, autosave, JSON import/export.
- [x] Draft revision conflict protection, publish/unpublish, immutable history and restore-to-draft.
- [x] Persistent questions/answers, conditions, variables, text replies, tags, lead creation and human handoff.
- [x] Pinned versions survive publishing changes and worker restarts.
- [x] Deterministic first-message/keyword triggers; transactional inbound execution and idempotent outgoing messages.
- [x] Human takeover pauses active sessions; release requires a new customer message to continue.
- [x] Simulator uses the actual inbound worker/provider path and displays variables, logs and persisted messages.
- [x] Ten working template flows; enquiry/status/appointment/FAQ templates escalate for verified answers rather than fabricating business data.
- [x] Leads page with captured values and pipeline status updates.
- [x] Monotonic message ordering for multiple prompts created in one database transaction.
- [x] Development seeds include draft quotation flows for both demo tenants.
- [ ] Remaining nodes, media/template messages, extra scheduled triggers and restricted HTTP actions. Buttons/lists, delays and proactive question deadlines are now implemented.
- [ ] Remaining trigger types and complete lead activity/notification features.

Verification:

- 24 unit tests passed.
- 35 real PostgreSQL/API/worker integration tests passed, including all ten template executions.
- 4 Chromium E2E tests passed, including visual edit → publish → simulate → lead → inbox → takeover.
- Production build, workspace/test-source typechecks and lint passed; final release checks also passed after documentation/seed changes.
- Core journey acceptance A–H is covered locally. Campaigns (I), cost estimates (J), quotas (K), and super-admin operations (L) remain unimplemented. Full acceptance is therefore not complete.

## Next executable milestone

Complete the richer WhatsApp payload contract and remaining automation nodes, especially media/template sends, agent assignment, remaining triggers and restricted HTTP actions. Then implement official Meta connections/webhooks, campaigns/pricing, subscription enforcement/Razorpay and platform administration in the specified build order. Preserve the existing tenant-isolation, persistence and browser regression suites.

Final startup/visual checks:

- All four migrations and the seed applied to a fresh disposable PostgreSQL database, yielding 2 tenants, 2 draft bots and 2 sample messages; the check database was removed.
- SMTP worker test passed after engine integration.
- Visual builder inspected in Chromium at desktop and 390px mobile widths; no mobile horizontal overflow.
- API, web and dedicated worker are running locally in the development environment.
- Full application Docker image remains unbuilt/unverified; this does not imply production deployment validation.

## Completed milestone: durable delays and question deadlines

- [x] Add backward-compatible timing fields and deadline indexes/migration.
- [x] Add Delay node, timer reconciliation, takeover-safe resume and proactive question expiry.
- [x] Expose duration/deadline editing and simulator schedule state.
- [x] Verify restart recovery, concurrent workers, suppression/window checks and browser timing flow.
- [x] Update documentation, commit, and refresh the source archive.

Verification on 5 November 2026:
- Production build, strict typechecks (including tests), lint and 25 unit tests pass.
- 42 API/database/worker integration cases pass; the six timer cases were rerun after adding stale queued-prompt suppression and pass.
- Five Chromium tests pass (four regression cases plus the focused scheduled-resume browser test).
- All five migrations apply to a fresh disposable PostgreSQL database, which was then removed.
- Timer deadlines are approximate and reconciled by the recurring BullMQ job. Scheduled flow triggers, template follow-ups, media/interactive payloads, live Meta, campaigns, billing/quotas and super-admin remain pending.
- Next executable milestone: interactive buttons/lists and their persisted reply branches, before live Meta integration.

## Completed milestone: interactive replies

- [x] Persist structured button/list prompts and contextual replies.
- [x] Validate and execute option branches through the shared engine.
- [x] Add visual properties/handles and clickable simulator options.
- [x] Verify isolation, stale replies, restart recovery and browser journey; update documentation.

Verification on 5 November 2026 (interactive replies):
- Production build, strict workspace/test-source typechecks, lint and 26 unit tests pass.
- 44 integration cases are covered: the initial concurrent-build run passed 40 and timed out/reset in four bot cases; an isolated rerun of all 19 bot cases passed, including all affected cases. Run heavy build checks before integration tests on a small runner.
- Six browser cases pass across the regression run and targeted rerun. The new test's exact-text assertion was corrected to account for the message direction label; the inbox test now waits for login navigation before checking the dashboard.
- All six migrations applied successfully to a fresh disposable database, which was removed afterward.
- Live Meta delivery is still unimplemented. Interactive lists currently use one flat group, titles of up to 20 characters, and no descriptions/headers/footers. Agent-authored menus are not implemented.
- Next executable milestone: media message contracts/nodes and agent assignment, then the remaining automation actions before live Meta connection work.

Final startup check: API health returns OK, web login returns HTTP 200, and the dedicated worker is running. No public deployment or GitHub push was performed.

## Completed milestone: initial owner administration and Claude handoff

- [x] Platform-only admin APIs and dashboard: totals, business access, user directory, plan catalogue, brand configuration, audit history.
- [x] Development admin account and explicit server-side bootstrap command.
- [x] Authorization, suspension, audit, validation, concurrency and browser tests.
- [x] Honest capability matrix, nontechnical admin guide, full continuation prompt and source ZIP.

Verification on 5 November 2026:
- Production build, strict workspace/test-source typechecks and lint passed; 28 unit tests passed.
- The full integration run passed 49/50 and found a real branding lock-query error. Fixed the PostgreSQL void-result handling by using executeRaw for the advisory lock. All six admin integration cases passed on the targeted rerun; the other 44 cases passed in the full run.
- Seven of eight browser cases initially passed. The denial assertion also matched Next.js's empty route-announcement alert; scoped the selector. Both admin browser cases passed on rerun, covering all eight cases across runs.
- All seven migrations and development seed applied to a fresh disposable PostgreSQL database: three workspaces (two customers plus operations), one platform admin, three catalogue plans. The disposable database was removed.
- Admin bootstrap CLI was executed against the verified local development operator.
- Added START_HERE.md, CLAUDE_PROMPT.md, docs/ADMIN_GUIDE.md, docs/HANDOFF.md, docs/CAPABILITY_MATRIX.md and docs/PRODUCT_REQUIREMENTS.md. These explicitly identify unfinished work and the owner's no-code administration requirement.
- The platform is NOT complete. Live Meta, campaigns, actual subscriptions/quotas/payments/costs, media/remaining actions, AI/integrations and production deployment are unfinished. Initial catalogue/admin controls are not full Phase 6 completion.
- No GitHub push, public deployment or live provider connection was performed. The source archive excludes private environment/data/build/test-result files.

## Completed milestone: manual access grants and enforceable capacity

- [x] Persist revisioned manual plan snapshots and expiry/status; expose tenant usage.
- [x] Enforce contact, chatbot and member limits with tenant row locks in API/worker paths.
- [x] Preserve blocked inbound events for explicit retry; block inactive outbound/automation.
- [x] Admin assignment UI and tenant plan/usage page; no fabricated payment status.
- [x] Concurrency/isolation/expiry/downgrade/worker/browser tests and refreshed handoff archive.

Verification on 6 November 2026 (manual access milestone):
- Production build, strict workspace/test-source typechecks and lint passed. All 28 unit and 57 integration tests passed.
- Applied all eight migrations and the development seed to a fresh disposable PostgreSQL database; confirmed three workspaces, then removed the database.
- Browser validation: fixed an exact-label selector issue with explicit accessible select names. A subsequent full run passed six cases and timed out on three during a slow environment run. All three failed cases then passed in isolation (admin grant, chatbot lead capture, inbox). All nine cases passed across runs; a single clean full-suite run remains desirable in CI.
- No actual payment collection, live Meta connection, public deployment or GitHub push is claimed.
- Commands executed: pnpm build; pnpm typecheck; pnpm lint; pnpm test; pnpm test:integration; pnpm test:e2e; pnpm test:e2e --last-failed; pnpm db:migrate and pnpm db:seed against a disposable database.
- Changed database migration/schema, shared entitlement logic, API/worker enforcement, admin assignment and tenant usage UI, integration/browser tests and handoff documentation.
- Next executable milestone: official Meta provider contracts and signed webhook ingestion with mocked contract tests; preserve current engine and manual grants.
