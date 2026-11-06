# Current capability matrix

This describes implemented behavior, not the target specification. No public deployment has been performed.

| Area | Current state | Still required |
|---|---|---|
| Accounts | Registration/login/logout, refresh rotation, verification/reset, sessions, workspaces, invitations/team roles | Full account lifecycle/data deletion and production hardening review |
| Tenant isolation | Server membership guards, tenant filters, composite foreign keys, tested WebSocket authorization | Extend the same guarantees to every new module |
| Contacts | Create/edit/search/page, tags, notes, soft archive, explicit consent | CSV import/export, duplicate merge, bulk ops, custom-field definitions, complete timeline |
| Inbox | Mock text history/replies/statuses, assignment, close/reopen, notes, unread, takeover/release, real-time events | Media/audio/documents, saved replies, message search, full filters, live Meta |
| Builder | Drag/drop, connections, properties, undo/redo, autosave, revision conflicts, validation, immutable publish/unpublish/history/import/export | Remaining node kinds and triggers |
| Engine | Start/text/ask/condition/set variable/tags/create lead/handoff/end/delay/buttons/list, persistent sessions and deadlines, bounded steps, pinned versions, deduplication | Image/document, standalone input save/keyword node, restricted HTTP, agent assignment, approved template sends, advanced triggers/timeouts |
| Simulator | Real API → database → worker → same engine/mock provider, clickable menu choices, state/variables/logs, reset sender | Media previews and remaining node behavior |
| Flow templates | Ten importable flows run locally; unknown business data escalates to human | Richer industry workflows backed by authenticated integrations |
| Leads | Capture/update contact, one lead per execution, pipeline stage UI | Full activities/notifications/follow-up CRM |
| WhatsApp | Mock provider, stored outbox/inbound events, service-window/suppression checks | Official Meta provider, connections/token encryption, Embedded Signup, signed/deduplicated webhooks, media/template/interactive wire formats |
| Templates | No Meta template management | Create/submit/sync/reject/archive with real provider statuses |
| Campaigns | Not implemented | Eligible audience/opt-in, personalized approved templates, recipient jobs, scheduling/rate limits/pause/cancel/progress |
| Analytics | Existing tenant dashboard stored counts; admin stored platform totals | Requested trends, funnels, agent timings, campaign analytics, date filters, delivery-cost reporting |
| Costs | Not implemented | Effective-dated country/category rates, allowances/tiers/exceptions, delivered-event idempotency, estimates vs authoritative Meta charges |
| Plans | Catalogue, revisioned manual assignments, expiry/status, 14-day bounded trial, atomic contact/bot/member capacity, reservation-aware invites, blocked-inbound retry, usage UI | Payments, feature/message/number quotas, automatic renewals and provider-driven subscriptions |
| Billing | Not implemented | Mock/Razorpay provider, signature verification, authoritative events, invoices/payments/cancellation/failure flows |
| Admin | /admin guarded server APIs, totals, tenant suspension/reactivation/session revocation, user directory, plans, branding/support, audit logs | Subscriptions/payments/rates, connection/job/webhook health, broader settings and no-code integration setup |
| AI | Not implemented | Feature flag, isolated approved knowledge retrieval, providers, quotas, metering, fallback; no invented business facts |
| Integrations | Not implemented | Authenticated outgoing webhooks, SSRF-safe HTTP nodes and connector abstraction |
| Branding | Editable UI name, primary colour, support link; light/dark modes | Full white-label assets, emails/metadata/content editing |
| Marketing | Basic landing and auth pages | Full features/pricing/solutions/contact/privacy/terms/FAQ pages |
| Storage | Not implemented | S3-compatible upload validation/limits and safe download handling |
| Deployment | Infrastructure Compose, application Dockerfiles, CI, operational docs, tested host-mode builds | Full application image and production topology execution, HTTPS/DNS, backup restore drill, monitoring/load/security validation |

The full A–N acceptance set is NOT complete. A–H have local mock journey coverage; I–J are unimplemented; K is partially covered for contact/bot/team capacity only. L is only partly implemented (business management/catalogue/manual grants, not full billing/platform operations). Tests exist and have been run, but complete-product M/N require new modules and production/clean-checkout deployment verification.
