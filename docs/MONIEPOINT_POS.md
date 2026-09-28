# Moniepoint POS merchant payments

This integration takes **customer money for a merchant**. TrackOja subscription billing remains on its existing Paystack path. The Moniepoint Push API is used only from Supabase Edge Functions; browser code never receives the merchant's credential.

The existing OPay device flow is still separate. Its missing-secret mock response and unsigned-webhook fallback have been removed; because its endpoint is a sandbox URL, initiation and webhook settlement are restricted to sandbox businesses until a verified live integration is designed.

## Provider prerequisites

Each merchant needs a Moniepoint account, ERP integration enabled for its terminal, and terminal app version 1.7.2 or newer. Moniepoint documents API-key and client-ID/client-secret variants. The API-key guide documents a live endpoint only; client credentials document live and development endpoints. The API-key variant cannot be marked “connected” by a standalone test because no such test endpoint is documented. It stays “configured” until a real terminal transaction is verified.

- [Push Payment Request API Reference](https://teamapt.atlassian.net/wiki/spaces/EI/pages/1039826999/Push+Payment+Request+API+Reference)
- [API-key variant](https://teamapt.atlassian.net/wiki/spaces/EI/pages/2100625533/Push+Payment+Request+API+Key)

Before enabling a live merchant, confirm with Moniepoint support **the integer `amount` unit** for the Push API and **which `responseCode` values mean an approved `PROCESSED` payment**. The public Push reference does not specify either. Do not infer these from the separate webhook or serial-port docs. If these are unknown, TrackOja deliberately refuses new POS requests or leaves processed transactions unresolved. It never finalizes stock, revenue, loyalty, or receipts from an unconfirmed code.

## Deployment

Apply migrations `20260928000100_merchant_pos_foundation.sql`, `20260928000101_merchant_pos_functions.sql`, and `20260928000102_platform_moniepoint_health.sql` in order, then deploy Edge Functions `merchant-moniepoint` and `merchant-pos-reconcile` with JWT verification enabled on the user-facing function. Set these **server-side secrets**:

| Secret | Purpose |
| --- | --- |
| `MONIEPOINT_CREDENTIAL_ENCRYPTION_KEY` | Base64-encoded 32 random bytes for AES-GCM credential encryption. Back up securely; loss makes stored credentials unreadable. |
| `MONIEPOINT_AMOUNT_UNIT` | Exact provider-confirmed `naira` or `kobo`. |
| `MONIEPOINT_APPROVED_CODES` | Comma-separated provider-confirmed approved `responseCode` values. |
| `MONIEPOINT_DECLINED_CODES` | Optional comma-separated provider-confirmed declined codes. Other processed codes remain unresolved. |
| `MONIEPOINT_RECONCILE_TOKEN` | Random high-entropy bearer token for the trusted scheduler. |

Supabase also supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the functions. Never put any of these secrets in Vite variables, database settings exposed to clients, logs, or source control. Configure a trusted scheduler to `POST` the `merchant-pos-reconcile` function with `Authorization: Bearer <MONIEPOINT_RECONCILE_TOKEN>` every few minutes. The job checks at most 50 pending/unknown attempts per run and never resends a push request.

The live UI is under **Settings → Moniepoint POS**. The business owner saves the merchant's own credentials and confirms ERP enablement; terminals are existing `devices` records with type `payment_terminal`, provider `moniepoint`, and a serial number. A terminal must be active and in the current branch. Optional checkout registers and a branch default can be assigned on that screen. A credential-only test leaves the connection **configured**; it is shown as **connected** and the terminal marked verified only after an approved payment on that terminal.

## Safety and current limits

- Checkout prepares a `pending_payment` sale without stock movement, sale payment, journal entry, or receipt. It creates a unique attempt and sends once. Only provider status verification can complete the sale. An ambiguous send is `unresolved`; a later status lookup or the scheduler reconciles it. Multiple attempts may belong to a sale, but only one may be active.
- Sale preparation and payment initiation both require the business's active TrackOja product entitlement. Reconciliation can still complete a payment already taken if that entitlement later expires.
- The server checks merchant reference, terminal serial snapshot, requested amount, actual amount, provider reference, processing status, and configured approval code before finalization. Sale payment, stock movement, lot allocation, loyalty, sale status, and merchant journal post in one database transaction. A failure becomes `reconciliation_required` rather than an unpaid result.
- Each attempt is tied to organization, branch, sale, terminal, register, cashier, and a request key. Cashiers see their own attempts; users with review permissions can see branch attempts. Credentials are stored encrypted in a service-role-only table.
- A merchant-provider registry declares supported operations. Moniepoint supports push and status lookup in this integration; cancel and provider refund remain unavailable. Cash and manual transfer continue through the existing `sale_payments` flow.
- A service-role-only provider-event table records operation outcome and latency without request bodies or secrets. Platform integration diagnostics aggregate connections, active terminals, today's live outcomes, pending/reconciliation counts, and 24-hour provider availability.
- Sandbox transactions are allowed only for sandbox organizations and are excluded from platform subscription revenue. The API-key sandbox endpoint is unavailable in the published guide, so sandbox testing uses documented client credentials.
- The Push API does not document a cancellation or refund call. TrackOja does not show a fake cancel/refund action. A paid Moniepoint sale cannot be locally refunded or voided until an externally confirmed, auditable manual-refund process is designed.
- Split payments, tailoring-job deposits, and automatic invoice settlement are **not active** in this release. The repository has TrackOja platform billing invoices, but no merchant-customer invoice ledger; those billing invoices must not be reused for customer money. The attempt model permits more than one attempt per sale, but checkout currently requires a full sale amount. These flows need their own authorised merchant invoice/job state transitions before acceptance.

## Verification before live use

Run the frontend build, lint, provider contract tests, and migration parse checks. Then apply migrations to a non-production Supabase project and test: owner connection, cashier branch isolation, duplicate click/retry, HTTP 202 pending, approved status, declined status, cancelled status, unknown status/network loss, amount mismatch, late success, stock shortage at settlement, repeated status checks, receipt, reports, and sandbox exclusion. Do a terminal test with Moniepoint-provided credentials and ERP-enabled hardware before enabling a real merchant, and verify the configured account and terminal settle to that merchant. The local workspace has no Moniepoint credentials or terminal, so this final provider test cannot be simulated honestly.
