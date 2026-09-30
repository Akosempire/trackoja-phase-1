# TrackOja / Waya design system

The supplied Waya specification controls presentation. TrackOja's routes, role-aware navigation, store switching, business categories, permissions, services, and commerce flows remain TrackOja's own. The attached ZIP was inspected as a visual reference; its pages, configuration, and credentials were not imported.

## Foundations

- `src/styles/tokens.css` owns light/dark colors, type, spacing, radii, borders, motion, layout, shadows, icons, and stacking levels. Existing short token names are semantic aliases so all commerce modules share the palette.
- `src/styles/waya.css` maps existing components to Waya: editorial page headings, compact UI, hairline sections, quiet panels, neutral selection, restrained accent, and focused desktop containers.
- The current approved TrackOja adaptation bundles Inter Variable for interface text and Forum regular for display headings. The ZIP originally named Geist and Ashcroft/Playfair; `DESIGN_SYSTEM_AUDIT.md` and `tokens.css` record the subsequent TrackOja font and blue-accent decisions. Do not reintroduce the older palette or font stack.
- Change palette/type tokens to rebrand. Avoid new page-specific literal colors.
- Appearance supports light, dark, and system, persists locally, and follows OS changes in system mode. Accessible success/warning text variants accompany the canonical semantic colors on light surfaces.

## Preserved surfaces

Authentication and welcome; onboarding; dashboard; inventory, categories, stock, and bulk import; sales, checkout, and receipts; customers; payments; devices; staff; reports; billing; settings and support; platform administration; kitchen and expiry alerts all retain their routes and functionality. Existing cards, lists, forms, badges, and buttons consume shared styles.

The desktop sidebar is 247px, collapses to 60px, and keeps the workspace mark and external keyboard/hover labels. Mobile/tablet use a modal navigation drawer alongside TrackOja's existing bottom shortcuts. Dialogs contain keyboard focus, dismiss with Escape, and restore trigger focus. The scanner retains camera detection and manual entry. Bulk-import tables become labeled stacked rows on small screens. Settings and receipts keep narrower reading widths.

Shared buttons support accent, neutral, outline, quiet, and danger variants. Pending buttons preserve dimensions and accessible action text. Form errors are associated with inputs. Loading pages use geometry-preserving skeletons. Reduced-motion preferences suppress animation. Browser zoom is enabled.

## Historical validation (initial migration)

- Production TypeScript/Vite/PWA build.
- Existing Vitest suite: 321 tests across 21 files.
- Chromium visual checks: 1440, 1024, 820, 390, and 320px, no horizontal overflow on the dashboard.
- Light/dark persistence, OS theme changes, 247/60px sidebar, keyboard tooltips, mobile drawer Tab containment, Escape, and focus restoration.
- Settings and checkout rendering; scanner manual-entry error feedback; real CSV parsing and labeled mobile import rows, using isolated service fixtures.
- Screenshots in `artifacts/waya` use isolated browser fixtures, not customer records. They validate rendering and interaction; they do not establish live Supabase, payment, or physical scanner integration.

The build retains its existing large-JavaScript-chunk advisory. No service/database/payment logic was changed.

The current phased audit and validation status is maintained in `docs/PRODUCT_UX_AUDIT.md`.
