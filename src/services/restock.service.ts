import { supabase } from '../config/supabase';

/**
 * Suppliers, deliveries, stock counts, branch transfers and low stock.
 * Every call is a database function that checks permissions itself
 * (20261030002001_restock_counts_transfers.sql).
 */
export interface SupplierBalance {
  id: string; name: string; contactName: string | null; phone: string | null; email: string | null;
  address: string | null; paymentTerms: string | null; notes: string | null; status: 'active' | 'inactive';
  purchaseCount: number; purchasedTotal: number | null; paidTotal: number | null; owed: number | null; lastPurchaseOn: string | null;
}
export interface PurchaseRow {
  id: string; reference: string | null; purchasedOn: string; total: number; amountPaid: number; owed: number;
  supplierId: string | null; supplierName: string | null; lineCount: number; recordedBy: string | null;
}
export interface PurchaseDetail {
  purchase: { id: string; reference: string | null; purchased_on: string; total: number; amount_paid: number; owed: number; supplier_id: string | null; supplier_name: string | null; payment_method: string | null; notes: string | null };
  items: Array<{ id: string; product_id: string; name: string; sku: string | null; quantity: number; unit_cost: number; line_total: number; lot_identifier: string | null; unit: string | null }>;
  payments: Array<{ id: string; amount: number; paid_on: string; method: string | null; reference: string | null; notes: string | null }>;
}
export interface StockCount { id: string; storeId: string; scopeLabel: string; status: 'open' | 'applied' | 'cancelled'; startedAt: string; finishedAt: string | null }
export interface StockCountLine { productId: string; name: string; sku: string; barcode: string | null; unit: string; expected: number; counted: number | null; unitCost: number }
export interface TransferRow {
  id: string; direction: 'in' | 'out'; status: 'in_transit' | 'received' | 'cancelled'; otherBranch: string;
  lineCount: number; unitsSent: number; unitsReceived: number | null; value: number; notes: string | null; sentAt: string; receivedAt: string | null;
}
export interface TransferDetail {
  transfer: { id: string; from_store_id: string; to_store_id: string; from_name: string; to_name: string; status: TransferRow['status']; notes: string | null; sent_at: string; received_at: string | null };
  lines: Array<{ id: string; product_name: string; sku: string; unit: string; unit_cost: number; quantity_sent: number; quantity_received: number | null }>;
}
export interface LowStockRow {
  productId: string; name: string; sku: string; unit: string; stockQty: number; reorderLevel: number; suggestedQty: number;
  lastUnitCost: number; supplierId: string | null; supplierName: string | null; lastPurchasedOn: string | null;
}
export interface ReceiveLine { productId: string; quantity: number; unitCost: number; lotType?: 'batch'; identifier?: string; expiryDate?: string }

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || 'Something went wrong');
  return data as T;
}

/** Hand-off from Low stock → Receive stock ("Reorder"). */
export const REORDER_KEY = 'trackoja.reorder';

export class RestockService {
  static async suppliers(storeId: string, includeInactive = false): Promise<SupplierBalance[]> {
    const rows = await rpc<any[]>('list_supplier_balances', { p_store_id: storeId, p_include_inactive: includeInactive });
    return (rows ?? []).map((r) => ({
      id: r.id, name: r.name, contactName: r.contact_name, phone: r.phone, email: r.email, address: r.address,
      paymentTerms: r.payment_terms, notes: r.notes, status: r.status, purchaseCount: Number(r.purchase_count ?? 0),
      purchasedTotal: num(r.purchased_total), paidTotal: num(r.paid_total), owed: num(r.owed), lastPurchaseOn: r.last_purchase_on,
    }));
  }
  static async saveSupplier(storeId: string, s: { id?: string; name: string; contactName?: string; phone?: string; email?: string; address?: string; paymentTerms?: string; notes?: string; status?: 'active' | 'inactive' }): Promise<string> {
    if (s.id) {
      const row = await rpc<{ id: string }>('update_supplier', {
        p_supplier_id: s.id, p_name: s.name, p_contact_name: s.contactName ?? '', p_phone: s.phone ?? '', p_email: s.email ?? '',
        p_address: s.address ?? '', p_payment_terms: s.paymentTerms ?? '', p_status: s.status ?? null, p_notes: s.notes ?? '',
      });
      return row.id;
    }
    const row = await rpc<{ id: string }>('create_supplier', {
      p_store_id: storeId, p_name: s.name, p_contact_name: s.contactName || null, p_phone: s.phone || null, p_email: s.email || null,
      p_address: s.address || null, p_payment_terms: s.paymentTerms || null, p_notes: s.notes || null,
    });
    return row.id;
  }
  static async purchases(storeId: string, supplierId?: string): Promise<PurchaseRow[]> {
    const rows = await rpc<any[]>('list_purchase_history', { p_store_id: storeId, p_supplier_id: supplierId ?? null, p_limit: 200 });
    return (rows ?? []).map((r) => ({
      id: r.id, reference: r.reference, purchasedOn: r.purchased_on, total: Number(r.total), amountPaid: Number(r.amount_paid),
      owed: Number(r.owed), supplierId: r.supplier_id, supplierName: r.supplier_name, lineCount: Number(r.line_count), recordedBy: r.recorded_by_name,
    }));
  }
  static async purchase(id: string): Promise<PurchaseDetail> {
    return rpc<PurchaseDetail>('get_purchase_detail', { p_purchase_id: id });
  }
  static async receive(storeId: string, input: { lines: ReceiveLine[]; supplierId: string | null; date?: string; method: string; reference?: string; notes?: string; amountPaid: number }): Promise<string> {
    const row = await rpc<{ id: string }>('receive_purchase', {
      p_store_id: storeId, p_items: input.lines, p_supplier_id: input.supplierId, p_purchased_on: input.date || null,
      p_payment_method: input.method, p_reference: input.reference || null, p_notes: input.notes || null, p_amount_paid: input.amountPaid,
    });
    return row.id;
  }
  static async paySupplier(storeId: string, input: { supplierId: string; amount: number; purchaseId?: string | null; method: string; reference?: string; date?: string }): Promise<number> {
    return Number(await rpc('record_supplier_payment', {
      p_store_id: storeId, p_supplier_id: input.supplierId, p_amount: input.amount, p_purchase_id: input.purchaseId ?? null,
      p_payment_method: input.method, p_reference: input.reference || null, p_paid_on: input.date || null, p_notes: null,
    }));
  }

  // ---- stock counts ----
  static async openCount(storeId: string): Promise<StockCount | null> {
    const { data, error } = await supabase.from('stock_counts').select('*').eq('store_id', storeId).eq('status', 'open').maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapCount(data) : null;
  }
  static async pastCounts(storeId: string): Promise<StockCount[]> {
    const { data, error } = await supabase.from('stock_counts').select('*').eq('store_id', storeId).neq('status', 'open').order('started_at', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapCount);
  }
  static async startCount(storeId: string, categoryId?: string | null): Promise<StockCount> {
    return mapCount(await rpc<any>('start_stock_count', { p_store_id: storeId, p_category_id: categoryId || null }));
  }
  static async countLines(countId: string): Promise<StockCountLine[]> {
    const { data, error } = await supabase.from('stock_count_lines')
      .select('product_id, expected_qty, counted_qty, products(name, sku, barcode, unit)').eq('count_id', countId);
    if (error) throw new Error(error.message);
    // unit costs only for people with cost:view (value impact shows 0 otherwise)
    const { data: costRows } = await supabase.rpc('get_stock_count_costs', { p_count_id: countId });
    const costs = new Map(((costRows ?? []) as Array<{ product_id: string; unit_cost: number | string }>).map((c) => [c.product_id, Number(c.unit_cost)]));
    return (data ?? []).map((r: any) => ({
      productId: r.product_id, name: r.products?.name ?? 'Product', sku: r.products?.sku ?? '', barcode: r.products?.barcode ?? null,
      unit: r.products?.unit ?? 'pcs', expected: Number(r.expected_qty), counted: num(r.counted_qty), unitCost: costs.get(r.product_id) ?? 0,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  static async setCounted(countId: string, productId: string, counted: number | null): Promise<void> {
    await rpc('set_stock_count_line', { p_count_id: countId, p_product_id: productId, p_counted: counted });
  }
  static async applyCount(countId: string): Promise<{ changed: number; value_change: number }> {
    return rpc('apply_stock_count', { p_count_id: countId });
  }
  static async cancelCount(countId: string): Promise<void> {
    await rpc('cancel_stock_count', { p_count_id: countId });
  }

  // ---- transfers ----
  static async branches(storeId: string): Promise<Array<{ id: string; name: string }>> {
    return (await rpc<any[]>('list_transfer_branches', { p_store_id: storeId })) ?? [];
  }
  static async transfers(storeId: string): Promise<TransferRow[]> {
    const rows = await rpc<any[]>('list_stock_transfers', { p_store_id: storeId });
    return (rows ?? []).map((r) => ({
      id: r.id, direction: r.direction, status: r.status, otherBranch: r.other_branch ?? 'Another branch', lineCount: Number(r.line_count),
      unitsSent: Number(r.units_sent), unitsReceived: num(r.units_received), value: Number(r.value), notes: r.notes, sentAt: r.sent_at, receivedAt: r.received_at,
    }));
  }
  static async transfer(id: string): Promise<TransferDetail> {
    return rpc<TransferDetail>('get_stock_transfer', { p_transfer_id: id });
  }
  static async sendTransfer(fromStoreId: string, toStoreId: string, lines: Array<{ productId: string; quantity: number }>, notes?: string): Promise<string> {
    return (await rpc<{ id: string }>('send_stock_transfer', { p_from_store_id: fromStoreId, p_to_store_id: toStoreId, p_lines: lines, p_notes: notes || null })).id;
  }
  static async receiveTransfer(id: string, lines: Array<{ lineId: string; quantityReceived: number }>): Promise<void> {
    await rpc('receive_stock_transfer', { p_transfer_id: id, p_lines: lines });
  }
  static async cancelTransfer(id: string): Promise<void> {
    await rpc('cancel_stock_transfer', { p_transfer_id: id });
  }

  // ---- low stock ----
  static async lowStock(storeId: string): Promise<LowStockRow[]> {
    const rows = await rpc<any[]>('list_low_stock', { p_store_id: storeId });
    return (rows ?? []).map((r) => ({
      productId: r.product_id, name: r.name, sku: r.sku, unit: r.unit, stockQty: Number(r.stock_qty), reorderLevel: Number(r.reorder_level),
      suggestedQty: Number(r.suggested_qty), lastUnitCost: Number(r.last_unit_cost ?? 0), supplierId: r.supplier_id, supplierName: r.supplier_name, lastPurchasedOn: r.last_purchased_on,
    }));
  }
}

function mapCount(r: any): StockCount {
  return { id: r.id, storeId: r.store_id, scopeLabel: r.scope_label, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at };
}
