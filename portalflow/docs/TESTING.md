# Testing

Run from repository root with installed dependencies and generated Prisma client.

- `pnpm test`: 28 unit cases for role policies, validation, token hashing, CSRF and expiry.
- `pnpm test:integration`: real HTTP API + PostgreSQL tests for concurrent independent registration, cross-tenant mutation denial, CSRF/Origin, roles, suspension, token hashing, refresh replay, invitations, verification and reset/session revocation. Start API first. **Stop the email worker** during this suite, because it intentionally reads undelivered tokens from its own internal test outbox. No production endpoint returns tokens.
- `pnpm test:e2e`: Playwright registration, settings, workspace switching, team, theme, logout/login and responsive navigation. API must already be running. Playwright starts the built web app if needed. Seed before the mobile check.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: all workspace checks.

Tests require a disposable development database, never production. Integration tests clean their own users/tenants; browser accounts remain. Messaging tests now exercise duplicate events, status order/retries, real BullMQ processing, WebSocket tenant isolation and revoked-session disconnects. Future phase tests must cover live webhooks, campaigns, payment/message/number quotas and the full automation acceptance journey. Unimplemented paths are not currently claimed.

The CI workflow starts services, migrates/seeds, builds, typechecks/lints, and runs unit, integration and browser tests. Release verification evidence is recorded in TASKS.md.

`pnpm test:worker` starts a temporary dedicated worker and verifies delivery through the real SMTP capture service, then stops the worker. Run after the account integration suite.


The messaging integration suite starts its own worker with email delivery disabled and stops it afterward. A provider test injects failures to prove three-attempt termination and races status callbacks against PostgreSQL row locks. The inbox E2E test asserts a real live WebSocket connection, creates a contact, receives a simulated message, sends a delivered mock reply and adds an internal note. All test TypeScript is checked by the root `pnpm typecheck` command.

Bot verification adds real worker restart recovery, immutable version pinning during active sessions, takeover/explicit release, numeric answer validation, duplicate-safe lead creation, monotonic prompt order, conditional branches, tenant isolation and all ten template executions. The full browser bot journey edits a visual node, publishes, answers simulator questions, confirms a persisted lead, changes its stage and takes over in Inbox. The current suite has 28 unit, 57 integration and 9 browser tests.

Timer coverage includes concurrent reconciliation, proactive question expiry, stale queued prompt suppression, paused/closed/suspended work, opt-out, service-window expiry, and worker restart followed by explicit human release. Browser coverage edits the question deadline and verifies its simulator display, and imports/edits/publishes a Delay flow that resumes without another inbound message. Run integration and browser suites sequentially: their workers share the local database.

Interactive tests exercise both button and list routing after worker restart, persisted payloads, conflicting duplicate events, foreign prompt rejection, stale replies during a later question, lead creation and support handoff. The browser edits an option title, publishes, clicks it and observes the selected branch. Run build/typecheck/lint before the integration suite rather than concurrently on a small runner.

Admin tests cover ordinary-owner denial on every admin API, anonymous denial, CSRF, session revocation/reactivation, operator-lockout prevention, sanitized user directory, stored platform totals, price validation/revision conflicts, safe public branding and audit persistence. Browser tests edit plan prices/archive state and branding through the UI and verify owner access denial. The development seed now includes the admin account required by browser tests.

Entitlement coverage: owner/cross-tenant denial, concurrent last-slot contacts/bots, invitation reservations/acceptance, snapshot pinning, stale assignment rejection, downgrade safety, blocked inbound recovery, expired outbox/timer refusal, trial expiry, and browser admin assignment → owner usage → enforced contact limit.

## Environment notes (November 2026)

- Node 24 (see `engines`). Running on Node 22 works but is unsupported.
- `pnpm test:integration` needs the API running with `HTTP_NODE_TEST_ORIGINS=http://127.0.0.1:47811` (present in `.env.example`) because the HTTP Request node test starts a local server on that port.
- `pnpm test:worker` needs Mailpit on 1025/8025. Without Docker, `go install github.com/axllent/mailpit@v1.27.11` builds it.
- To reuse a preinstalled Chromium instead of `playwright install`, set `PLAYWRIGHT_CHROMIUM_PATH` to its executable.
- Integration tests register many accounts; the login/registration limiter (30/min per IP) no longer affects sign-out, which previously made the browser sign-out step flaky right after the integration suite.
