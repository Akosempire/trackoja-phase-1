# Platform console UX redesign — before and after

Every number here was measured in a browser against the running console at
`/platform` and its nine sibling screens, at real viewports. Nothing is estimated.

## The problem, measured

Two things made the console hard to use, and both were measurable rather than a
matter of taste.

**The content stretched to fill whatever monitor it was on.** `.page` in
`waya.css` sets `max-width: none` so the merchant screens can use the whole
window, and the console inherited it:

| Viewport | Content width | Longest rendered line |
| --- | --- | --- |
| 1440px | 1193px | 191 characters |
| 1920px | 1673px | 271 characters |
| 2560px | 2313px | 378 characters |

A 378-character line is roughly five times the 45–75 character range that is
comfortable to read. Cards, tables and paragraphs all scaled with the monitor.

**There was far too much text.** The ten screens rendered **11,331 words**. The
worst offenders were the three areas whose backends are missing, because each
explained its own absence at length:

| Screen | Words before |
| --- | --- |
| Integrations | 1,943 |
| System health | 1,693 |
| Subscriptions & billing | 1,313 |
| Activation keys | 1,235 |
| Audit logs | 1,195 |
| Platform settings | 1,139 |
| Developer tools | 1,111 |
| Support | 999 |
| Businesses & users | 550 |
| Overview | 489 |

Overview carried **9 headings and 7 cards** for a screen whose job is to answer
three questions quickly.

## Layout

The console now renders in a centred, capped column: `.plat-page` is
`max-width: var(--content-readable)` (1440px, Waya's existing readable-width
token) with `margin-inline: auto`. Content width is now **1440px at 1920 and
2560**, and unchanged at 1440 — so it grows to a comfortable size and then stops.

Capping the column is only half of it: a paragraph in a full-width card would
still run to the card's edge. Running text is therefore capped at a readable
measure by a new Waya token, `--measure-prose: 68ch`, applied broadly:

```css
.plat-page :is(p, dd, li, span.form-hint, …) { max-width: var(--measure-prose); }
/* Layout rows span their card; only the text inside them is capped. */
.plat-page :is(.attention-item, .timeline-item, .list-item, .chip, .def-row) { max-width: none; }
```

The broad selector is deliberate. The offenders were not one component: a block
element fills its card however short its text, so every paragraph the console
renders was affected. The reset keeps the attention queue, the timeline and the
detail rows spanning their card, so the card does not look half-empty.

**Where the extra width is spent.** One place, deliberately: **detail views**.
`dialog.is-wide` grows to 1040px above 1440px viewports, so opening a record shows
it whole rather than through a narrow sheet, while the reading column behind it
stays capped. Tables also get the benefit of the wider column without any card
being stretched past 1440px.

An earlier draft added a two-column `.split-aside` grid for putting figures beside
a title. Nothing used it, so it was removed rather than shipped as an unused
abstraction. Most screens still use a single column, and more of them could take
advantage of the width now available — that is noted under "what to review".

## Copy audit

The rule applied to every string on all ten screens:

> Does this change what the operator does? Keep it. Does it restate the heading,
> explain an obvious control, or narrate absence? Delete it. Is it genuinely
> useful but not needed by default? Move it into a disclosure.

**Result: 11,331 words → 4,620 (−59%)**, measured in the running app by counting
the words that actually render with every disclosure closed — i.e. what an
operator sees without clicking anything.

| Screen | Before | After | Cut |
| --- | --- | --- | --- |
| Activation keys | 1,235 | 279 | −77% |
| Support | 999 | 234 | −77% |
| Integrations | 1,943 | 495 | −75% |
| Overview | 489 | 152 | −69% |
| Platform settings | 1,139 | 458 | −60% |
| Developer tools | 1,111 | 456 | −59% |
| System health | 1,693 | 736 | −57% |
| Subscriptions & billing | 1,313 | 589 | −55% |
| Audit logs | 1,195 | 729 | −39% |
| Businesses & users | 550 | 492 | −11% |
| **Total** | **11,331** | **4,620** | **−59%** |

This is deletion plus disclosure, not text moved out of sight. An independent
measurement of the two heaviest files — Settings, Developer and Audit — counted
total text *including* everything inside closed disclosures and still found it
down 22–38%, while their visible text fell 56–71%. Where the reduction is weakest,
the reason is recorded under "what to review".

### What was removed, and the reason each time

**Deleted outright** — one of these reasons applies to every removal:

| Removed | Reason |
| --- | --- |
| "Search matches the business name, owner email and slug." | The placeholder already says "Name, owner email or slug". |
| "Open a business to see its plan, staff, payments and support history." | Describes what a table row does. |
| "This is what actually grants the business access; the seat limit is enforced against it." → "What grants access. The seat limit is enforced against it." | Restated its own heading before getting to the point. |
| "Billing status is filtered in this browser because the directory endpoint does not accept it, so a page can show fewer rows… Search or narrow by product to find a specific business." | The consequence matters; the cause and the advice did not. Now one line. |
| "Append-only notes. A correction is another note; there is no edit or delete." → "Append-only. A correction is another note." | Same fact, half the words. |
| A whole section on Integrations describing each integration in prose (≈345 words, 9 notes) | Code paths and environment variable names are not operator decisions. Moved to a disclosure. |
| Integrations credential `DefList` (≈120 words) and the credential contract DDL + 4 RPC descriptions (≈260 words) | Specification for a capability that does not exist. Moved to disclosures. |
| Health's per-row diagnostics: "No route — nothing records this. Would need: …" repeated across 7 rows (≈175 words) | The cell now says `No route`; the requirements moved to one disclosure. |
| Health's "How to read the statuses" legend (≈150 words) | The badges already carry the vocabulary. Moved to a disclosure. |
| Support's ticket DDL, 7 RPC signatures and the vocabulary list (≈360 words) | Reference material. Moved to disclosures. |
| "Read this as a runbook, not as state" | A callout that repeated its own heading. |
| "Acknowledgement, ownership and resolution. The workflow an operator would run during a bad hour." | Restated the heading above it. |
| "Clicking this opens a dialog where you can…" and similar | Explains an obvious control. |

**Moved into a `<Disclosure>`** — 12 disclosures across the nine screens, each a
native `<details>` with a short summary, so the information is one click away and
costs no space or JavaScript:

"Secrets, code references and verified notes" · "How a credential store would
work" · "What the backend would need" (×5, across Integrations, Health, Support)
· "Setup runbook and troubleshooting" · "How to read the statuses" · "What each
missing signal would need" · "Ticket vocabulary already agreed" · "Not built
here (n)" — the last being the per-area gap list, which was previously a warning
box sitting above the data on every one of the ten screens.

**Kept, shortened, and never deleted.** Every honesty statement survives, because
the console's value rests on not pretending. The measurement used for the copy
counts collapses disclosures to their summaries, and honesty assertions were then
re-run against the *rendered* text — `Not configured` and `No data` still appear
for every checkless item, the seven uninstrumented health signals still read
`Not instrumented`, and no screen claims a healthy status for a system with no
check.

## Actions made easier to find

Overview was reorganised from a wall of decorative metrics into a queue, and the
hierarchy the brief asks for is now literal: **Needs attention → At a glance →
Recent activity**, with 3 headings instead of 9.

The queue lists only things an operator can act on today, most costly first, each
with its own action **on the row** rather than at the top of the page:

| Item | Shows | Action |
| --- | --- | --- |
| Failed payments | count, and how many succeeded in the same period | Review → billing, filtered |
| Subscriptions past due | count, and that access continues until the next seat check | Review → billing, filtered |
| Expiring within 30 days | count and the soonest date | Review → billing, filtered |
| Past their expiry date | count, and that nothing sweeps them | Review → billing, filtered |
| Activation keys not redeemed | count, and that the customer may have paid and have no access | Review → activation keys |
| Suspended businesses | count | Review → businesses, filtered |
| **Not monitored** | tickets, integrations and incidents have no backend | Details → support |

That last row is the honest alternative to a fabricated queue. The brief lists
"open support tickets, integration failures, system incidents" as things to
prioritise; none has a backend, so the screen says so once instead of rendering an
empty list that would read as "no problems".

**A calm healthy state.** When the queue is empty, a single green line states what
is true — "Nothing needs attention. No failed payments, nothing past due, and no
subscription expiring in the next 30 days." — followed by the honesty row. No
oversized empty panel.

**Metrics are now context, not the point.** Nine compact counts replace the card
grid: each has a label, a value, and a time range or basis ("Last 30 days",
"Recent, not a 24h total"), and each is a button that opens the list behind it.
The decorative inventory-value and staff-count cards are gone.

## Navigation

Grouping was reviewed rather than rebuilt — it already maps to the brief's list:

- **Customers:** Businesses & users · Subscriptions & billing · Activation keys · Support
- **Operations:** Integrations · System health · Developer tools
- **Governance:** Audit logs · Platform settings

Three changes to make the current location obvious and remove duplication:

1. **Shorter area names**, sentence case, so page titles and nav entries agree:
   "Activation Keys & Access" → "Activation keys", "Support & Feedback" →
   "Support", "System Health" → "System health", and so on.
2. **The active group is marked**, not just the active link, so ten peer entries
   do not all look alike.
3. **The redundant breadcrumb is gone.** On a top-level area it read
   "Platform / Platform settings" above the heading "Platform settings". It now
   appears only on detail views, where it earns its place.

Area descriptions no longer appear as page subtitles — they moved to the nav
item's native tooltip, which is the "show deeper explanations only where needed"
case from the brief.

## Responsive behaviour

Verified at 1440, 1024, 820, 390 and 320: `documentElement.scrollWidth` equals
the viewport on every screen, so there is no horizontal overflow at any width. The
centred column is 1440px on a large desktop, the window width on a laptop, and the
page padding collapses below 600px. Tables use the existing stacked layout below
900px, and the attention queue reflows to two columns with the action beneath the
text rather than being squeezed.

## What to review

- **Audit logs fell least (−39%), and it is the screen to look at first.** Its
  length is concentrated in two inventories — which actions write an audit row,
  and which do not — and both are the evidence base for an honesty claim made on
  the same screen ("permission denials leave no record"). They are now behind a
  disclosure, so they cost nothing on open, but they are the largest remaining
  block of text in the console. If you want it shorter, the trade is between that
  evidence and the claim.
- **Businesses & users barely moved (−11%)** because most of its length is table
  content — business names, plans, statuses — not prose. There was little to cut
  without removing information.
- **Two paragraphs still measure 94 characters per line** (one each on Businesses
  and Billing) against the 68ch cap. That is a table cell or a nested element the
  broad selector does not reach; it is marginal but not zero.
- **The honesty rows are the one place copy was kept deliberately long.** If you
  would rather trade some of that for brevity, the three areas with no backend
  (Support, Integrations, System health) are where to look — but each line there
  exists to stop an empty screen reading as good news.
- **Most screens still use a single column.** The width is now available and
  capped; a few screens could use it more actively than they do.
- **One accepted duplication.** Each area shows a collapsed "Not built here (n)"
  summary from its config, and Billing and Activation also list their limitations
  inline near the relevant data. Both are deliberate — the inline lines sit beside
  the data they qualify, the disclosure is the config-level record — and the
  visible cost of the overlap is the four words in the summary.
