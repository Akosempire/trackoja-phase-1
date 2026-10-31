/**
 * The register's product catalogue, cached on the device per signed-in user and
 * store (IndexedDB). The register draws from the cache at once and refreshes
 * from the server in the background, so it opens instantly and searches work
 * offline.
 *
 *   CatalogService.load(storeId, onData)  calls onData(cached) at once (if any), then onData(fresh)
 *   CatalogService.applySale(storeId, lines)  lowers cached stock right after a sale
 *   CatalogService.invalidate()  after product edits: the next load refreshes
 *   CatalogService.clearAll()  on sign-out or a different user signing in
 *
 * Cost prices stay in the cache only if the server returned them to this user
 * (the cache never adds data the API didn't give).
 */
import { supabase } from '../config/supabase';
import { ProductService } from './product.service';
import { CategoryService } from './category.service';
import { VariantService } from './variant.service';
import { deviceKv, type KvStore } from '../utils/kv-store';
import { clearCatalogStale, isCatalogStale, markCatalogStale } from '../utils/catalog-signals';
import type { Product, ProductCategory, ProductVariant } from '../types';

export interface Catalog {
  products: Product[];
  categories: ProductCategory[];
  variants: ProductVariant[];
  fetchedAt: number;
}
export interface CatalogMeta { fromCache: boolean; stale: boolean }

const PREFIX = 'catalog:v1:';
/** refresh in the background when the copy is older than this (or marked stale) */
export const REFRESH_AFTER_MS = 30_000;
/** never draw from a copy older than this: wait for the server instead */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let kv: KvStore = deviceKv();
const inflight = new Map<string, Promise<Catalog>>();

/** tests: swap the device store */
export function __setCatalogStore(store: KvStore): void { kv = store; clearCatalogStale(); inflight.clear(); }

export function catalogKey(userId: string, storeId: string): string { return `${PREFIX}${userId}:${storeId}`; }

/** Whether a cached copy should be used as-is, used then refreshed, or skipped. */
export function cachePolicy(fetchedAt: number | undefined, now: number, markedStale: boolean): 'skip' | 'use-and-refresh' | 'use' {
  if (!fetchedAt || now - fetchedAt > MAX_CACHE_AGE_MS || fetchedAt > now + 60_000) return 'skip';
  if (markedStale || now - fetchedAt > REFRESH_AFTER_MS) return 'use-and-refresh';
  return 'use';
}

async function currentUserId(): Promise<string | null> {
  try { const { data } = await supabase.auth.getSession(); return data.session?.user?.id ?? null; } catch { return null; }
}

async function fetchCatalog(storeId: string): Promise<Catalog> {
  const [products, categories, variants] = await Promise.all([
    ProductService.getProducts(storeId, { status: 'active' }),
    CategoryService.getCategories(storeId).catch(() => [] as ProductCategory[]),
    VariantService.forStore(storeId).catch(() => [] as ProductVariant[]),
  ]);
  return { products, categories, variants, fetchedAt: Date.now() };
}

export class CatalogService {
  static async cached(storeId: string, userId?: string | null, now = Date.now()): Promise<Catalog | null> {
    const uid = userId ?? (await currentUserId());
    if (!uid) return null;
    const c = await kv.get<Catalog>(catalogKey(uid, storeId)).catch(() => undefined);
    return c && cachePolicy(c.fetchedAt, now, false) !== 'skip' ? c : null;
  }

  /** Fetch from the server and store (one request at a time per store). */
  static async refresh(storeId: string, userId?: string | null): Promise<Catalog> {
    const uid = userId ?? (await currentUserId());
    const key = `${uid}:${storeId}`;
    const running = inflight.get(key);
    if (running) return running;
    const p = fetchCatalog(storeId).then(async (c) => {
      if (uid) await kv.set(catalogKey(uid, storeId), c).catch(() => undefined);
      return c;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /**
   * Cached copy first (if any), then the fresh one. Resolves when the fresh one
   * has arrived; if the server can't be reached and a cached copy was shown,
   * resolves quietly (the register keeps working offline).
   */
  static async load(storeId: string, onData: (c: Catalog, meta: CatalogMeta) => void, now = Date.now()): Promise<void> {
    const uid = await currentUserId();
    const c = uid ? await kv.get<Catalog>(catalogKey(uid, storeId)).catch(() => undefined) : undefined;
    const policy = cachePolicy(c?.fetchedAt, now, isCatalogStale(storeId));
    if (c && policy !== 'skip') onData(c, { fromCache: true, stale: policy === 'use-and-refresh' });
    if (c && policy === 'use') return;
    try {
      const fresh = await CatalogService.refresh(storeId, uid);
      clearCatalogStale(storeId);
      onData(fresh, { fromCache: false, stale: false });
    } catch (error) {
      if (!c || policy === 'skip') throw error;
    }
  }

  /** Lower cached stock for what was just sold, so the next sale sees it at once. */
  static async applySale(storeId: string, lines: Array<{ productId: string; variantId?: string | null; quantity: number }>): Promise<void> {
    const uid = await currentUserId();
    if (!uid) return;
    const key = catalogKey(uid, storeId);
    const c = await kv.get<Catalog>(key).catch(() => undefined);
    if (!c) return;
    const sold = new Map<string, number>(), soldV = new Map<string, number>();
    for (const l of lines) {
      sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.quantity);
      if (l.variantId) soldV.set(l.variantId, (soldV.get(l.variantId) ?? 0) + l.quantity);
    }
    const products = c.products.map((p) => (sold.has(p.id) && p.trackInventory ? { ...p, stockQty: p.stockQty - sold.get(p.id)! } : p));
    const variants = c.variants.map((v) => (soldV.has(v.id) ? { ...v, stockQty: v.stockQty - soldV.get(v.id)! } : v));
    await kv.set(key, { ...c, products, variants }).catch(() => undefined);
    markCatalogStale(storeId);
  }

  /** After a product is added, edited or removed: the next load refreshes. */
  static invalidate(storeId?: string): void { markCatalogStale(storeId); }

  /** Remove every cached catalogue on this device (sign-out, user change). */
  static async clearAll(): Promise<void> {
    clearCatalogStale(); inflight.clear();
    const keys = await kv.keys().catch(() => [] as string[]);
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((k) => kv.del(k).catch(() => undefined)));
  }
}
