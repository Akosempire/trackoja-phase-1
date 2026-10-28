# Usetally POS screen rebuild guide

Every merchant screen is being rebuilt in Usetally's look. Logic, data calls,
permissions and test hooks stay; markup and styling are replaced.

## Building blocks
- `src/components/kit.tsx`: `Page` (width `page` | `wide` | `form`), `PageHeader`
  (title, subtitle, eyebrow, actions), `Card`, `CardHead`, `Stat`, `Pill`, `Empty`,
  `Avatar`, `RowLink`, `btn(variant, size)` class helper for links/buttons, `inputClass`, `cn`.
- Shared UI that is already restyled and should be reused: `ui/Button` (variants
  primary | outline | ghost | danger, `className="btn-sm"` for small), `ui/FormField`,
  `ui/StateBlock` + `SectionState`, `ui/SegmentedControl`, `ui/DataTable`,
  `ui/Badge`, `ui/StatusBadge`, `ui/DefList`, `ui/Dialog`, `ui/Disclosure`,
  `ui/Pagination`, `ui/KpiCard`, `BarcodeScanner`, `BusinessActivity`, icons in `components/icons.tsx`.
- Tailwind v4 utilities are available with theme names bound to the tokens:
  colours `canvas surface subtle tray hover line line-strong ink ink-2 ink-3 brand
  brand-hover brand-soft brand-line brand-ink success success-soft success-ink warn
  warn-soft warn-ink danger danger-soft contrast`; radius `md`(10) `lg`(12) `xl`(16)
  `2xl`(20); shadows `shadow-card shadow-pop shadow-dialog`. Dark mode is automatic
  (tokens switch), so never hard-code hex colours.

## Look
- Grey canvas, white cards (`rounded-xl border border-line bg-surface shadow-card p-5`).
- One blue primary action per screen; everything else outline/ghost.
- Type: page title 24/28px semibold; card title 15px semibold; body 14px; meta 12–13px `text-ink-3`.
- Money uses `formatMoney` and `tabular-nums`. Lists: `divide-y divide-line` rows, 12px vertical padding.
- Phone first: single column below `lg`, no horizontal page scroll at 375px,
  touch targets ≥ 40px, leave `pb-28` space for the bottom tab bar (Page does this).
- Copy: plain, short, friendly. No emoji.

## Reference screens already rebuilt
`src/pages/DashboardPage.tsx`, `src/pages/inventory/ProductsPage.tsx`,
`src/pages/inventory/ProductFormPage.tsx`, `src/pages/sales/CheckoutPage.tsx`,
`src/pages/sales/ReceiptPage.tsx`.

## Rules
- Keep every service call, permission check, state machine and accessible name.
  Tests query by role/name and some by class (`.hd-metrics`, `.dashboard-revenue`,
  `.bottom-nav-scan`…): run the tests and keep them green. If a test only asserts
  old markup/CSS source shape, update it to the new structure and say so.
- Delete legacy class names from rebuilt markup (they still carry legacy CSS).
- `npx tsc --noEmit -p .` and `npx vitest run` must pass.

## Preview
A preview server may be running at http://127.0.0.1:4190 (start one with
`npx vite --config tests/visual/app.vite.config.ts --host 127.0.0.1 --port 4190`).
Open `/tests/visual/app.html?path=/customers&theme=light` (or `theme=dark`).
Services are mocked; add sample data for your area in
`tests/visual/fixtures/<area>.ts`:
```ts
export default (mock: (svc: string, key: string, value: unknown) => void, F: typeof import('../app-fixtures')) => {
  mock('CustomerService', 'getCreditTransactions', []);
};
```
Pass a function as `value` to receive call arguments. Screenshot at 1440×900 and
390×844 with Playwright (`require('playwright')` works; `chromium.launch()` needs no options).
