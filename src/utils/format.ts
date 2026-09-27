/**
 * Shared presentation formatters.
 *
 * These were previously duplicated privately in three files with different
 * output (one abbreviated, one not), which meant the same number could read
 * differently on two screens. One implementation is the fix.
 */

/** Full currency, e.g. ₦22,500.00 → shown without decimals when whole. */
export function formatMoney(value: number | null | undefined, currency = 'NGN'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const symbol = currency === 'NGN' ? '₦' : `${currency} `;
  const hasFraction = Math.abs(value % 1) > 0.0001;
  return `${symbol}${value.toLocaleString('en-NG', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact currency for KPI tiles, e.g. ₦1.2M. */
export function formatMoneyCompact(value: number | null | undefined, currency = 'NGN'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const symbol = currency === 'NGN' ? '₦' : `${currency} `;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${symbol}${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return `${symbol}${value.toLocaleString('en-NG')}`;
}

/** True when there is a real number to show, so callers can print "No data" instead of 0. */
export function hasValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && !Number.isNaN(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-NG');
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 days ago" / "in 5 days". Negative future, positive past. */
export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  const diffMs = now - time;
  const future = diffMs < 0;
  const seconds = Math.floor(Math.abs(diffMs) / 1000);
  if (seconds < 60) return future ? 'in a moment' : 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return future ? `in ${days}d` : `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return future ? `in ${months}mo` : `${months}mo ago`;
  const years = Math.floor(months / 12);
  return future ? `in ${years}y` : `${years}y ago`;
}

/** Days until a date; negative when it has passed. Null when there is no date. */
export function daysUntil(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - now) / 86_400_000);
}

/** Seat allowance: the plan semantics are -1 unlimited, null custom, positive cap. */
export function formatSeatLimit(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return 'Custom';
  if (limit === -1) return 'Unlimited';
  return `${limit.toLocaleString('en-NG')} user${limit === 1 ? '' : 's'}`;
}

/** Turns a stored snake_case token into sentence case for headings. */
export function humaniseToken(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/[_-]+/g, ' ').replace(/^\w/, (character) => character.toUpperCase());
}
