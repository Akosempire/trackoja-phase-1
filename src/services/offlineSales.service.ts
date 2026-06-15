// services/offlineSales.service.ts
// LocalStorage-backed queue for sales completed while offline. Each entry
// holds the exact payload CheckoutPage would have sent to SaleService.createSale;
// flushPendingSales replays them once connectivity returns.

import { SaleService } from './sale.service';
import type { CreateSaleRequest } from '../types';

export interface PendingSale {
  id: string;
  storeId: string;
  request: CreateSaleRequest;
  itemCount: number;
  total: number;
  createdAt: string;
}

const STORAGE_KEY = 'tk_pending_sales';
const listeners = new Set<() => void>();

function read(): PendingSale[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingSale[]) : [];
  } catch {
    return [];
  }
}

function write(sales: PendingSale[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
  listeners.forEach((listener) => listener());
}

export class OfflineSalesService {
  static subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  static getPendingSales(storeId?: string): PendingSale[] {
    const sales = read();
    return storeId ? sales.filter((s) => s.storeId === storeId) : sales;
  }

  static addPendingSale(storeId: string, request: CreateSaleRequest, itemCount: number, total: number): PendingSale {
    const entry: PendingSale = {
      id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      storeId,
      request,
      itemCount,
      total,
      createdAt: new Date().toISOString(),
    };
    write([...read(), entry]);
    return entry;
  }

  static removePendingSale(id: string) {
    write(read().filter((s) => s.id !== id));
  }

  /** Attempts to submit every queued sale for a store. Stops at the first failure so order is preserved. */
  static async flushPendingSales(storeId: string): Promise<{ synced: number; remaining: number }> {
    const pending = read();
    const ours = pending.filter((s) => s.storeId === storeId);
    let synced = 0;

    for (const sale of ours) {
      try {
        await SaleService.createSale(sale.storeId, sale.request);
        OfflineSalesService.removePendingSale(sale.id);
        synced++;
      } catch {
        break;
      }
    }

    return { synced, remaining: OfflineSalesService.getPendingSales(storeId).length };
  }
}

/** True if the error looks like a network failure rather than a server-side rejection. */
export function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /fetch|network/i.test(message);
}
