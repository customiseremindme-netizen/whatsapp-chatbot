# WhatsApp integration status

Mock text messaging is implemented. No Meta requests are made, and no WhatsApp credentials are needed for accounts, contacts, inbox simulation or mock replies. The authenticated mock inbound endpoint and dedicated worker persist actual database records; delivery statuses are explicitly simulated. Live Meta integration remains Phase 4.

Before the live phase, obtain an authorized Meta business app and test number, WhatsApp Business Account ID, Phone Number ID, app secret, appropriate access token and a supported Graph API version. Configure a public HTTPS callback and a verification token. These environment variables and endpoints will be added with tested provider code; setting them today does not connect a number.

The implementation must use only official Meta Cloud API, verify raw-body webhook signatures, deduplicate events, enforce consent and the customer-service window, encrypt credentials, and report exact onboarding failures. Embedded Signup requires actual permission approval. No QR scraping or WhatsApp Web automation will be used.
