/**
 * After the app has loaded, quietly download the other screens one by one so
 * opening them later is instant. Skipped on data-saver and slow (2G) networks,
 * and stops if the tab is hidden. Same files the router loads, so nothing is
 * downloaded twice.
 */
const pages = import.meta.glob(['../pages/**/*.tsx', '!../pages/landing/**', '!../pages/auth/**', '!../pages/legal/**', '!../pages/platform/**']);

let started = false;
export function prefetchPages(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return;
  const queue = Object.values(pages);
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const idle = (fn: () => void) => (ric ? ric(fn, { timeout: 3000 }) : window.setTimeout(fn, 400));
  const next = () => {
    if (!queue.length || document.visibilityState === 'hidden') return;
    const load = queue.shift()!;
    load().catch(() => undefined).finally(() => idle(next));
  };
  window.setTimeout(() => idle(next), 2500);
}
