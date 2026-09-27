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

## Open questions I am not deciding alone

1. **The ₦90,000 retired tier.** It is `retired` and private, so it is invisible to
   customers and correctly excluded. It stays as history.
2. **`Free` and `Pro` in the legacy table** are retired but still present. They are
   left untouched: deleting rows that historical subscriptions may reference is
   not a cleanup, it is data loss.
3. **Trial length** currently lives in two places — `platform_settings.billing.trial_days`
   (14) and `platform_products.access_settings.trial_days` (14) — and neither is
   read by any code. The redesigned flow reads trial days from the **plan**, which
   is where the brief puts it, and the two older settings are marked inert.
