/**
 * "The product catalogue changed": product edits mark it stale here, and the
 * register's catalogue cache (services/catalog.service.ts) refreshes on its next
 * load. Separate module so ProductService can signal without importing the cache.
 */
let all = false;
const stores = new Set<string>();
export function markCatalogStale(storeId?: string): void { if (storeId) stores.add(storeId); else all = true; }
export function isCatalogStale(storeId: string): boolean { return all || stores.has(storeId); }
export function clearCatalogStale(storeId?: string): void { if (storeId) stores.delete(storeId); else { all = false; stores.clear(); } }
