# Chatbot engine

Implemented locally with the mock WhatsApp provider. The visual editor and simulator use the same database-backed engine as normal mock inbound messages. There is no separate simplified preview engine.

## Implemented nodes

Start Trigger, Send Text, Ask Question, Delay, Reply Buttons, Interactive List, Condition, Set Variable, Apply Tag, Remove Tag, Create Lead, Human Handoff, End Flow. Questions validate text, email, or non-negative numeric input. Conditions support equals, contains, exists and numeric greater-than-or-equal. Text substitutes `{{variable}}` as plain text; no JavaScript, expression interpreter or arbitrary code runs.

The editor uses @xyflow/react with a node library, drag/drop, connection handles, selected-node properties, pan/zoom/minimap, delete/duplicate, undo/redo, debounced draft saves, graph validation, publish/unpublish, immutable version history, version-to-draft restoration, JSON export/import and a simulator. Import size is capped at 100 KB. Draft edits use a revision compare-and-swap; conflicting edits require reload rather than silently overwriting another editor.

Validation rejects malformed data, duplicate IDs, missing targets, incorrect outgoing connections, unreachable nodes, cycles, unsafe variable names and missing required node properties. Condition nodes require both true/false branches. Graphs are bounded to 100 nodes/200 edges; execution is capped at 100 total steps.

## Persistence and triggers

BotFlow stores the editable draft and published version number. Publishing locks the flow row, validates the saved draft and inserts an immutable BotFlowVersion. BotExecution pins that version for its whole lifetime; publishing a later version cannot change an in-progress conversation. Unpublishing/archiving stops new matches; existing pinned sessions may finish.

Normal inbound messages trigger First customer message or Exact keyword flows. Multiple matches resolve by ascending priority, then creation time, then UUID. Priority can currently be set through the draft API. Only one active session is resumed per conversation. Inbound processing locks the conversation as part of a PostgreSQL transaction; storing the customer message, changing execution state, capturing variables, creating leads and queuing replies commit together. Event deduplication prevents replaying those effects. Monotonic message sequence numbers preserve order when prompts share a transaction timestamp.

States: RUNNING, WAITING, SLEEPING, PAUSED, COMPLETED, HANDOFF, FAILED, TIMED_OUT, CANCELLED. An Ask node stores the current node, waiting variable, variables and logs before the worker can exit. The next valid inbound answer resumes the pinned graph. Invalid answers produce a validation reply without advancing. Questions persist an absolute answer deadline (configurable from 1 second to 24 hours). The worker proactively expires unanswered questions, without needing another incoming message. Invalid answers do not extend the deadline.

Takeover and human replies pause active sessions and hold their queued bot messages. Explicit release restores the waiting/running/sleeping state. Waiting questions require a new answer; sleeping sessions resume on the worker tick once due. Takeover does not extend absolute deadlines: overdue questions expire after release. A Human Handoff node sends its confirmation and completes with HANDOFF while setting takeover. It does not pretend a human has replied or that an external agent notification service exists.

Create Lead upserts one lead per execution, copies captured fields into the contact, optionally updates name/email, and records an audit event. The Leads page shows captured values and supports the New → Contacted → Qualified → Quotation Sent → Follow-up → Won/Lost stages. It does not yet implement a full lead activity timeline or external CRM synchronization.

## Simulator and templates

Save and publish, then open Test. Each reset selects a fresh synthetic mock phone; it does not delete existing conversations. The simulator posts to `/bots/:id/simulate`, which queues the same persisted inbound event used by the messaging worker. It tests the published snapshot, displays real messages, variables, branches, execution status and errors, and leaves the conversation in Inbox. Current test history is limited to the latest 20 flow executions/100 messages.

Ten importable templates are present and exercised through the real worker: Welcome, Lead Generation, Product Enquiry, Service Enquiry, Quotation Request, Order Status, Appointment Booking, FAQ, Customer Support and Human Agent Transfer. Order, FAQ, product and appointment templates collect an enquiry and hand off for verified information. They never invent prices, order statuses, knowledge-base answers or confirmed availability.

## Not implemented yet

Image/document nodes, standalone Save Input/Keyword nodes, restricted HTTP action, automatic agent assignment nodes, approved templates, contact-tag/contact-created/API/scheduled triggers, AI and outbound integration actions. These are absent from the node library rather than nonfunctional placeholders. Live Meta delivery is still pending. The complete 19-node and multi-trigger specification is not claimed complete.

## Durable delays

Delay nodes accept 1–604800 seconds. They persist `wakeAt` in PostgreSQL and yield execution. BullMQ's recurring messaging job reconciles up to 25 due executions per tick, normally once per second. Timing is approximate, not a real-time guarantee. Downtime or Redis job loss does not discard the database deadline. On recovery the worker resumes the pinned published version. Tenant/contact/conversation row locks and fresh deadline checks prevent concurrent workers from emitting duplicate responses.

Incoming messages during a delay are stored and refresh the customer service window; they do not skip the delay or answer a later question. Suspended tenants, closed conversations and human takeover hold timer work. Opt-out/deleted contacts cancel executions. A delayed resume outside the 24-hour service window times out without sending. A delay never grants permission to send free-form messages outside that window. Queued bot replies from failed, cancelled or timed-out executions fail instead of being delivered late.

The builder exposes delay duration and question timeout; its simulator shows persisted deadlines in the workspace timezone. Existing schema-version-1 graphs get backward-compatible defaults when parsed. This milestone does not add scheduled flow triggers, recurring campaigns, or approved-template follow-ups.

## Interactive replies (mock provider)

Reply Buttons offers 1–3 options; Interactive List offers a flat list of 1–10 options. Both currently use titles of at most 20 characters, stable unique option IDs and one connected `option:<id>` branch per option. A valid variable name is required. Selection saves the option ID, records it in execution logs, and follows that option's branch. These nodes share Ask's persisted answer deadline and takeover behavior.

Outgoing messages store a validated `interactive` payload. Incoming events/messages store an optional `reply` containing `messageId` and `optionId`. The engine requires a sent/delivered/read prompt belonging to the same tenant, conversation, execution and current node/step. Plain text, unknown option IDs and foreign prompt IDs cannot select a branch. A stale menu reply cannot answer a later text question or trigger a new session. Duplicate external event IDs retain their original payload; conflicting reuse returns 409.

The simulator's buttons call the same inbound API/worker as production execution; old prompt controls are disabled. The inbox displays the outgoing choices. This is a working local mock path, not live Meta delivery. List sections, descriptions, headers/footers, media and agent-authored interactive messages are not implemented yet. Live Meta context IDs must be mapped from provider IDs to stored messages when that adapter is implemented.

Access expiry/inactivity is checked at engine entry. Active executions are cancelled with a reason and cleared deadlines; they are not automatically resurrected by later plan renewal. The outbound worker independently rejects already queued messages if access is inactive. Existing inbound/STOP records still persist. See ENTITLEMENTS.md.
