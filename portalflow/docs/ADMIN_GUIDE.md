# Administration without editing code

The `/admin` page is for the SaaS platform operator. Ordinary business owners use `/dashboard`; they cannot access platform administration APIs. Hiding the menu is not the security boundary: the server checks platformAdmin from the authenticated database user on every admin request.

## Sign in

In local development, run the documented seed and use admin@portalflow.example with SEED_PASSWORD (the example is LocalPortalFlow!2026). The account belongs to the separate PortalFlow Operations workspace. The two customer demo businesses remain separate.

In production, do not run the development seed. A server operator registers and verifies their own account, then runs `pnpm admin:grant -- owner@example.com` from the repository root with the intended database environment. This grants a pre-existing verified account access and writes an audit event. It does not create an account or reveal its password. Keep server/CLI access restricted. There is no public administrator self-promotion endpoint.

## Overview

View database counts for businesses, suspended businesses, users, contacts, messages, published flows and pending/failed work. These are stored totals, not invented revenue or worker uptime. The current panel does not prove a worker process is healthy.

## Businesses

Search by business name, page through results, and see membership/contact/conversation totals. Enter a reason, then Suspend or Reactivate. Confirm the browser dialog. Suspension revokes current workspace sessions and blocks tenant access and worker processing. Reactivation allows users to sign in again; it does not revive revoked sessions. Workspaces containing a platform administrator cannot be suspended through this action, preventing operator lockout. Both actions are audited. Suspension is not data deletion.

## Users

Search registered users by name/email. View their names, emails and whether they are platform administrators. Password hashes, tokens, private message contents and integration secrets are not returned by this directory. Editing users, impersonation and admin-role management through the UI are not implemented.

## Plans

Create/edit a plan's name, monthly/yearly INR prices, proposed WhatsApp-number/team/contact/bot limits, and archived flag. Prices are stored in integer paise; the form shows rupees. Stale concurrent edits return an error instead of silently overwriting another administrator.

**Saving a price never invoices or charges anyone.** In Businesses → Manage plan access, choose a plan, status, expiry and reason to create a manual access grant. Contact/chatbot/team limits are enforced; pending invitations reserve member seats. The grant snapshots a plan revision, so catalogue edits do not silently change existing grants. Reassign explicitly to apply changes. Over-capacity downgrades are rejected. Archiving blocks new active grants but leaves existing snapshots intact. See ENTITLEMENTS.md.

## Configuration

Change product name, primary colour and support email. The navigation/public header/login labels use the configured name, the primary blue accent uses the configured colour, and workspace navigation exposes a support mail link after replacing the example address. Email sender, legal policies, page metadata and every marketing sentence are not dynamically rebranded. Choose colours with readable contrast. Fields cannot contain arbitrary CSS or secrets. Concurrent edits use revision checks.

## Audit logs

Search platform actions and review when they occurred, their actor/resource IDs, and saved details. This view is append-only through the API. Tenant activity logs remain separately tenant-scoped. Log retention/export UI is still pending.

## For business users: new chatbot steps (plain language)

Open **Chatbot Builder**, open a flow, and click a step in the left list to add it. Then click the step on the canvas to change it on the right.

- **Send image / Send document** — paste a web link that starts with `https://` (for example a brochure stored on your website or Google Drive's public download link) and an optional caption. For documents you can type the file name the customer sees. You cannot upload files from your computer yet. A red message under "Flow validation" tells you if the link is not allowed.
- **Save user input** — quietly waits for the customer's next message and remembers it under the name you type in "Variable" (for example `feedback`). You can show it later by writing `{{feedback}}` in a message.
- **Keyword match** — checks what the customer wrote. Type words separated by commas (for example `price, rate, cost`). Connect the green "match" dot to the step for those words and the red "no match" dot to the other path. Leave "Check variable" as `trigger_text` to check the customer's first message.
- **Assign agent** — choose a teammate; the conversation appears as assigned to them in the Inbox. The bot keeps going; add **Human handoff** if a person should take over.

In the **Inbox**, you can paste an `https://` link under the reply box and pick Document or Image to send a file link with your reply. Everything is still sent through the practice (mock) WhatsApp connection, not to real phones.

## Not available yet

Real WhatsApp connections/onboarding, broadcasts/campaigns, Meta template approval, invoices/payments, payment-backed subscriptions and remaining quotas, messaging pricing administration, full job/connection health, AI settings, integration secrets, domain management, data-export/deletion controls and a full content-management system. They must be implemented before advertising them as working. See CAPABILITY_MATRIX.md.
