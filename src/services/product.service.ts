// services/product.service.ts
// Product catalog management service

import { supabase } from '../config/supabase';
import type { Product, CreateProductRequest, UpdateProductRequest } from '../types';
import { markCatalogStale } from '../utils/catalog-signals';

export interface ProductFilters {
  categoryId?: string;
  status?: 'active' | 'inactive' | 'archived';
  search?: string;
  lowStockOnly?: boolean;
}

/**
 * Every product column except cost_price. Cost prices are private to people
 * with cost:view (owners, managers, inventory officers): the database refuses
 * the column to everyone else, so it is fetched separately with
 * get_product_costs and merged in. A cashier's products have costPrice 0.
 */
export const PRODUCT_COLUMNS = 'id, store_id, category_id, name, sku, barcode, description, unit, selling_price, tax_rate, track_inventory, stock_qty, reorder_level, image_url, status, created_by, created_at, updated_at, attributes, variant_options';

/** Cost prices this person may see, by product id (empty when they may not). */
async function costsFor(storeId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('get_product_costs', { p_store_id: storeId });
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as Array<{ product_id: string; cost_price: number | string }>).map((r) => [r.product_id, Number(r.cost_price)]));
}

export class ProductService {
  /**
   * Create a new product
   */
  static async createProduct(
    storeId: string,
    userId: string,
    request: CreateProductRequest
  ): Promise<Product> {
    markCatalogStale(); // the register's cached catalogue refreshes next time
    try {
      const { data, error } = await supabase
        .from('products')
        .insert(this.toInsertRow(storeId, userId, request))
        .select(PRODUCT_COLUMNS)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to create product');

      return { ...this.mapProductData(data), costPrice: request.costPrice ?? 0 };
    } catch (error) {
      console.error('Create product error:', error);
      throw error;
    }
  }

  /**
   * Create many products in a single insert (used by bulk import)
   */
  static async bulkCreateProducts(
    storeId: string,
    userId: string,
    requests: CreateProductRequest[]
  ): Promise<Product[]> {
    markCatalogStale(); // the register's cached catalogue refreshes next time
    try {
      const rows = requests.map((request) => this.toInsertRow(storeId, userId, request));

      const { data, error } = await supabase.from('products').insert(rows).select(PRODUCT_COLUMNS);

      if (error) throw error;
      return data ? data.map((p) => this.mapProductData(p)) : [];
    } catch (error) {
      console.error('Bulk create products error:', error);
      throw error;
    }
  }

  private static toInsertRow(storeId: string, userId: string, request: CreateProductRequest) {
    return {
      store_id: storeId,
      category_id: request.categoryId,
      name: request.name,
      sku: request.sku,
      barcode: request.barcode,
      description: request.description,
      unit: request.unit ?? 'pcs',
      cost_price: request.costPrice ?? 0,
      selling_price: request.sellingPrice,
      tax_rate: request.taxRate ?? 0,
      track_inventory: request.trackInventory ?? true,
      stock_qty: request.stockQty ?? 0,
      reorder_level: request.reorderLevel ?? 0,
      image_url: request.imageUrl,
      attributes: request.attributes ?? {},
      created_by: userId,
    };
  }

  /**
   * List products for a store, with optional filters
   */
  static async getProducts(storeId: string, filters?: ProductFilters): Promise<Product[]> {
    try {
      const costs = costsFor(storeId);
      let query = supabase.from('products').select(PRODUCT_COLUMNS).eq('store_id', storeId);

      if (filters?.categoryId) {
        query = query.eq('category_id', filters.categoryId);
      }

      if (filters?.status) {
        query = query.eq('status', filters.status);
      } else {
        query = query.neq('status', 'archived');
      }

      if (filters?.search) {
        query = query.or(`name.ilike.%${filters.search}%,sku.ilike.%${filters.search}%,barcode.ilike.%${filters.search}%`);
      }

      query = query.order('name', { ascending: true });

      const { data, error } = await query;

      if (error) throw error;
      const cost = await costs;
      let products = data ? data.map((p) => ({ ...this.mapProductData(p), costPrice: cost.get((p as { id: string }).id) ?? 0 })) : [];

      if (filters?.lowStockOnly) {
        products = products.filter((p) => p.trackInventory && p.stockQty <= p.reorderLevel);
      }

      return products;
    } catch (error) {
      console.error('Get products error:', error);
      throw error;
    }
  }

  /**
   * Get a single product
   */
  static async getProduct(productId: string): Promise<Product> {
    try {
      const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).eq('id', productId).single();

      if (error) throw error;
      if (!data) throw new Error('Product not found');

      const cost = await costsFor((data as { store_id: string }).store_id);
      return { ...this.mapProductData(data), costPrice: cost.get(productId) ?? 0 };
    } catch (error) {
      console.error('Get product error:', error);
      throw error;
    }
  }

  /**
   * Update a product. stock_qty cannot be set here - use InventoryService.adjustStock.
   */
  static async updateProduct(productId: string, request: UpdateProductRequest): Promise<Product> {
    markCatalogStale(); // the register's cached catalogue refreshes next time
    try {
      const updates: Record<string, unknown> = {};
      if (request.name !== undefined) updates.name = request.name;
      if (request.sku !== undefined) updates.sku = request.sku;
      if (request.barcode !== undefined) updates.barcode = request.barcode;
      if (request.description !== undefined) updates.description = request.description;
      if (request.categoryId !== undefined) updates.category_id = request.categoryId;
      if (request.unit !== undefined) updates.unit = request.unit;
      if (request.costPrice !== undefined) updates.cost_price = request.costPrice;
      if (request.sellingPrice !== undefined) updates.selling_price = request.sellingPrice;
      if (request.taxRate !== undefined) updates.tax_rate = request.taxRate;
      if (request.trackInventory !== undefined) updates.track_inventory = request.trackInventory;
      if (request.reorderLevel !== undefined) updates.reorder_level = request.reorderLevel;
      if (request.imageUrl !== undefined) updates.image_url = request.imageUrl;
      if (request.status !== undefined) updates.status = request.status;
      if (request.attributes !== undefined) updates.attributes = request.attributes;

      const { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', productId)
        .select(PRODUCT_COLUMNS)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to update product');

      const cost = await costsFor((data as { store_id: string }).store_id);
      return { ...this.mapProductData(data), costPrice: cost.get(productId) ?? request.costPrice ?? 0 };
    } catch (error) {
      console.error('Update product error:', error);
      throw error;
    }
  }

  /**
   * Archive a product (hides it from active catalog views without deleting history)
   */
  static async archiveProduct(productId: string): Promise<Product> {
    markCatalogStale(); // the register's cached catalogue refreshes next time
    return this.updateProduct(productId, { status: 'archived' });
  }

  /**
   * Permanently delete a product
   */
  static async deleteProduct(productId: string): Promise<void> {
    markCatalogStale(); // the register's cached catalogue refreshes next time
    try {
      const { error } = await supabase.from('products').delete().eq('id', productId);

      if (error) throw error;
    } catch (error) {
      console.error('Delete product error:', error);
      throw error;
    }
  }

  /** Pin / unpin a quick-sell product on the register (owners and managers). */
  static async setFavourite(productId: string, favourite: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_product_favourite', { p_product_id: productId, p_favourite: favourite });
    if (error) throw new Error(error.message?.replace(/^.*?ERROR:\s*/, '') || 'Could not pin the product');
  }

  private static mapProductData(data: any): Product {
    return {
      id: data.id,
      storeId: data.store_id,
      categoryId: data.category_id,
      name: data.name,
      sku: data.sku,
      barcode: data.barcode,
      description: data.description,
      unit: data.unit,
      costPrice: Number(data.cost_price ?? 0),
      sellingPrice: Number(data.selling_price),
      taxRate: Number(data.tax_rate),
      trackInventory: data.track_inventory,
      stockQty: Number(data.stock_qty),
      reorderLevel: Number(data.reorder_level),
      imageUrl: data.image_url,
      attributes: data.attributes ?? {},
      variantOptions: Array.isArray(data.variant_options) ? data.variant_options : [],
      isFavourite: Boolean(data.is_favourite),
      status: data.status,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}
