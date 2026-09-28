# TrackOja commercial lifecycle rebuild

## Audit result

The existing product catalogue, Paystack Edge Functions, platform permissions, multi-product entitlements, and audit infrastructure were retained. The unsafe path was the gap between those pieces: onboarding granted a hard-coded trial, checkout selected a mutable plan row, activation did not identify an immutable commercial version, customer routes trusted tenant selection, and invoices or receipts did not exist.

## Implemented

- Resumable server-owned onboarding states from account creation through verified payment.
- Idempotent business and first-store creation with a required billing contact.
- Immutable monthly and annual plan versions with prices and setup fees stored in minor units.
- Authoritative checkout preview and pending payment creation from one plan-version ID.
- Paystack initialization from the recorded backend amount. The client cannot submit an amount.
- Fail-closed settlement matching reference, business, mode, environment, currency, exact minor-unit amount, and plan version before activation.
- Server-backed product access checks on protected merchant routes.
- One-off setup fee support in catalogue management, preview, payment, invoice, and receipt records.
- Customer billing contact editing, payment history, invoices, and receipts.
- Platform transaction visibility with status, immutable version, environment, failure reason, invoice, receipt, and unmistakable test labels.
- Test records remain separate from production revenue. Mock settlement remains restricted by server environment policy.
- Success and failure feedback uses the shared toast system.

## Commercial decisions

- Trials are unsupported for the rebuilt checkout. The UI does not promise a trial and tenant creation grants no temporary product access. A future trial policy needs eligibility, duration, conversion, expiry, and abuse rules before `trial_enabled` can be introduced.
- Setup fees are operational and configurable per plan. They are charged once on the initial checkout and snapshotted in the purchased plan version.
- TrackOja Works remains a separate configurable product. No TrackOja price, feature, plan version, or entitlement is copied to it. Its launch catalogue, prices, limits, implementation policy, and onboarding rules still need product approval.

## Deployment

Apply migrations through `20260928000096_commercial_lifecycle.sql`, deploy `paystack-initialize`, `paystack-verify`, and `paystack-webhook` together, and configure matching application/payment environments and server-only Paystack keys. Run a test-mode checkout and signed webhook before enabling live checkout. Existing subscriptions keep their recorded agreed prices; new purchases use immutable versions.

## Verification

The production TypeScript/Vite build passes. `tests/commercial-lifecycle.test.ts` guards immutable prices, server-owned amounts, exact settlement matching, server entitlement enforcement, resumable onboarding, billing documents, and test-record separation.
