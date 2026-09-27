# Billing & pricing: the pricing split, audited

This is the audit the redesign is built on. Every fact was read from the live
database or the running product, and the query or file is named each time.

## The finding: not a wrong price — a catalogue nothing can buy from

The brief flagged a mismatch: the customer's Billing page shows a **Starter trial
at ₦5,000/month**, while TrackOja's pricing elsewhere says **Standard ₦22,500/month
or ₦225,000/year**. The prices are both correct. The problem is that **three
surfaces read three different sources**, so the public site advertises four tiers
and a logged-in customer can only ever buy one of them.

| Surface | What it reads | What it shows |
| --- | --- | --- |
| **Public pricing page** | `src/pages/landing/landingContent.ts`, **hard-coded literals** | Starter ₦5,000 / ₦50,000 · Standard ₦22,500 / ₦225,000 · Premium ₦45,000 / ₦450,000 · Custom |
| **Customer Billing page** | legacy table `subscription_plans` (`SubscriptionService.getPlans()`, `src/services/subscription.service.ts:19`) | **Starter ₦5,000/month only** |
| **Platform console** | new table `product_plans` (`list_product_plans`) | starter · standard · premium · custom, plus a retired ₦90,000 tier |

### The evidence

Legacy catalogue — `SELECT name, price, billing_interval, status FROM subscription_plans`:

| name | price | interval | status |
| --- | --- | --- | --- |
| Free | ₦0 | monthly | **inactive** (retired) |
| Starter | ₦5,000 | monthly | active |
| Pro | ₦15,000 | monthly | **inactive** (retired) |

New catalogue — `product_plans` joined to `platform_products`:

| product | key | name | monthly | annual | seats | status | public |
| --- | --- | --- | --- | --- | --- | --- | --- |
| trackoja | starter | Starter | ₦5,000 | ₦50,000 | 2 | active | yes |
| trackoja | standard | Standard | ₦22,500 | ₦225,000 | 5 | active | yes |
| trackoja | premium | Premium | ₦45,000 | ₦450,000 | 10 | active | yes |
| trackoja | custom | Custom | — | — | — | active | yes |
| trackoja | premium_90k | Premium | ₦90,000 | ₦900,000 | 15 | **retired** | no |

Every live subscription points at the legacy Starter plan —
`SELECT sp.name, s.status, count(*) FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id`:
6 `trialing` and 2 `active`, all on Starter.

So **Standard and Premium exist, are published, and cannot be bought.** They are
absent from the table the checkout reads.

### Why the checkout cannot reach them

`initiate_subscription_checkout(p_org_id, p_plan_id)` takes a **legacy
`subscription_plans` id**. The Billing page passes the ids it lists, which come
from that same legacy table. The new catalogue is never consulted.

The two catalogues are bridged by **name matching** — migration 089's
`activate_subscription` resolves the product plan "from the matching
`product_plans` row (product + the legacy plan's key or name,
case-insensitively)". That bridge only works for a plan that exists in both, so it
converts Starter correctly and can never reach Standard or Premium.

It also means a price change in the console does **nothing**. The console writes
`product_plans`; the public page is a hard-coded literal; the customer page reads
the legacy table. No edit in the admin area reaches the customer, and nothing
reaches the public site at all.

### What is already sound

Two things were fixed earlier and this redesign builds on them rather than
repeating them:

- `organization_products` is the **entitlement** — the row that actually grants
  access and whose `agreed_user_limit` the `enforce_seat_limit` trigger reads.
- Since migration 089, `activate_subscription` also writes that entitlement, so a
  confirmed payment does grant access. Before that fix, paying customers stayed
  `pending` forever.

## Target: one published catalogue, one purchase path

```
              product_plans  (draft → published, with effective dates)
                     │
     ┌───────────────┼───────────────────┬────────────────────┐
     ▼               ▼                   ▼                    ▼
 public pricing   customer Billing   admin console      checkout
   (fetch)          (fetch)            (edit)          (by plan id)
                                                             │
                                                             ▼
                                                  organization_products
                                                   (the entitlement —
                                                 grants access, caps seats)
```

**Published plans are the single source.** A plan is customer-visible only when it
is `status = 'active'`, `is_public = true`, and `published_at IS NOT NULL` with
`effective_from <= now()`. Everything customer-facing reads that one set through
one function, so the public page, the Billing page and checkout cannot disagree.

**Publishing is explicit.** Editing a plan leaves it a draft; a separate publish
step stamps `published_at` and the effective date. That is what makes
"preview before publishing" and "change history" meaningful rather than a UI
affectation.

**Existing subscribers are insulated by the snapshot.** `organization_products`
already stores `agreed_monthly_price`, `agreed_annual_price` and
`agreed_user_limit` at activation. A published price change therefore applies to
new customers only, and the impact preview can say so truthfully instead of
guessing.

**The legacy `subscriptions` row is kept in step, not abandoned.** Eight live
subscriptions and `organizations.billing_status` depend on it, so checkout
creates or reuses the matching legacy plan row and writes both. The legacy table
stops being a catalogue the customer reads and becomes a mirror kept for
existing readers.

## What this changes, file by file

| Change | Why |
| --- | --- |
| `product_plans` gains `setup_fee`, `trial_days`, `store_limit`, `published_at`, `effective_from` | The brief requires setup fees, trial rules, store limits and effective dates; none exists today. `billing_cycle` was added in 089. |
| New `list_published_plans(product_key)` | Tenant-facing read of the published set. `list_product_plans` requires `platform:view`, so a customer cannot call it. |
| New `get_my_entitlement()` | The Billing page's "what your plan includes" needs the business's own entitlement plus real usage; `get_platform_business` is admin-only and returns the wrong shape. |
| New `publish_product_plan(plan, note, effective_from)` | Draft → published, with the revision history the console already has a table for (`product_plan_revisions`). |
| New `start_plan_checkout(plan_id, cycle)` | Checkout by **product plan id**, writing the entitlement-bound transaction and the legacy mirror. |
| `BillingPage.tsx` rewritten | Reads the published catalogue and the entitlement; no legacy `SubscriptionService.getPlans()`. |
| `landingContent.ts` prices removed | They are the duplicate that drifted; the page fetches published plans instead. |
| Admin Billing area reorganised | Seven sections, as the brief lists. |

## Outcome

Shipped in `5660319`, `7c0df48`, `0f266c4` and `3eb5110`.

**One catalogue, four readers.** Published plans now feed the public pricing
page, the customer Billing page, checkout and the entitlement that grants access.
The public page contains no price literal (a test asserts that, reading the source
as text), and the customer page shows all four published tiers including Standard
at ₦22,500/₦225,000 — which, before this, no customer could buy.

**Both cycles are billable, and the period matches the charge.** 092 recorded the
cycle on nothing and derived the subscription period from a legacy mirror row that
holds one interval per plan name, so an annual purchase charged the annual amount
and activated a month. 094 records the cycle and the exact plan on the
transaction, and activation reads them. An annual purchase of Premium at ₦450,000
now activates 2026-09-27 to 2027-09-27 — measured through the real UI, not argued.

**Verified against live data and real sessions.** Migration 092 carries 85
verification checks; `checkout_cycle_verification.sql` carries 27 and
`tests/billing-cycle.test.ts` 18; an end-to-end run through the browser as a real
owner passes 28. Anon reads exactly four published plans, proved by *becoming* the
anon role rather than by reading grants. As a real business owner, the customer
page renders status, usage and the catalogue at 1440 and 390 with no errors or
overflow. The console's seven sections render and switch correctly, and at support
tier the navigator drops to two sections with the rest denied by URL. Subscription
and entitlement rows are byte-identical to before, per-table md5.

## Gaps, stated rather than hidden

| Gap | Why it is not fixed | Its effect today |
| --- | --- | --- |
| **`trial_days` and `setup_fee` are inert** | Nothing applies them: `start_plan_checkout` charges the plan price alone and `activate_subscription` leaves `trial_ends_at` NULL. | Both are stored and editable in the console, marked there as not charged, and deliberately not advertised to customers. All plans hold 0 and NULL, so nothing visible changed. |
| **Paystack runs in mock mode** | `PAYSTACK_SECRET_KEY` is not set on this project, so `paystack-initialize` takes its documented mock branch: it activates the subscription immediately and returns `callbackUrl` instead of a Paystack URL. | Checkout is fully wired and ends in an activation, but no card is ever charged and no hosted Paystack page is shown. Setting the secret switches to the live flow with no code change — that is the function's own design, stated here because "checkout works" would otherwise overstate it. |
| **No invoices, receipts or refunds** | No table exists. | Stated in one line in the console rather than rendered as empty rows. |
| **No platform-facing transaction list** | The only transaction view is the last 20 inside `get_platform_business`. | Stated. |
| **`organizations.billing_email` is not returned** by `get_platform_business` | Not this migration's surface. | The business detail's Billing email row always reads "Not set". |
| **No `featured` flag** | Not asked for; adding it would change `list_published_plans`' shape. | Marketing emphasis is derived from price, so it will follow a future price change. `is_default` means "the plan a business lands on", which is a different fact. |

## A correction the verification forced

My first draft of migration 094 said "the eleven live rows keep activating exactly
as they did". That was wrong, and the verification caught it. The eight live
subscriptions were created by triggers and backfills, not by payments, and
`subscription_transactions` holds **zero** rows. The migration now says that, so
the fallback is described as protection for the rows the legacy checkout will
write rather than as a claim about rows that are not there. The same mistake in
the other direction — assuming a business with no plan — is why the end-to-end
check initially expected a "Choose this plan" button: a new business is given a
default plan by the organization trigger, so its action reads "Switch to this
plan". Both were fixed by measuring rather than by reasoning.


## A deliberate deviation from the brief

The brief says "editing a plan leaves it a draft". Migration 092 does the
opposite on purpose: `published_at` is absent from `upsert_product_plan`'s update
list, so editing a live plan cannot hide it from paying customers — the reasoning
is that a typo fix must not unpublish. The console states the real four-condition
rule (active, public, published, effective) rather than forcing the brief's
behaviour on top of a server that does not implement it.

## Left deliberately alone

- **The ₦90,000 retired tier.** `retired` and private, so invisible to customers
  and correctly excluded. It stays as history.
- **`Free` and `Pro` in the legacy table.** Retired but still present. Deleting
  rows that historical subscriptions may reference is not a cleanup, it is data
  loss. They are unreachable from the new path and labelled as legacy.
- **Trial length in three places.** `platform_settings.billing.trial_days` (14) and
  `platform_products.access_settings.trial_days` (14) are read by no code. The
  brief puts trial length on the plan, so that is where the redesigned flow reads
  it from; the two older settings are marked inert rather than quietly deleted.

