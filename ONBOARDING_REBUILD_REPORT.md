# TrackOja onboarding review and rebuild

## Current problems found

- Protected routes treated missing active commercial access as first-time onboarding. Existing owners with expired billing, invited staff, and older accounts without the new onboarding row could therefore see business creation again.
- Authentication, invitation acceptance, profile loading, and entitlement loading happened in separate asynchronous paths. Routing could decide before the full account relationship was known.
- A missing `current_org_id` was treated as no business, even when organization membership already existed.
- Login, signup, callback, protected routes, and the onboarding route each made their own destination assumptions.
- Signup collected a business category before the account existed and held it only in session storage.
- A pending payment resumed at plan selection rather than a recoverable payment state.
- Invited staff with a billing problem could see owner plan controls.

## Existing-user logic

`resolve_my_trackoja_entry()` is now the server-owned decision point. It evaluates platform-admin status, business ownership, organization membership, current workspace validity, accepted invitations, canonical product entitlement, legacy subscription state, legacy organization billing state, and onboarding progress. Existing relationships without access are classified as billing or access problems and never as new-user onboarding.

Existing users who predate `onboarding_progress` are recognized from their business relationship and access records. A stale `account_ready` row cannot force them into onboarding because resumable onboarding is accepted only when its recorded organization matches their current business.

## New-user flow

Account creation → concise welcome → business category → business and first store → authoritative plan catalogue → server billing preview → Paystack → verification → concise completion → TrackOja.

Account creation no longer asks business questions before authentication. Category selection is persisted on the server before the business form opens.

## Invited-user flow

Pending invitations are accepted before entry resolution. The resolver then detects the organization and store membership, selects a valid workspace when unambiguous, and sends an invited user with active business access directly to TrackOja. Invited staff never enter business creation or owner checkout. If business access is unavailable, Billing explains that the owner must restore it.

## Resume logic

Business category, organization, store, selected plan version, onboarding state, and checkout reference are server records. Refresh, logout, browser closure, and payment interruption resume from the latest meaningful state. A pending checkout returns to payment verification with “Check payment status” and “Return to plans” actions; it does not recreate the business.

## Billing handoff

Plan data and checkout preview come from immutable published plan versions. The pending transaction exists before Paystack opens. Successful server verification activates access; failure retains the business and onboarding record. Existing customers needing commercial attention go to Billing rather than Welcome or Create business.

## Routing

`AuthContext` resolves authentication, invitations, profile, relationship, workspace, onboarding, and access before rendering a destination. Route guards consume this single result:

- platform admin → `/platform`
- new or genuinely incomplete owner → `/onboarding`
- multiple businesses without a valid selection → `/workspace`
- existing/invited user with active access → `/dashboard`
- existing owner requiring payment → `/billing`
- invited user whose business lacks access → `/billing` with owner-only guidance

Direct onboarding access by an existing user redirects to their proper destination. Protected routes cannot flash onboarding while resolution is loading.

## UX changes

- Removed category selection from signup.
- Added concise welcome and completion states.
- Added server-persisted category selection.
- Added payment-pending recovery.
- Added multi-business workspace selection.
- Hid subscription purchase controls from invited staff.
- Added a blocking retry state when account resolution fails.
- Preserved Waya typography, controls, feedback, loading, responsive layout, and toast behavior.

## Tests

Static lifecycle tests cover existing ownership, membership, invited users, legacy subscription and billing evidence, delayed routing, billing-action routing, workspace selection, server-persisted category, pending payment recovery, and completion. TypeScript, the complete Vitest suite, and the production build are the release checks.

## Remaining blocker

Migration `20260928000098_onboarding_entry_resolution.sql` must be applied before deploying the frontend. Live invitation and Paystack journeys require the connected Supabase project and payment test credentials; repository tests cannot complete those external gateway operations.
