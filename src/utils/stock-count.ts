/**
 * Count correction: the person says how many they counted, the app works out
 * the change. Quantities can be decimals (kg, metres); results are rounded to
 * 3 places like the database (NUMERIC(14,3)).
 */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type CountCheck =
  | { ok: true; system: number; counted: number; difference: number }
  | { ok: false; error: string };

export function countCorrection(systemQty: number, countedInput: string | number): CountCheck {
  const raw = typeof countedInput === 'number' ? String(countedInput) : countedInput.trim();
  if (raw === '') return { ok: false, error: 'Enter how many you counted' };
  const counted = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(counted)) return { ok: false, error: 'Enter a number' };
  if (counted < 0) return { ok: false, error: "The count can't be below zero" };
  const system = round3(Number(systemQty) || 0);
  const c = round3(counted);
  const difference = round3(c - system);
  if (difference === 0) return { ok: false, error: 'That matches the system count. Nothing to change.' };
  return { ok: true, system, counted: c, difference };
}

const fmt = (n: number) => n.toLocaleString('en-NG', { maximumFractionDigits: 3 });

/** "System: 5 → Counted: 3 = −2" (uses a real minus sign) */
export function countSummary(system: number, counted: number): string {
  const d = round3(counted - system);
  const signed = d > 0 ? `+${fmt(d)}` : d < 0 ? `−${fmt(Math.abs(d))}` : '0';
  return `System: ${fmt(system)} → Counted: ${fmt(counted)} = ${signed}`;
}
