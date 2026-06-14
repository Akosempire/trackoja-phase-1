// services/inventory.service.ts
// Inventory movements (stock adjustment ledger) service

import { supabase } from '../config/supabase';
import type { InventoryMovement, AdjustStockRequest } from '../types';

export class InventoryService {
  /**
   * Record a stock movement. The database function apply_inventory_movement
   * atomically updates products.stock_qty and inserts the ledger row, and
   * enforces the inventory:adjust permission and negative-stock policy.
   */
  static async adjustStock(storeId: string, request: AdjustStockRequest): Promise<InventoryMovement> {
    try {
      const { data, error } = await supabase.rpc('apply_inventory_movement', {
        p_store_id: storeId,
        p_product_id: request.productId,
        p_movement_type: request.movementType,
        p_quantity: request.quantity,
        p_reason: request.reason ?? null,
        p_source_type: request.sourceType ?? null,
        p_source_id: request.sourceId ?? null,
      });

      if (error) throw error;
      if (!data) throw new Error('Failed to record stock movement');

      return this.mapMovementData(data);
    } catch (error) {
      console.error('Adjust stock error:', error);
      throw error;
    }
  }

  /**
   * Get movement history for a store, optionally filtered to one product.
   */
  static async getMovements(
    storeId: string,
    options?: { productId?: string; limit?: number }
  ): Promise<InventoryMovement[]> {
    try {
      let query = supabase
        .from('inventory_movements')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });

      if (options?.productId) {
        query = query.eq('product_id', options.productId);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data ? data.map((m) => this.mapMovementData(m)) : [];
    } catch (error) {
      console.error('Get movements error:', error);
      throw error;
    }
  }

  private static mapMovementData(data: any): InventoryMovement {
    return {
      id: data.id,
      storeId: data.store_id,
      productId: data.product_id,
      movementType: data.movement_type,
      quantity: Number(data.quantity),
      quantityBefore: Number(data.quantity_before),
      quantityAfter: Number(data.quantity_after),
      reason: data.reason,
      sourceType: data.source_type,
      sourceId: data.source_id,
      createdBy: data.created_by,
      createdAt: data.created_at,
    };
  }
}
