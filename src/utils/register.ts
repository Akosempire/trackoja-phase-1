/**
 * Register (POS) logic that has no React in it, so it can be tested on its own:
 * quick-cash chips, split payments, scanner bursts, keyboard shortcuts and
 * code lookups.
 */

export const round2 = (value: number): number => Math.round(value * 100) / 100;

// ---- quick cash ------------------------------------------------------------

/** Naira notes a customer is likely to hand over, smallest first. */
const NOTE_STEPS = [500, 1000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];

/**
 * Exact + the next three sensible amounts above the total.
 * ₦1,200 → Exact, 1,500, 2,000, 5,000 · ₦7,300 → Exact, 7,500, 8,000, 10,000.
 */
export function quickCashChips(total: number): { label: 'Exact' | 'note'; amount: number }[] {
  if (!(total > 0)) return [];
  const exact = round2(total);
  const out: number[] = [];
  for (const step of NOTE_STEPS) {
    const v = Math.ceil(exact / step) * step;
    if (v > exact && !out.includes(v)) out.push(v);
    if (out.length >= 3) break;
  }
  return [{ label: 'Exact', amount: exact }, ...out.map((amount) => ({ label: 'note' as const, amount }))];
}

// ---- payments ----------------------------------------------------------------

export type RegisterMethod = 'cash' | 'transfer' | 'card' | 'credit' | 'other';

export interface PaymentLine {
  id: string;
  method: RegisterMethod;
  /** what was entered; '' means "not entered yet" */
  amount: string;
  reference?: string;
  /** transfer / card / other not confirmed yet ("Confirm later") */
  pending?: boolean;
}

export interface Coverage {
  /** sum of every line */
  paid: number;
  /** total − paid, never below 0 */
  remaining: number;
  /** cash given back; only cash can be over-paid */
  change: number;
  /** what the cash lines fall short by, when the rest doesn't cover it */
  short: number;
  covered: boolean;
  /** over-paid with a non-cash method (not allowed) */
  overpaidNonCash: boolean;
}

export const amountOf = (line: PaymentLine): number => {
  const n = Number(String(line.amount).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
};

/** How far the payment lines go towards the total. */
export function coverage(total: number, lines: PaymentLine[]): Coverage {
  const t = round2(Math.max(total, 0));
  const paid = round2(lines.reduce((s, l) => s + amountOf(l), 0));
  const cash = round2(lines.filter((l) => l.method === 'cash').reduce((s, l) => s + amountOf(l), 0));
  const nonCash = round2(paid - cash);
  const over = round2(paid - t);
  const overpaidNonCash = nonCash > t + 0.001;
  const change = over > 0 && !overpaidNonCash ? Math.min(over, cash) : 0;
  const remaining = Math.max(round2(t - paid), 0);
  return { paid, remaining, change: round2(change), short: remaining, covered: t > 0 && remaining === 0 && !overpaidNonCash, overpaidNonCash };
}

/**
 * What create_sale receives. Cash keeps the full amount handed over (the
 * database works out the change); the other lines are what they say.
 */
export function salePayments(lines: PaymentLine[]): { method: RegisterMethod; amount: number; reference?: string; pending?: boolean }[] {
  return lines
    .filter((l) => amountOf(l) > 0)
    .map((l) => ({
      method: l.method,
      amount: amountOf(l),
      ...(l.reference?.trim() ? { reference: l.reference.trim() } : {}),
      ...(l.method !== 'cash' && l.method !== 'credit' && l.pending ? { pending: true } : {}),
    }));
}

// ---- codes and search ----------------------------------------------------------

export interface Codable { id: string; name: string; sku: string; barcode?: string | null }

/** The product whose barcode or SKU is exactly this code (any case), or null. */
export function findByCode<T extends Codable>(items: T[], code: string): T | null {
  const c = code.trim().toLowerCase();
  if (!c) return null;
  return items.find((p) => (p.barcode ?? '').toLowerCase() === c) ?? items.find((p) => p.sku.toLowerCase() === c) ?? null;
}

/** Name / SKU / barcode contains the term (any case). */
export function matches(p: Codable, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || (p.barcode ?? '').toLowerCase().includes(t);
}

/** In-stock first (by name), out-of-stock at the end. */
export function sortForRegister<T extends { name: string; trackInventory: boolean; stockQty: number }>(items: T[], allowNegative = false): T[] {
  const out = (p: T) => !allowNegative && p.trackInventory && p.stockQty <= 0;
  return [...items].sort((a, b) => Number(out(a)) - Number(out(b)) || a.name.localeCompare(b.name));
}

// ---- keyboard-wedge scanner ----------------------------------------------------

/**
 * Scanners type a code very fast and press Enter. This keeps the characters
 * that arrived < gapMs apart; on Enter it returns the code when it looks like
 * a scan (≥ minLength fast characters), else null.
 */
export class ScanBurst {
  private chars = '';
  private last = 0;
  private startedAt = 0;
  constructor(private gapMs = 50, private minLength = 4) {}

  /** a printable key; returns true while a fast burst is building */
  push(char: string, now: number): boolean {
    if (this.chars && now - this.last > this.gapMs) this.chars = '';
    if (!this.chars) this.startedAt = now;
    this.chars += char;
    this.last = now;
    return this.chars.length >= 2;
  }

  /** Enter: the scanned code, or null when it was ordinary typing */
  enter(now: number): string | null {
    const code = this.chars;
    const fast = code.length >= this.minLength && now - this.last <= this.gapMs * 2;
    this.chars = '';
    return fast ? code : null;
  }

  /** how many characters the current burst holds (to undo them from a field) */
  get length(): number { return this.chars.length; }
  get since(): number { return this.startedAt; }
  reset(): void { this.chars = ''; }
}

// ---- keyboard shortcuts ----------------------------------------------------------

export type ShortcutAction =
  | 'focus-search' | 'camera' | 'pay-cash' | 'pay-transfer' | 'pay-card' | 'pay-other'
  | 'hold' | 'held' | 'complete' | 'qty-up' | 'qty-down' | 'remove-last' | 'escape' | 'help';

export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '/ or F2', action: 'Focus search' },
  { keys: 'F3', action: 'Open camera scanner' },
  { keys: 'F4 · F5 · F6 · F7', action: 'Cash · Transfer · POS card · Other' },
  { keys: 'F8', action: 'Hold sale' },
  { keys: 'F9', action: 'Held sales' },
  { keys: 'F10 or Ctrl+Enter', action: 'Complete sale' },
  { keys: '+ / −', action: 'Change quantity of the last item added' },
  { keys: 'Delete', action: 'Remove the last item added' },
  { keys: 'Esc', action: 'Close · clear search · twice to clear the sale' },
  { keys: '1 – 4', action: 'Quick-cash amounts (when no field is focused)' },
  { keys: '?', action: 'Show these shortcuts' },
];

/**
 * Which register action a key press means. `inSearch` = focus is in the
 * product search; `searchEmpty` = it has no text; `inField` = focus is in any
 * other text field. Returns null for ordinary typing.
 */
export function shortcutFor(e: KeyLike, ctx: { inSearch: boolean; searchEmpty: boolean; inField: boolean }): ShortcutAction | null {
  const { key } = e;
  if ((e.ctrlKey || e.metaKey) && key === 'Enter') return 'complete';
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (key) {
    case 'F2': return 'focus-search';
    case 'F3': return 'camera';
    case 'F4': return 'pay-cash';
    case 'F5': return 'pay-transfer';
    case 'F6': return 'pay-card';
    case 'F7': return 'pay-other';
    case 'F8': return 'hold';
    case 'F9': return 'held';
    case 'F10': return 'complete';
    case 'Escape': return 'escape';
  }
  const free = !ctx.inField && (!ctx.inSearch || ctx.searchEmpty);
  if (!free) return null;
  if (key === '/') return 'focus-search';
  if (key === '?') return 'help';
  if (key === '+' || key === '=') return 'qty-up';
  if (key === '-' || key === '_') return 'qty-down';
  if (key === 'Delete') return 'remove-last';
  return null;
}

// ---- feedback ----------------------------------------------------------------------

let audio: AudioContext | null = null;
/** A short beep after a scan (no sound file). Silent if audio isn't allowed. */
export function beep(ok = true): void {
  try {
    const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    audio ??= new Ctx();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = ok ? 1760 : 220;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(audio.destination);
    const t = audio.currentTime;
    osc.start(t);
    osc.stop(t + (ok ? 0.06 : 0.18));
  } catch { /* no audio */ }
}

export function buzz(ms = 30): void {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

// ---- per-device preferences ----------------------------------------------------------

export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(key); if (v && (allowed as readonly string[]).includes(v)) return v as T; } catch { /* storage blocked */ }
  return fallback;
}
export function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
