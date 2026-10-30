// Owner emails from TrackOja, sent through Usetally's email setup:
// POST <USETALLY_URL>/api/notify/trackoja with Bearer USETALLY_SUPPORT_SECRET.
// Pure builders here are tested in tests/daily-digest.test.ts.

export interface NotifyMessage {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  details?: [string, string][];
  button?: { text: string; url: string };
}

export async function sendViaUsetally(msg: NotifyMessage, opts: { base: string; secret: string; fetcher?: typeof fetch }): Promise<{ sent: boolean; status: number; error?: string }> {
  if (!opts.secret || opts.secret.length < 32) return { sent: false, status: 0, error: 'not configured' };
  const f = opts.fetcher ?? fetch;
  try {
    const res = await f(`${opts.base.replace(/\/+$/, '')}/api/notify/trackoja`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(15000),
    });
    let data: { error?: string } = {};
    try { data = await res.json(); } catch { data = {}; }
    return { sent: res.ok, status: res.status, error: res.ok ? undefined : data.error };
  } catch (e) {
    return { sent: false, status: 0, error: e instanceof Error ? e.message : 'unreachable' };
  }
}

const SYMBOL: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', GHS: 'GH₵', KES: 'KSh' };
export function money(amount: number, currency = 'NGN'): string {
  const n = Number(amount) || 0;
  const s = n.toLocaleString('en-NG', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${SYMBOL[currency] ?? `${currency} `}${s}`;
}

const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card / POS', transfer: 'Transfer', credit: 'On credit', other: 'Other' };
const fmtQty = (q: number) => String(Number(q) % 1 === 0 ? Number(q) : Number(q).toFixed(2));
function prettyDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export interface DigestStore {
  store_id: string;
  store: string;
  currency: string;
  day: string;
  sales: { count: number; total: number; voided?: number };
  payments: { method: string; amount: number }[];
  low_stock: { name: string; stock: number; reorder: number; unit?: string }[];
  recipients: { email: string; name?: string | null }[];
}

/** One store's summary → the email for one recipient. */
export function digestEmail(s: DigestStore, to: { email: string; name?: string | null }, appUrl: string): NotifyMessage {
  const count = Number(s.sales?.count) || 0;
  const total = Number(s.sales?.total) || 0;
  const low = s.low_stock ?? [];
  const first = String(to.name || '').trim().split(/\s+/)[0];
  const lines: string[] = [];
  lines.push(count
    ? `${first ? `Hi ${first}, ` : ''}${s.store} made ${count} sale${count === 1 ? '' : 's'} on ${prettyDay(s.day)}, worth ${money(total, s.currency)}.`
    : `${first ? `Hi ${first}, ` : ''}${s.store} had no sales on ${prettyDay(s.day)}.`);
  if (s.sales?.voided) lines.push(`${s.sales.voided} sale${s.sales.voided === 1 ? ' was' : 's were'} voided.`);
  if (low.length) {
    lines.push(`${low.length} product${low.length === 1 ? ' is' : 's are'} running low:`);
    for (const p of low.slice(0, 20)) lines.push(`• ${p.name}: ${fmtQty(p.stock)}${p.unit ? ` ${p.unit}` : ''} left (reorder at ${fmtQty(p.reorder)})`);
    if (low.length > 20) lines.push(`…and ${low.length - 20} more.`);
  } else {
    lines.push('Nothing is running low.');
  }
  return {
    to: to.email,
    subject: low.length ? `${s.store}: ${count} sales, ${low.length} low on stock` : `${s.store}: ${count} sale${count === 1 ? '' : 's'} yesterday`,
    heading: `Your day at ${s.store}`.slice(0, 150),
    lines,
    details: (s.payments ?? []).filter((p) => Number(p.amount) > 0).map((p) => [METHOD[p.method] ?? p.method, money(p.amount, s.currency)] as [string, string]),
    button: { text: low.length ? 'See low stock' : 'Open TrackOja', url: `${appUrl.replace(/\/+$/, '')}${low.length ? '/inventory/products' : '/dashboard'}` },
  };
}
