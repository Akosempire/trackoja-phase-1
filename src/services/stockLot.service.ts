// Stock lots: fabric rolls, pharmacy batches, electronics serials, plain bulk.
//
// House conventions: static methods that THROW (never return { data, error }),
// snake_case rows mapped to camelCase by a private mapper, and
// supabase.rpc('name', { p_arg }) with p_-prefixed arguments.

import { supabase } from '../config/supabase';

export type StockLotType = 'batch' | 'roll' | 'serial' | 'bulk';
export type StockLotStatus = 'available' | 'quarantined' | 'expired' | 'depleted' | 'written_off';

export interface StockLot {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  productUnit: string;
  variantId: string | null;
  lotType: StockLotType;
  identifier: string | null;
  unitOfMeasure: string;
  qtyReceived: number;
  qtyAvailable: number;
  costPerUnit: number | null;
  expiryDate: string | null;
  status: StockLotStatus;
  receivedAt: string | null;
}

export interface ReceiveStockInput {
  storeId: string;
  productId: string;
  lotType: StockLotType;
  quantity: number;
  unitOfMeasure?: string | null;
  identifier?: string | null;
  expiryDate?: string | null;
  costPerUnit?: number | null;
  sellingPricePerUnit?: number | null;
  notes?: string | null;
}

export class StockLotService {
  /** Every lot for a store, newest first, with the product it belongs to. */
  static async listLots(storeId: string): Promise<StockLot[]> {
    try {
      const { data, error } = await supabase
        .from('stock_lots')
        .select('*, product:products(name, unit)')
        .eq('store_id', storeId)
        .order('received_at', { ascending: false });

      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        id: row.id,
        storeId: row.store_id,
        productId: row.product_id,
        productName: row.product?.name ?? 'Unknown product',
        productUnit: row.product?.unit ?? 'piece',
        variantId: row.variant_id,
        lotType: row.lot_type,
        identifier: row.identifier,
        unitOfMeasure: row.unit_of_measure,
        qtyReceived: Number(row.qty_received ?? 0),
        qtyAvailable: Number(row.qty_available ?? 0),
        costPerUnit: row.cost_per_unit === null ? null : Number(row.cost_per_unit),
        expiryDate: row.expiry_date,
        status: row.status,
        receivedAt: row.received_at,
      }));
    } catch (error) {
      console.error('List stock lots error:', error);
      throw error;
    }
  }

  /**
   * Receive stock into a lot. The database validates the rules that matter per
   * business type: a serialized unit is exactly one indivisible thing with a
   * serial/IMEI, a batch or roll must be identified, and the unit is taken from
   * the product when not supplied.
   */
  static async receiveLot(input: ReceiveStockInput): Promise<StockLot> {
    try {
      const { data, error } = await supabase.rpc('receive_stock_lot', {
        p_store_id: input.storeId,
        p_product_id: input.productId,
        p_lot_type: input.lotType,
        p_quantity: input.quantity,
        p_unit_of_measure: input.unitOfMeasure ?? null,
        p_identifier: input.identifier ?? null,
        p_expiry_date: input.expiryDate ?? null,
        p_cost_per_unit: input.costPerUnit ?? null,
        p_selling_price_per_unit: input.sellingPricePerUnit ?? null,
        p_variant_id: null,
        p_supplier_id: null,
        p_notes: input.notes ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to receive stock');

      return {
        id: data.id,
        storeId: data.store_id,
        productId: data.product_id,
        productName: '',
        productUnit: data.unit_of_measure,
        variantId: data.variant_id,
        lotType: data.lot_type,
        identifier: data.identifier,
        unitOfMeasure: data.unit_of_measure,
        qtyReceived: Number(data.qty_received ?? 0),
        qtyAvailable: Number(data.qty_available ?? 0),
        costPerUnit: data.cost_per_unit === null ? null : Number(data.cost_per_unit),
        expiryDate: data.expiry_date,
        status: data.status,
        receivedAt: data.received_at,
      };
    } catch (error) {
      console.error('Receive stock lot error:', error);
      throw error;
    }
  }

  /**
   * Quarantine, write off, or return stock to available. A reason is mandatory and
   * is enforced by the function, not by this call site.
   */
  static async adjustLot(lotId: string, newStatus: StockLotStatus, reason: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('adjust_stock_lot', {
        p_lot_id: lotId,
        p_new_status: newStatus,
        p_reason: reason,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Adjust stock lot error:', error);
      throw error;
    }
  }

  /**
   * Stamp past-expiry available stock as expired. Safe to call on opening the
   * screen; the sale path cannot do this itself because a refusal raises and would
   * roll back its own write.
   */
  static async sweepExpired(storeId: string): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('sweep_expired_lots', {
        p_store_id: storeId,
      });
      if (error) throw error;
      return Number(data ?? 0);
    } catch (error) {
      console.error('Sweep expired lots error:', error);
      throw error;
    }
  }
}
