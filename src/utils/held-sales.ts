/**
 * Held (parked) sales: a cart put aside so the cashier can serve the next
 * customer. Kept on this device only, per store, so it works offline. Nothing
 * here touches stock or money until the sale is resumed and completed.
 */
export interface HeldLine {
  /** productId, or productId:variantId for a size/colour (older held sales have no key) */
  key?: string; variantId?: string;
  productId: string; name: string; sku: string; unit: string;
  unitPrice: number; taxRate: number; quantity: number; trackInventory: boolean; stockQty: number;
}
export interface HeldSale {
  id: string;
  label: string;
  heldAt: string;
  lines: HeldLine[];
  customerId: string | null;
  customerName: string | null;
  discount: string;
  total: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const MAX_HELD = 20;
export const heldKey = (storeId: string) => `trackoja.held.${storeId}`;

function safeStorage(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readHeld(storeId: string, storage: Store | null = safeStorage()): HeldSale[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(heldKey(storeId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((h) => h && typeof h.id === 'string' && Array.isArray(h.lines)) : [];
  } catch { return []; }
}

function write(storeId: string, list: HeldSale[], storage: Store | null) {
  if (!storage) return;
  try { storage.setItem(heldKey(storeId), JSON.stringify(list.slice(0, MAX_HELD))); } catch { /* storage full or blocked */ }
  try { window.dispatchEvent(new CustomEvent('trackoja:held', { detail: { storeId } })); } catch { /* not in a browser */ }
}

export function holdSale(storeId: string, sale: Omit<HeldSale, 'id' | 'heldAt'>, storage: Store | null = safeStorage(), now = new Date()): HeldSale {
  const held: HeldSale = { ...sale, id: `h${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, heldAt: now.toISOString() };
  write(storeId, [held, ...readHeld(storeId, storage)], storage);
  return held;
}

/** Takes a held sale out of the list (to resume or discard it). */
export function takeHeld(storeId: string, id: string, storage: Store | null = safeStorage()): HeldSale | null {
  const list = readHeld(storeId, storage);
  const found = list.find((h) => h.id === id) ?? null;
  if (found) write(storeId, list.filter((h) => h.id !== id), storage);
  return found;
}

/** "Sale 3 · Mrs Bisi" style default name. */
export function defaultHeldLabel(count: number, customerName?: string | null): string {
  return customerName ? customerName : `Sale ${count + 1}`;
}
