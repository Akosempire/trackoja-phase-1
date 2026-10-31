/**
 * One place for how stock movement types read on screen, capitalised the same
 * way everywhere ("Return", not "return"). Unknown types are tidied, never
 * shown raw.
 */
export const MOVEMENT_LABELS: Record<string, string> = {
  replenishment: 'Stock received',
  purchase: 'Purchase',
  adjustment: 'Count correction',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  sale: 'Sale',
  return: 'Return',
  refund: 'Refund',
  void: 'Sale voided',
};

export function movementLabel(type: string | null | undefined): string {
  const key = String(type ?? '').trim().toLowerCase();
  if (!key) return 'Movement';
  if (MOVEMENT_LABELS[key]) return MOVEMENT_LABELS[key];
  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
