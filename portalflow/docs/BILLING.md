# Billing and access status

Manual administrator grants and bounded trials now enforce contact, chatbot and team capacity. See ENTITLEMENTS.md for exact semantics, snapshot revisions, expiry, reserved invitation seats and blocked-inbound retry. Admin assignment is explicitly MANUAL, not proof of payment. No invoice is marked paid by this feature.

Razorpay/mock payment providers, checkout, payment-backed subscriptions, renewals, invoices, message/number/feature quotas and the Meta cost estimator remain unimplemented. Catalogue prices are stored in integer INR paise and snapshotted on assignment, but no charge is collected. Future verified provider events must integrate with this existing entitlement layer instead of adding a bypass.

The supplied India planning rates/effective date are not independently verified official tariffs. Future pricing tables must support effective dates/allowances and idempotent delivered-event estimates. Meta billing is authoritative. Payment state must change only through verified events, never frontend redirects.
