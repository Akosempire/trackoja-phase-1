import { supabase } from '../config/supabase';
import type { ProductVariant } from '../types';
import type { VariantDraft, VariantOption } from '../utils/variants';

/** Sizes/colours (product_variants) and label barcodes. */
const map = (r: Record<string, any>): ProductVariant => ({
  id: r.id, productId: r.product_id, size: r.size ?? null, colour: r.colour ?? null, sku: r.sku ?? null, barcode: r.barcode ?? null,
  sellingPrice: r.selling_price === null || r.selling_price === undefined ? null : Number(r.selling_price), stockQty: Number(r.stock_qty ?? 0),
});
const COLS = 'id, product_id, size, colour, sku, barcode, selling_price, stock_qty';

export class VariantService {
  /** Active variants of one product, in a stable order. */
  static async forProduct(productId: string): Promise<ProductVariant[]> {
    const { data, error } = await supabase.from('product_variants').select(COLS).eq('product_id', productId).eq('status', 'active').order('size').order('colour');
    if (error) throw error;
    return (data ?? []).map(map);
  }

  /** Every active variant in the store (checkout: scanning and picking). */
  static async forStore(storeId: string): Promise<ProductVariant[]> {
    const { data, error } = await supabase.from('product_variants').select(COLS).eq('store_id', storeId).eq('status', 'active').limit(5000);
    if (error) throw error;
    return (data ?? []).map(map);
  }

  static async save(productId: string, options: VariantOption[], variants: VariantDraft[]): Promise<number> {
    const { data, error } = await supabase.rpc('save_product_variants', {
      p_product_id: productId,
      p_options: options.filter((o) => o.values.length > 0),
      p_variants: variants.map((v) => ({ size: v.size, colour: v.colour, sku: v.sku, barcode: v.barcode, price: v.price.trim() === '' ? null : Number(v.price), stock: Number(v.stock || 0) })),
    });
    if (error) throw error;
    return Number((data as { variants?: number })?.variants ?? 0);
  }

  /** Makes sure each product has a barcode for its label (from the SKU when it has none). */
  static async ensureBarcodes(productIds: string[]): Promise<Record<string, string>> {
    if (!productIds.length) return {};
    const { data, error } = await supabase.rpc('ensure_product_barcodes', { p_product_ids: productIds });
    if (error) throw error;
    return Object.fromEntries(((data ?? []) as { id: string; barcode: string }[]).map((r) => [r.id, r.barcode]));
  }

  static async logReminder(customerId: string): Promise<void> {
    const { error } = await supabase.rpc('log_credit_reminder', { p_customer_id: customerId, p_channel: 'whatsapp' });
    if (error) throw error;
  }
}
