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

- TrackOja and TrackOja Works remain separate entitlements. A subscription to one does not grant the other.
- Platform areas remain filtered by server-backed platform permissions and developer grants.
- Developer mode remains visible, audited, and limited to permitted sandbox behavior.
- Existing business-category terminology and modules continue to shape merchant navigation.
- Existing Supabase migrations, payment verification, subscription checks, and tenant isolation were not weakened by the UI migration.

## Extension rule

New screens should compose the existing primitives, semantic icon wrappers, tokens, command search, and toast API. Add a shared variant when a repeated product need is not covered; avoid page-local colour systems, one-off icon drawings, duplicated overlays, and separate notification stacks.
