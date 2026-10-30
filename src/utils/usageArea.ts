/**
 * Time in the app: the screen "area" a path belongs to, with ids replaced.
 * "/sales/6f1c…" → "/sales/:id". Null for paths that aren't counted.
 */
const ID_LIKE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[^/]*\d[^/]*)$/i;
const SKIP = /^\/(?:$|login|signup|forgot-password|reset-password|verify-email|auth|privacy|terms|welcome|platform)(?:\/|$)/;

export function usageArea(pathname: string): string | null {
  const path = String(pathname || '').split(/[?#]/)[0].toLowerCase().replace(/\/+$/, '') || '/';
  if (SKIP.test(path)) return null;
  const parts = path.split('/').slice(1, 6).map((p) => (ID_LIKE.test(p) ? ':id' : p.replace(/[^a-z0-9_-]/g, '')));
  const area = '/' + parts.filter(Boolean).join('/');
  return /^\/[a-z0-9/:_-]{1,79}$/.test(area) ? area : null;
}

const NAMES: [RegExp, string][] = [
  [/^\/dashboard$/, 'Overview'],
  [/^\/sales\/checkout/, 'Checkout'],
  [/^\/sales\/history/, 'Sales history'],
  [/^\/sales\/:id/, 'Receipts'],
  [/^\/sales/, 'Sales'],
  [/^\/inventory\/products\/(new|:id)/, 'Editing products'],
  [/^\/inventory\/products/, 'Products'],
  [/^\/inventory/, 'Stock'],
  [/^\/customers/, 'Customers'],
  [/^\/payments/, 'Payments'],
  [/^\/reports/, 'Reports'],
  [/^\/expenses/, 'Expenses'],
  [/^\/staff/, 'Staff'],
  [/^\/kitchen/, 'Kitchen'],
  [/^\/jobs/, 'Jobs'],
  [/^\/support/, 'Support'],
  [/^\/settings/, 'Settings'],
  [/^\/billing/, 'Subscription'],
];
export function areaName(area: string): string {
  for (const [re, name] of NAMES) if (re.test(area)) return name;
  return area.replace(/^\//, '') || 'Overview';
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export interface UsageRow { user_id: string; store_id: string; store: string; business: string; day: string; area: string; seconds: number }
export function summarizeUsage(rows: UsageRow[]) {
  const byArea = new Map<string, number>(), byStore = new Map<string, { id: string; name: string; business: string; seconds: number; people: Set<string>; last: string }>();
  const byDay = new Map<string, { day: string; seconds: number; people: Set<string> }>(), people = new Set<string>(), personDays = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const s = Number(r.seconds) || 0;
    total += s; people.add(r.user_id); personDays.add(`${r.user_id}|${r.day}`);
    const n = areaName(r.area); byArea.set(n, (byArea.get(n) ?? 0) + s);
    const b = byStore.get(r.store_id) ?? { id: r.store_id, name: r.store, business: r.business, seconds: 0, people: new Set(), last: r.day };
    b.seconds += s; b.people.add(r.user_id); if (r.day > b.last) b.last = r.day; byStore.set(r.store_id, b);
    const d = byDay.get(r.day) ?? { day: r.day, seconds: 0, people: new Set() };
    d.seconds += s; d.people.add(r.user_id); byDay.set(r.day, d);
  }
  return {
    totalSeconds: total,
    people: people.size,
    avgPerPersonDay: personDays.size ? Math.round(total / personDays.size) : 0,
    areas: [...byArea].map(([name, seconds]) => ({ name, seconds, share: total ? seconds / total : 0 })).sort((a, b) => b.seconds - a.seconds),
    stores: [...byStore.values()].map((b) => ({ id: b.id, name: b.name, business: b.business, seconds: b.seconds, people: b.people.size, last: b.last })).sort((a, b) => b.seconds - a.seconds),
    days: [...byDay.values()].map((d) => ({ day: d.day, seconds: d.seconds, people: d.people.size })).sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}
