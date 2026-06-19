// services/product.service.ts
// Product catalog management service

import { supabase } from '../config/supabase';
import type { Product, CreateProductRequest, UpdateProductRequest } from '../types';

export interface ProductFilters {
  categoryId?: string;
  status?: 'active' | 'inactive' | 'archived';
  search?: string;
  lowStockOnly?: boolean;
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
    try {
      const { data, error } = await supabase
        .from('products')
        .insert(this.toInsertRow(storeId, userId, request))
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to create product');

      return this.mapProductData(data);
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
    try {
      const rows = requests.map((request) => this.toInsertRow(storeId, userId, request));

      const { data, error } = await supabase.from('products').insert(rows).select();

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
      let query = supabase.from('products').select('*').eq('store_id', storeId);

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
      let products = data ? data.map((p) => this.mapProductData(p)) : [];

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
      const { data, error } = await supabase.from('products').select('*').eq('id', productId).single();

      if (error) throw error;
      if (!data) throw new Error('Product not found');

      return this.mapProductData(data);
    } catch (error) {
      console.error('Get product error:', error);
      throw error;
    }
  }

  /**
   * Update a product. stock_qty cannot be set here - use InventoryService.adjustStock.
   */
  static async updateProduct(productId: string, request: UpdateProductRequest): Promise<Product> {
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
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to update product');

      return this.mapProductData(data);
    } catch (error) {
      console.error('Update product error:', error);
      throw error;
    }
  }

  /**
   * Archive a product (hides it from active catalog views without deleting history)
   */
  static async archiveProduct(productId: string): Promise<Product> {
    return this.updateProduct(productId, { status: 'archived' });
  }

  /**
   * Permanently delete a product
   */
  static async deleteProduct(productId: string): Promise<void> {
    try {
      const { error } = await supabase.from('products').delete().eq('id', productId);

      if (error) throw error;
    } catch (error) {
      console.error('Delete product error:', error);
      throw error;
    }
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
      costPrice: Number(data.cost_price),
      sellingPrice: Number(data.selling_price),
      taxRate: Number(data.tax_rate),
      trackInventory: data.track_inventory,
      stockQty: Number(data.stock_qty),
      reorderLevel: Number(data.reorder_level),
      imageUrl: data.image_url,
      attributes: data.attributes ?? {},
      status: data.status,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}
