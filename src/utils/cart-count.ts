import { useEffect, useState } from 'react';

/**
 * How many items are in the sale currently in progress.
 *
 * The cart itself lives in CheckoutPage, but the bottom navigation needs to show
 * the count while the cashier is elsewhere in the app - so the count is published
 * here rather than the cart being lifted into a context and re-rendering every page.
 * Only the number travels, never the lines.
 */

const KEY = 'trackoja_cart_count';
const EVENT = 'trackoja-cart-count-changed';

export function setCartCount(count: number): void {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  try {
    if (safe === getCartCount()) return;
    localStorage.setItem(KEY, String(safe));
  } catch {
    // Private mode or storage disabled: the badge is not worth failing a sale for.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getCartCount(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

/** Subscribes to the count, so the badge updates the moment the cart changes. */
export function useCartCount(): number {
  const [count, setCount] = useState<number>(() => getCartCount());

  useEffect(() => {
    const sync = () => setCount(getCartCount());
    window.addEventListener(EVENT, sync);
    // Another tab may have changed it.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return count;
}
