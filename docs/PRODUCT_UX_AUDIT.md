# TrackOja product UX audit and phased refactor

Source brief: `80e8b360-60cf-4519-9b17-215b6d220f02/Pasted text.txt`.
Audit date: 30 September 2026. The route inventory, business experience model, role gates, shared components and rendered-state patterns were inspected before this phase's changes. Live customer sessions have not been inspected.

## Design authority

The archive `play around (2).zip` supplies component anatomy, spacing, density, borders and overlay patterns. Its product tokens were reread from the ZIP. The approved TrackOja adaptation in `DESIGN_SYSTEM_AUDIT.md` and `src/styles/tokens.css` supplies the current blue accent, Inter interface font and Forum display font. The older `WAYA_DESIGN_SYSTEM.md` claimed Geist/Playfair and unconstrained desktop width; that is stale documentation, not a second theme to implement.

Canonical sources: `tokens.css` (values), `waya.css` (surface mapping), `waya-components.css` (shared structures), `form-controls.css` (fields), `mobile.css` (touch/input overrides), `bottom-nav.css` (mobile navigation). Preserve visible card borders requested by the user. No new component library is needed.

## Reusable rules

1. One primary workflow action per view. Empty states explain the absence without repeating a visible header CTA. Mutation feedback uses the existing toast API; field and loading errors stay beside their source.
2. Content widths are explicit and stable across loading, error, empty and populated states: form 760px, ordinary page 1120px, genuinely wide workspace 1440px. Module navigation must not change width merely because a table mounts.
3. Related buttons share a size and baseline. Fields keep labels above them and errors/hints below. On mobile stack form actions deliberately. Controls use existing radius and spacing tokens; desktop buttons 38px, compact 32px, mobile targets at least 44px.
4. Search uses `SearchInput`; tables use `DataTable` with labelled mobile rows or a keyboard-scrollable region. Pagination reports only counts actually known. Loading never displays fabricated zeros.
5. Radio-style choices use `SegmentedControl` with arrow-key support. Navigation links remain links; actions remain buttons. Modals/drawers use existing native-dialog primitives with focus containment and restoration.
6. Permission-filtered navigation has no duplicate destinations. Scan stays in the centre slot even when a role sees fewer links. Payments remains discoverable for users with sales viewing access; the drawer contains the complete menu.
7. Normal workflows use business language. Technical constraints belong in collapsed contextual help or operator documentation. Unavailable capabilities must not be presented as working tools.
8. Terminology: **Record sale** for retail checkout, **New order** for restaurant checkout, **New job** for tailoring work, **Add product** (or the category-specific item name), **Import products**, **Payments** for merchant collections, **Billing** for the TrackOja subscription. Preserve business-specific distinctions.

## Audit matrix

| Surface / routes | Finding | Severity | Decision / phase |
|---|---|---|---|
| Shared shell, headers, form controls | Automatic table-dependent width; repeated control markup; conflicting documentation | High | REFINE ? 1 |
| Shared tables, pagination, states | Unknown totals represented as full pages; loading/scroll semantics incomplete | Medium | REFINE ? 1 |
| Merchant bottom navigation / drawer | Restricted roles shift Scan; duplicate menu fallback; cart badge also labels history | High | REFINE ? 1 |
| Platform overview `/platform` | Shared metric/panel structure already present; preserve borders and data states | Low | KEEP; verify ? 2 |
| Businesses/users `/platform/businesses` | Existing directory/table is sound; reduce secondary explanatory copy | Low | REFINE ? 2 |
| Business detail `/platform/businesses/:id` | Sound detail structure; long capability copy competes with records | Medium | REFINE ? 2 |
| Billing overview/plans/subscriptions/payments | Four primary sections now exist; remaining documentation panels and secondary sections duplicate other modules | High | REDESIGN / MERGE ? 2 |
| Activation `/platform/activation` | Real issuance/revocation flow; supporting reference tables dominate | Medium | REFINE; contextual entry from billing ? 2 |
| Audit `/platform/audit` | Operational table exists; verbose filters/help and unsupported-state copy | Medium | REFINE ? 2 |
| Developer `/platform/developer` | Grant/session distinction corrected; large diagnostics/reference layout still needs task grouping | High | REDESIGN ? 2 |
| Integrations `/platform/integrations` | Real Moniepoint health, honest billing availability; reference table can be simpler | Medium | REFINE ? 2 |
| Support `/platform/support` | Business notes work; ticket/triage specification dominates | High | REMOVE unsupported specification panels / REFINE notes ? 2 |
| Health/settings `/platform/health`, `/platform/settings` | Operational records mixed with long implementation commentary | Medium | REFINE using disclosure ? 2 |
| Overview `/dashboard` | Primary action repeated in empty state; action relevance varies by business | High | REFINE ? 3 |
| Checkout `/sales/checkout` | Preserve fast cart/payment task; search and optional inputs drift | Medium | REFINE ? 3 |
| Sales `/sales`, `/sales/history`, `/sales/:id` | Overlapping CTA labels and repeated shortcuts; receipt detail remains useful | Medium | REFINE ? 3 |
| Payments `/payments`, transaction and reconciliation detail | Canonical table introduced; filters/details and empty/error states need final consistency check | Medium | REFINE ? 3 |
| Products/create/edit/import | Primary/import alignment fixed; import preview and local inline spacing remain | Medium | REFINE ? 4 |
| Categories/stock adjustment/stock lots | Separate tasks justified; detail spacing and action alignment drift | Medium | REFINE ? 4 |
| Customers/list/create/edit/detail | Search fixed; details/history need consistent section hierarchy | Medium | REFINE ? 4 |
| Expenses `/expenses` | Period summaries and operational list already use shared patterns | Low | KEEP; verify ? 4 |
| Jobs `/jobs`, kitchen `/kitchen`, expiry `/pharmacy/expiry` | Preserve distinct workflows; tokenise local geometry and review role-safe actions | Medium | REFINE ? 4 |
| Reports `/reports` | Period-aware metrics and distinct stock snapshot already implemented | Low | KEEP; verify ? 4 |
| Staff `/staff`, devices/list/detail | Existing workflows; local spacing and long identifiers need containment | Medium | REFINE ? 4 |
| Merchant settings/billing/Moniepoint | Field consistency, narrow forms, safe errors, progressive disclosure | Medium | REFINE ? 4 |
| More/support/workspace selection | Keep compatibility routes; drawer should replace redundant menu shortcut | Low | REFINE ? 3/4 |
| Auth/onboarding/welcome/landing | Existing shared fields and trial flow; preserve routing and validation | Low | KEEP; verify ? 5 |
| Suppliers/purchases/accounting/branches | No separate active routes for these modules; branch selection exists in shell | Product decision | Do not invent workflows or advertise unsupported destinations |
| Privacy/terms | Current routes are placeholders | Product decision | Owner-supplied legal content needed; no invented policies |

## Role and business coverage

Use all 12 entries of `BUSINESS_CATEGORIES` with `getBusinessExperience`, not one retail template. Restaurant orders/kitchen, tailor jobs and pharmacy expiry remain distinct. Verify owner/manager/cashier/stock-focused/read-only permission subsets and no-permission/loading states. Platform visibility continues to use `canSeeArea` and server-backed grants. This refactor does not change database permissions, financial calculations or paid entitlements.

## Phase status and acceptance

1. Foundation: COMPLETE. Shared width, field-row geometry, search adoption, navigation slots, pagination honesty, field constraints and data-state accessibility fixed and tested.
2. Platform owner: remaining structure/copy and billing consolidation pending.
3. Merchant foundation: duplicate actions, terminology and navigation verification pending.
4. Operations: remaining field/spacing and detail consistency pending.
5. Mobile: exercise 320, 375, 390, 430, 768, 1024, 1280 and 1440px in both themes. Render actual shared React components for foundation interaction checks; distinguish these from authenticated route tests.
6. Final consistency: review side-by-side and document removed/merged/redesigned/refined components and remaining product decisions.

A phase is complete only after its implementation and relevant checks pass. This file does not claim that all routes or real payment flows have been verified in production.

## Phase 1 delivery

- Removed table-presence width switching, the duplicate mobile More fallback, misleading unknown-total row ranges and cart badges on sales history links.
- Consolidated remaining platform-directory and checkout search fields on `SearchInput`; retained existing canonical metric, button, dialog, drawer and table components.
- Refined shared field rows: removed inherited search bottom margins inside groups and reset horizontal flex basis when stacking on mobile. Fixed Scan's inherited fixed height, reserved centre column and preserved readable navigation labels.
- Platform widths are chosen by route, including every billing tab. Settings and developer screens remain focused even when they contain a small table.
- Table loading is announced; table scroll regions are keyboard-focusable and named; error states announce their message. FormField accepts native constraints without bypassing its existing label/error associations.
- Verified 578 unit tests, including 12 business categories across four permission sets, loading permissions, truthful pagination and shared table semantics. Production TypeScript/Vite build and lint passed.
- Browser verification: 33 existing layout checks passed, plus 17 checks of actual React components at every requested width in both themes. The initial component checks found and drove fixes for the 12px search/action misalignment. Checks cover overflow, stable widths across four data states, mobile Scan geometry, radio keyboard navigation, dialog/drawer Escape and focus restoration, and retry recovery. Screenshots were visually reviewed.
- Verification uses isolated data and permission fixtures. It does not certify every authenticated production route. Platform restructuring remains Phase 2; the complete product audit is not yet marked finished.
