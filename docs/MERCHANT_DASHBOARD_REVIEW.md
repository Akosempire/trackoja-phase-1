# Merchant dashboard and navigation review

Implemented in the existing WAYA components and tokens. No new database migration is required for these interface changes; the existing tailoring summary RPC must be deployed to show job metrics.

## Shared changes

- Centered operational content, sans-serif Overview heading, compact mobile two-column metrics, odd final metric spanning the row, and consistent panel borders.
- Category/module/permission-aware navigation shared by sidebar, drawer, bottom bar and More. Overview and More anchor the mobile bar. Restaurant creates an order, tailor opens the job form, retail scans checkout or stock depending on context. Existing camera/manual-entry scanner remains in use.
- Grouped operations, management, payments/connections and account links. Subscription is separate from customer payments. Appearance, conditional installation and logout with toast errors live in Account.
- Stock alerts separate positive low quantities, zero stock and negative discrepancies, preserve fractional units and precede activity.
- Branch-scoped business activity filters audit resource types before limiting the query, deduplicates only identical IDs, links supported records and retains all original audit/security records. Amounts appear only when provided by the event.
- Tailoring summary shows real deadlines, fittings, collection status and balances. Completed sales are no longer mislabelled as job payments.

## Category adaptation

| Category | Existing configuration retained and applied across navigation/dashboard |
| --- | --- |
| Restaurant | New order, orders/preparation/menu, live queue statuses and menu availability. |
| Tailor | New job form, clients/materials, job deadlines, fittings and outstanding balances. |
| Fashion | Sales, products/variants, stock and actual refund count; size/colour fields retained. |
| Fabric | Fabric/roll terminology and fractional configured units. |
| Supermarket | POS/scanning, completed sales, stock and product expiry information. |
| Pharmacy | Medicines, expiry screen, strength/pack/batch fields where supported. |
| Electronics | Device inventory terminology and configured serial/IMEI fields. |
| Beauty | Product/shade terminology and existing expiry/variant fields. |
| Building materials | Materials and configured bag/length/tonne units; supported sales action. |
| Stationery | Item/pack/carton terminology and stock attention. |
| General retail | POS, sales history, products, stock and customers. |
| Other | Enabled sales/inventory/tailoring activities determine action, metrics and navigation. |

## Explicit limits

Unimplemented suppliers/purchasing, quotations/delivery orchestration, standalone fittings/measurements pages, warranty workflows, remnants and bulk-order fulfilment remain hidden rather than becoming dead links. Measurements/fittings available inside Jobs remain there. Expiry dashboard counts use existing product attributes, not an invented batch aggregation. The activity feed only shows events the backend actually records and the signed-in role can read; missing actor names use Team member. Customer-payment/delivery events cannot be fabricated when their backend does not emit an audit event.

Browser checks use isolated data fixtures and actual application components. They do not prove live production migrations, payment-provider integrations or physical camera hardware. Existing server/RLS permission enforcement is unchanged. The earlier onboarding billing-availability SQL rollout remains a separate deployment requirement if it has not been applied.

## Verification

- 100 Playwright checks passed: Edge at 320/375/390/430/768/1024/1440 in light/dark with empty/populated owner dashboards; all 12 mobile category navigation and More flows in Edge, Firefox and WebKit. Seven targeted browser checks passed again after the final compact-card/text fixes.
- Unit coverage includes all 12 categories with permitted/restricted roles, disabled modules, business-event deduplication, stock states and fractional/plural quantities, period changes, failed sources and stale branch-response rejection.
- Full Vitest regression suite: 653 tests passed across 46 files. Navigation assertions now reflect the requested persistent More destination and clear drawer close control.
- TypeScript/Vite/PWA production build; fixture screenshots saved with this review. Live customer data and production rollout were not verified.

## Reference adaptation correction - 1 October 2026

The reference informs the two-column hierarchy, with a primary revenue panel and supporting actions/activity, followed by compact overview cards. TrackOja keeps its own merchant workflows and a separate platform subscription overview.

- Removed the copied wallet, withdrawal, USD toggle, fake notifications, decorative charts and inactive customization/date buttons.
- Merchant sidebar, page surfaces and shared revenue panels use existing WAYA semantic colours, spacing, typography, radii and content-width tokens. No new colours or colour tokens were introduced. Both appearance themes remain supported.
- Revenue uses actual selected-period totals and payment-method amounts. Four period options update the request and date label. Loading and request failures never display fabricated zero totals. Platform revenue uses the same component with subscription/plan semantics.
- Merchant overview explicitly separates today's sales revenue, transactions and average sale from current stock and customer records. Sales revenue is not a wallet balance or separate gross/net volumes; the customer count is not new customers.
- Quick actions follow the configured business category, enabled modules and role permissions. Recent activity uses the existing permitted audit feed. Empty tracked stock offers an add-item action only to users allowed to create products.
- Removed duplicate no-sales attention text. Failed checks cannot produce an unqualified all-clear message.

Validation for this correction: 60 targeted unit checks (including all 12 categories with permitted/restricted roles), 64 fixture-based browser checks across Edge, Firefox and WebKit, plus a final merchant layout recheck after spacing/empty-state adjustments. TypeScript/Vite/PWA production build checked. Browser checks exercise real components with fixture services; live customer sessions and hosting deployment are not verified by these tests.
