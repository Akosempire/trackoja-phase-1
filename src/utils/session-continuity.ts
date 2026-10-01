import type { EntryResolution } from '../services/entry.service';
const PREFIX = 'trackoja:resume:';
const id = '[0-9a-fA-F-]{36}';
const validPath = new RegExp(`^/(dashboard|inventory/(products(?:/(new|bulk-import|${id}))?|categories|stock|lots)|sales(?:/(checkout|history|${id}))?|customers(?:/(new|${id}(?:/edit)?))?|payments(?:/(reconciliation|transactions/${id}))?|jobs|expenses|devices(?:/${id})?|staff|reports|billing|more|settings(?:/payments/moniepoint)?|support|kitchen|pharmacy/expiry|activity|platform(?:/(businesses(?:/${id})?|billing|activation|support|integrations|health|developer|audit|settings))?)$`);
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://trackoja.invalid');
    if (url.origin !== 'https://trackoja.invalid' || !validPath.test(url.pathname) || /%2f|%5c/i.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
export function clearRestoration() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try { const storage = window[name]; Object.keys(storage).filter(key => key.startsWith(PREFIX)).forEach(key => storage.removeItem(key)); } catch { /* Optional storage. */ }
  }
}
export function rememberRoute(userId: string, orgId: string | undefined, storeId: string | undefined, route: string) {
  const safe = safeReturnPath(route); if (!safe) return;
  const url = new URL(safe, 'https://trackoja.invalid');
  for (const key of [...url.searchParams.keys()]) if (!['status','category','categoryId','period','from','to','page','tab'].includes(key)) url.searchParams.delete(key);
  try { localStorage.setItem(PREFIX + userId, JSON.stringify({ route: url.pathname + url.search, orgId, storeId, at: Date.now() })); } catch { /* Private mode. */ }
}
export function restoredRoute(userId: string, entry: EntryResolution): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFIX + userId) ?? 'null');
    if (!saved || Date.now() - saved.at > 86400000 || saved.orgId !== (entry.currentOrgId ?? undefined) || saved.storeId !== (entry.currentStoreId ?? undefined)) return null;
    return allowedReturn(saved.route, entry);
  } catch { return null; }
}
export function allowedReturn(value: string | null, entry: EntryResolution): string | null {
  const path = safeReturnPath(value); if (!path) return null;
  if (path.startsWith('/platform')) return entry.kind === 'platform_admin' ? path : null;
  const destination = entry.kind === 'platform_admin' ? entry.merchantDestination : entry.destination;
  return destination === '/dashboard' && entry.hasAccess ? path : path === '/billing' && destination === '/billing' ? path : null;
}
export function withTimeout<T>(promise: PromiseLike<T>, milliseconds = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The connection is taking too long. Check your connection and try again.')), milliseconds);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
