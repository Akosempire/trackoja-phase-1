/** Naira notes and coins for counting the drawer at close. */
export const NGN_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5] as const;

/** { 1000: 3, 500: 2 } → 4000. Ignores negatives and non-numbers. */
export function countTotal(counts: Record<number, number | string | undefined>): number {
  let total = 0;
  for (const d of NGN_DENOMINATIONS) {
    const n = Math.floor(Number(counts[d] ?? 0));
    if (Number.isFinite(n) && n > 0) total += n * d;
  }
  return total;
}

export type DifferenceTone = 'exact' | 'over' | 'short';
export function differenceTone(difference: number): DifferenceTone {
  if (Math.abs(difference) < 0.005) return 'exact';
  return difference > 0 ? 'over' : 'short';
}
