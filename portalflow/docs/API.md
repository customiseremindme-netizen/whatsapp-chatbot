# API reference

Base `/api/v1`. Swagger UI `/api/docs`, generated spec `/api/docs-json`. Current Swagger documents route discovery and cookie authentication; shared Zod schemas are the authoritative request constraints.

All mutations require the exact configured `Origin`, including public authentication routes. Authenticated mutations additionally require `X-CSRF-Token` matching the readable `pf_csrf` cookie. `pf_access` and `pf_refresh` are HTTP-only cookies. Access lasts 15 minutes, session/refresh lifetime 30 days. Refresh rotates tokens; replay of the immediately preceding refresh token revokes that session. Logout and session deletion revoke server-side state.

| Routes | Behavior |
|---|---|
| POST /auth/register | `{name,email,password,workspace}`; password 12–128 characters |
| POST /auth/login | `{email,password}` |
| POST /auth/refresh | Rotate using refresh cookie and CSRF header |
| POST /auth/logout | Revoke current session |
| POST /auth/forgot-password | `{email}`; generic response |
| POST /auth/reset-password | `{token,password}`; revoke all sessions |
| POST /auth/verify-email | `{token}` |
| POST /auth/resend-verification | Queue verification email for current user |
| GET /auth/me | Safe user, tenant, role and session ID |
| GET /auth/sessions | Current user's unrevoked, unexpired sessions |
| DELETE /auth/sessions/:id | Revoke only own session |
| GET, POST /tenants | List own memberships; create with `{name}` |
| POST /tenants/switch | `{tenantId}`; requires active membership |
| GET, PATCH /tenants/current | Update `{name,timezone,language}`; owner/admin only |
| GET /tenants/members | Current tenant's team |
| POST /tenants/invitations | `{email,role}`; verified owner/admin |
| POST /tenants/invitations/accept | `{token}`; verified invited email |
| PATCH, DELETE /tenants/members/:id | Change `{role}` or remove; protected owner/admin hierarchy |
| GET /tenants/overview | Actual member/invitation counts and recent audit events |
| GET /tenants/audit-logs | Last 50 events; owner/admin |
| GET /health | Database readiness; Redis middleware also must succeed |

Unknown JSON keys are rejected in validated bodies. IDs must be UUIDs. Errors use `{statusCode,error}` for controller/guard failures; middleware returns `{error}`. 401 means missing/expired session, 403 means authorization/CSRF/origin/suspension, 400 validation, 404 inaccessible resource, 409 registration conflict, 429 rate limit, 503 Redis unavailable. Internal details are not returned.

Workspace/account lists are currently unpaginated; audit logs are bounded. Contact/conversation/message lists support `page`, `limit` (max 100) and `search`, returning `{items,total,page,limit}`.

## Mock messaging and CRM

- GET/POST `/contacts`; GET/PATCH/DELETE `/contacts/:id`. DELETE archives and suppresses; it is not legal data erasure. Phone identity is immutable in this milestone.
- POST `/contacts/:id/consent` with `{optedIn,source}` records explicit evidence; creation never opts a contact in.
- GET `/conversations` supports optional `status` and `assignedUserId`; GET `/conversations/:id` loads one authorized conversation.
- GET `/conversations/:id/messages` returns a reverse-chronological page in display order; POST accepts `{text,idempotencyKey}` where the key is a UUID. It queues a message and enables takeover. Sending requires an active service window and a non-suppressed contact.
- PATCH `/conversations/:id` accepts `status` and/or `unread`.
- POST `/conversations/:id/assign` accepts `{userId}` or null; the user must belong to the tenant and not be a Viewer.
- POST `/conversations/:id/takeover` and `/release` persist the handoff state. Releasing resumes a paused bot state; the next customer input continues execution.
- GET/POST `/conversations/:id/notes` reads/adds internal notes; POST body `{text}`.
- POST `/whatsapp/mock/inbound` accepts `{externalId,phone,text}` and persists a duplicate-safe event for asynchronous processing. It is authenticated and explicitly mock-only, not a Meta webhook.

All messaging writes reject Viewers. WebSocket handshakes require the configured Origin and access cookie. The server selects the tenant from the session; clients cannot choose rooms. Notifications contain no message body. Live Meta webhooks, media, interactive/template messages and billing endpoints are not yet implemented.


## Bots and leads

`GET/POST /bots` lists/creates flows. New flows start with the quotation graph. `GET/PATCH/DELETE /bots/:id` reads, saves or archives. Save accepts `{name,revision,draft,priority?}`; stale revision returns 409. Bot writes require Owner, Admin or Manager.

`POST /bots/:id/validate` validates the stored draft. `POST /bots/:id/publish` accepts `{revision}` and inserts an immutable version after graph validation. `POST /bots/:id/unpublish` prevents new matches. `GET /bots/:id/versions` returns the latest 50 snapshots. `GET /bots/:id/executions` returns the latest 20 executions with tenant-scoped contact, logs and variables.

`POST /bots/:id/simulate` accepts `{externalId,phone,text}` and queues a mock event targeting the published flow. It does not execute a separate simulator. `GET /leads` is paginated; `PATCH /leads/:id` changes `{status}` to one of NEW, CONTACTED, QUALIFIED, QUOTATION_SENT, FOLLOW_UP, WON, LOST. Viewers cannot mutate leads.

Interactive mock input: both `POST /api/v1/bots/:id/simulate` and `POST /api/v1/whatsapp/mock/inbound` accept the existing `externalId`, `phone`, and `text`, plus optional `reply: { messageId, optionId }`. The message ID must identify the current outbound menu prompt in the same conversation. Accepted requests enqueue events; they do not guarantee a selection was valid. Inspect execution state/messages for the result. Message history exposes nullable `interactive: { kind: "buttons" | "list", options: [{id,title}] }` and `reply` fields.

Platform administration: `GET /api/v1/configuration` exposes only safe public branding. `/api/v1/admin/overview`, `/tenants`, `/users`, `/plans`, `/audit-logs` require platformAdmin. `PATCH /admin/tenants/:id/status` takes suspended/reason and revokes sessions when suspending. `POST /admin/plans` creates a catalogue record; `PATCH /admin/plans/:id` requires all plan fields plus revision. `PATCH /admin/configuration` requires brandName/primaryColor/supportEmail/revision. Mutations are CSRF/Origin protected and platform-audited. User directory responses exclude credentials. Plan/configuration stale writes return 409. These are global resources and never available to an ordinary tenant owner.

Manual access: platform-only GET/PATCH `/api/v1/admin/tenants/:id/subscription`; assignment requires planId/status/expiresAt/revision/reason. Current-tenant GET `/api/v1/billing/subscription` exposes access/usage; owner/admin POST `/api/v1/billing/retry-blocked` requeues up to 25 preserved QUOTA_BLOCKED events. API resource capacity checks return 403 ENTITLEMENT_LIMIT. These routes do not collect payments. See ENTITLEMENTS.md.
