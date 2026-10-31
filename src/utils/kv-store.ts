/**
 * A tiny key-value store on IndexedDB (one database, one object store), with an
 * in-memory fallback when IndexedDB isn't available (private mode, tests). Used
 * for device caches only: losing it just means loading from the server again.
 */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function memoryKv(): KvStore {
  const m = new Map<string, unknown>();
  return {
    async get<T>(k: string) { return m.get(k) as T | undefined; },
    async set<T>(k: string, v: T) { m.set(k, structuredClone(v)); },
    async del(k: string) { m.delete(k); },
    async keys() { return [...m.keys()]; },
  };
}

const DB = 'trackoja-cache', STORE = 'kv';

export function indexedDbKv(): KvStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
    db().then((d) => new Promise<T>((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    }));
  return {
    get: <T>(k: string) => run<T | undefined>('readonly', (s) => s.get(k)),
    set: async <T>(k: string, v: T) => { await run('readwrite', (s) => s.put(v, k)); },
    del: async (k: string) => { await run('readwrite', (s) => s.delete(k)); },
    keys: async () => (await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String),
  };
}

let shared: KvStore | null = null;
/** The device store: IndexedDB when it works, otherwise memory for this tab. */
export function deviceKv(): KvStore {
  if (shared) return shared;
  const idb = indexedDbKv();
  if (!idb) return (shared = memoryKv());
  // fall back to memory for the rest of the session if IndexedDB errors (e.g. blocked)
  const mem = memoryKv();
  let broken = false;
  async function attempt<R>(primary: () => Promise<R>, fallback: () => Promise<R>): Promise<R> {
    if (broken) return fallback();
    try { return await primary(); } catch { broken = true; return fallback(); }
  }
  return (shared = {
    get: <T>(k: string) => attempt(() => idb.get<T>(k), () => mem.get<T>(k)),
    set: <T>(k: string, v: T) => attempt(() => idb.set<T>(k, v), () => mem.set<T>(k, v)),
    del: (k: string) => attempt(() => idb.del(k), () => mem.del(k)),
    keys: () => attempt(() => idb.keys(), () => mem.keys()),
  });
}
