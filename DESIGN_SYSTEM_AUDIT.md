# TrackOja product UI system

This inventory records the system extracted from `play around (2).zip` and the decisions used to apply it to TrackOja. It is the implementation reference for future product screens.

## Audited reference

The archive contains a React/Vite UI package, a typed command-search component with stories and tests, UI primitives, feedback and overlay components, a commerce checkout flow, a settings dashboard, product tokens, component tokens, toast implementations, API examples, payment handlers, and design-system documentation.

The target was also audited across authentication, onboarding, merchant navigation, inventory, sales, customers, staff, reports, payments, subscriptions, platform administration, developer mode, services, Supabase migrations, Edge Functions, permissions, tests, and responsive CSS. Existing routes, role checks, tenant boundaries, payment enforcement, database behavior, and product-specific business flows remain authoritative.

## Foundations

- Brand accent: `#086DD9`; hover: `#075FBE`.
- Display and editorial headings: Forum, regular weight.
- Interface copy, labels, controls, tables, and data: Inter Variable.
- Icons: Hugeicons Stroke Rounded through semantic wrappers in `src/components/icons.tsx` and `src/components/platform/icons.tsx`.
- Surfaces stay quiet: white or neutral panels, hairline borders, low elevation, compact radii, and restrained semantic colour.
- Typography, spacing, colour, radius, shadow, motion, layer, content-width, and control-size values come from `src/styles/tokens.css`.
- Motion uses short entrance transitions, respects `prefers-reduced-motion`, and does not block interaction.

## Shared components and patterns

- Buttons: primary, outline, ghost, destructive, compact, loading, and disabled states.
- Forms: shared labels, hints, validation text, inputs, textareas, selects, and keyboard focus treatment.
- Data: responsive tables, status badges, pagination, KPI cards, metric strips, trend charts, definition lists, and timelines.
- Feedback: page loaders, skeletons, empty/error states, inline field or load errors, and global toasts for action outcomes.
- Overlays: accessible dialogs, mobile navigation drawers, tooltips, disclosures, and command search.
- Navigation: merchant and platform sidebars share geometry and states while retaining their own permission-aware information architecture.

### ZIP component mapping

- ZIP `MetricCard` maps to `src/components/ui/KpiCard.tsx`. Its header, optional icon, Forum value, supporting copy, quiet panel, hairline border, hover state, and responsive grid are shared by merchant dashboards, job summaries, reports, and platform billing.
- ZIP responsive overlay behavior maps to `src/components/ui/Dialog.tsx`; TrackOja keeps the native `<dialog>` implementation because it also provides focus containment and restoration.
- Mobile side sheets map to `src/components/ui/Drawer.tsx`. Merchant and platform navigation use this single primitive for modality, Escape, backdrop dismissal, focus containment, body scroll locking, responsive desktop cleanup, and reduced-motion behavior.
- ZIP feedback maps to `StateBlock`, `PageLoader`, inline field errors, and the global `Toast` provider. Action success, error, warning, information, and loading outcomes stay on the toast API.
- ZIP table, badge, pagination, definition-list, timeline, trend-chart, disclosure, button, and form patterns map to the same-named components under `src/components/ui`.

## Command search

`src/components/CommandSearch.tsx` is reusable and controlled by the shell that supplies its searchable items. It opens by trigger or `Ctrl/Cmd + K`, supports arrow keys, Enter, Escape, clear, empty results, outside-click dismissal, reduced motion, mobile sizing, and accessible combobox/listbox semantics. Merchant results come from the same permission-filtered navigation model as the sidebar. Platform results pass through `canSeeArea`, including developer-mode restrictions.

## Toasts

`src/components/ui/Toast.tsx` is the single notification API for success, error, warning, info, and loading states. Loading notifications are sticky and update in place. The stack supports descriptions, actions, deduplication keys, explicit dismissal, progress, pause on hover/focus, a five-item cap, semantic live regions, mobile placement, and reduced motion. Contextual field validation and page-load failures may remain inline so the source of the problem stays visible.

## Responsive and accessibility rules

- Desktop sidebars collapse; mobile sidebars use modal drawers.
- Tables and dense controls retain horizontal safety rather than forcing viewport overflow.
- Command search becomes a near-full-screen surface on narrow devices.
- All interactive controls preserve keyboard focus, labels, roles, and minimum mobile target sizes.
- Dark theme uses the same semantic tokens, with contrast adjusted at the token layer.

## Product-specific decisions preserved

- TrackOja is the single customer product. The unused TrackOja Works placeholder is removed by migration 097.
- Platform areas remain filtered by server-backed platform permissions and developer grants.
- Developer mode remains visible, audited, and limited to permitted sandbox behavior.
- Existing business-category terminology and modules continue to shape merchant navigation.
- Existing Supabase migrations, payment verification, subscription checks, and tenant isolation were not weakened by the UI migration.

## Extension rule

New screens should compose the existing primitives, semantic icon wrappers, tokens, command search, and toast API. Add a shared variant when a repeated product need is not covered; avoid page-local colour systems, one-off icon drawings, duplicated overlays, and separate notification stacks.
