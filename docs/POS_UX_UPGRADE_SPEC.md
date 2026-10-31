Claude

















Trackoja pos upgrade prompt · MD
TrackOja POS – UX Upgrade Prompt
You are improving TrackOja, a point-of-sale and inventory web app for small Nigerian retail shops (supermarkets, pharmacies, provision stores). Users are store owners, managers, cashiers and inventory officers working at a busy counter, often on cheap Android phones, tablets, or a desktop with a USB barcode scanner. Speed at the till matters more than anything else. A cashier should be able to serve a customer without touching the mouse, and with one thumb on a phone.

Keep the existing visual style (dark/light themes, blue primary, rounded cards), data model and APIs. Change behaviour and layout as described below. Do not remove features; move them out of the cashier's way.

1. Register mode (new focused POS screen)
Route /sales/checkout becomes a full-screen register mode:

Hide the admin sidebar, global top search, branch switcher and Log out while in register mode.
Slim top bar only: store/branch name (read-only), cashier chip (switch via PIN), till status pill (Open / Closed – tap to open), Held sales button with count badge, and a menu (⋯) with "Exit register" (owners/managers only; requires PIN for other roles).
Layout (desktop/tablet ≥ 900px): left = search + category tabs + products; right = cart + payment (fixed column, ~380px). Phone: products full-width, sticky cart bar at bottom, checkout as full-screen sheet.
2. Scanner & search (highest priority)
Autofocus the search input on page load, after adding an item, after completing/holding/clearing a sale, and after closing any modal. Clicking empty space must not steal focus permanently (return focus to search).
Keyboard-wedge scanner support: on Enter, if the input exactly matches a barcode or SKU (case-insensitive) → add that product immediately, clear the input, keep focus, play a short beep. If the search has exactly one result → Enter adds it. If multiple → arrow keys move a highlight through results, Enter adds the highlighted one.
Also listen globally for fast scanner bursts (characters < 50ms apart ending with Enter) even if focus is elsewhere, and route them to the add-by-code handler.
Unknown code → inline red message "No product with code 123…" + "Add product" link; do not open a modal.
Clear the search text automatically after every successful add.
One Scan entry point per screen: keep the camera scan button next to search; remove the duplicate sidebar Scan button inside register mode and the extra header icons on mobile.
Fix the camera scanner dialog on desktop: centre it as a modal (it currently renders as a left-anchored bottom sheet). On phones keep it as a bottom sheet.
3. Product grid
Add a list/grid toggle (remember per device). List rows ~64px: name, price, stock left, "+" button. Default to list on phones.
Category tabs (horizontal scroll) + a Favourites tab (owner can pin quick-sell items).
Out-of-stock items: dimmed, sorted to the end, still show price. Tapping shows "Out of stock – adjust stock?" (manager+ only).
Add feedback when an item is added: quantity badge on the tile, a brief pulse on the cart bar/total, and navigator.vibrate(30) on mobile.
4. Cart
Quantity: allow typing the quantity directly (tap the number), plus −/+ buttons at least 44×44px.
Remove: trash icon button (44px) on desktop, swipe-left on mobile. Removing the last unit via − asks nothing; removing via trash is instant with an "Undo" toast.
When the cart has many lines, collapse lines into "N items · ₦total" (expandable) so payment stays above the fold on phones.
"Add customer" and "Add discount" become proper 44px buttons. Discount over a configurable limit requires a manager PIN.
Hold/Held: real buttons, Held shows a count badge.
5. Payment
Payment methods as large toggle buttons: Cash, Transfer, POS/card, Credit (disabled until a customer is added, with a hint saying so), Other.
Split payment: "Add another payment" lets the cashier combine e.g. ₦2,000 cash + ₦3,500 transfer; show remaining balance live; Complete is enabled only when fully covered (or on credit with a customer).
Cash: the amount-received field must not show a fake value as placeholder. Either prefill with the exact total (selected text so typing replaces it) or leave visibly empty with placeholder "Enter amount". Quick-cash chips: Exact + the next sensible Naira notes above the total (e.g. total ₦1,200 → ₦1,500, ₦2,000, ₦5,000; total ₦7,300 → ₦7,500, ₦8,000, ₦10,000). Chips ≥ 44px tall.
Change due becomes the largest number in the panel once cash ≥ total (green). If cash < total show "₦X short" in red and disable Complete.
Transfer / POS card: replace the negative checkbox "Not confirmed yet (check the alert later)" with two clear buttons: "Payment received" (completes sale) and "Confirm later" (saves as Awaiting payment). Reference field optional.
6. Completing a sale (stay on the register)
Do not navigate away to the receipt page. Show an in-place success panel: ✓ Sale complete, total, change due in large text, buttons Print · WhatsApp · Share · View receipt.
Auto-print if "auto-print receipts" is enabled in settings.
The next scan, keystroke, or tap on a product starts a new sale automatically (panel dismisses, cart empty, search focused). Also a "New sale" button (Enter).
7. Keyboard shortcuts (desktop)
Show a "?" button that lists them.

Key	Action
/ or F2	Focus search
F3	Open camera scanner
F4–F7	Cash / Transfer / POS card / Other
F8	Hold sale
F9	Held sales
F10 or Ctrl+Enter	Complete sale
+ / -	Change qty of last-added line
Delete	Remove last-added line
Esc	Close modal / clear search / (double-press) clear cart with confirm
1–4 (in cash field focus-less state)	Quick-cash chips
8. Till
Show till status on the register at all times.
When "Require an open till to sell" is on and the till is closed, show an inline "Open till to start selling" card with the cash-count input right on the register, not a block on Complete.
Make "Require an open till" default on for new stores.
9. Roles & permissions (security – must be enforced server-side)
Roles: Owner, Manager, Cashier, Inventory officer.

PIN switch must change permissions, not just attribution. When a cashier switches in by PIN on a device logged in as the owner, the session must act with the cashier's permissions until switched back. Remove the copy "What this device can do doesn't change."
Sensitive actions on a cashier session prompt for a manager/owner PIN override (logged with both names): void, refund, discount above limit, price override, removing a line after payment started, opening the cash drawer without a sale, exiting register mode.
Cashier: register mode, held sales, own till, own sales history today. No cost price, margin, reports, stock adjustments, product edits, staff, settings, billing.
Inventory officer: products (no price/cost edits unless allowed), stock, restock, counts, transfers. No POS, reports of revenue, staff, settings, billing.
Manager: everything except staff role changes for owners, billing, delete business, payment-provider settings.
Owner: everything.
Hidden menu items are not enough: every route and API endpoint must check the role and return a friendly "You don't have access" page (with "Switch user" button) instead of the content.
Cashiers/inventory officers are locked to their assigned branch.
Every sale, void, refund, stock movement and till event records the acting user and (if any) the approver.
10. Stock adjustments
Count correction: ask "How many did you count?" and compute the difference automatically (show "System: 5 → Counted: 3 = −2"). Keep reason required.
Capitalise movement labels consistently ("Return", not "return").
11. Mobile specifics
Minimum touch target 44×44px everywhere on POS (currently Remove/Add customer/Add discount are 19px tall, quick-cash and Hold/Held 32px, qty buttons 36px).
Sticky cart bar must not be overlapped by the floating Scan button; place Scan inside the bar or above it with clear spacing.
In register mode the bottom nav shows only: Sell · Held · Till · More (More hidden for cashiers).
12. Performance
Avoid the full "Opening your workspace" splash on reload: cache the app shell and product catalogue (PWA/service worker), render from cache instantly, then refresh in background.
Product search must be local/in-memory (instant, works offline); queue sales offline and sync when back online, with a visible "Offline – N sales waiting to sync" indicator.
Acceptance checks
Desktop: with a USB scanner, scan 5 items, press F4, type 5000, press F10, new sale is ready – zero mouse clicks.
Phone (400px): add 3 items, pay cash with a quick chip, complete – all with one thumb, every tap target ≥ 44px.
Split ₦5,500 sale into ₦2,000 cash + ₦3,500 transfer completes and the receipt shows both.
Owner device, cashier PIN switched in: Void, Reports, Settings, Staff and /settings by URL are all blocked or require manager PIN.
Cashier account cannot read cost prices through the UI or the API.
Count correction "counted 3" on a stock of 5 records −2.

Claude finished the response
