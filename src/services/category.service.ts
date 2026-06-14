// services/category.service.ts
// Product category management service

import { supabase } from '../config/supabase';
import type { ProductCategory, CreateCategoryRequest, UpdateCategoryRequest } from '../types';

export class CategoryService {
  /**
   * Create a new product category
   */
  static async createCategory(
    storeId: string,
    userId: string,
    request: CreateCategoryRequest
  ): Promise<ProductCategory> {
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .insert({
          store_id: storeId,
          name: request.name,
          description: request.description,
          parent_category_id: request.parentCategoryId,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to create category');

      return this.mapCategoryData(data);
    } catch (error) {
      console.error('Create category error:', error);
      throw error;
    }
  }

  /**
   * List categories for a store
   */
  static async getCategories(
    storeId: string,
    options?: { status?: 'active' | 'inactive' }
  ): Promise<ProductCategory[]> {
    try {
      let query = supabase
        .from('product_categories')
        .select('*')
        .eq('store_id', storeId)
        .order('name', { ascending: true });

      if (options?.status) {
        query = query.eq('status', options.status);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data ? data.map((c) => this.mapCategoryData(c)) : [];
    } catch (error) {
      console.error('Get categories error:', error);
      throw error;
    }
  }

  /**
   * Get a single category
   */
  static async getCategory(categoryId: string): Promise<ProductCategory> {
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .select('*')
        .eq('id', categoryId)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Category not found');

      return this.mapCategoryData(data);
    } catch (error) {
      console.error('Get category error:', error);
      throw error;
    }
  }

  /**
   * Update a category
   */
  static async updateCategory(categoryId: string, request: UpdateCategoryRequest): Promise<ProductCategory> {
    try {
      const updates: Record<string, unknown> = {};
      if (request.name !== undefined) updates.name = request.name;
      if (request.description !== undefined) updates.description = request.description;
      if (request.parentCategoryId !== undefined) updates.parent_category_id = request.parentCategoryId;
      if (request.status !== undefined) updates.status = request.status;

      const { data, error } = await supabase
        .from('product_categories')
        .update(updates)
        .eq('id', categoryId)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to update category');

      return this.mapCategoryData(data);
    } catch (error) {
      console.error('Update category error:', error);
      throw error;
    }
  }

  /**
   * Delete a category. Products in the category fall back to uncategorized
   * via the column's ON DELETE SET NULL behavior.
   */
  static async deleteCategory(categoryId: string): Promise<void> {
    try {
      const { error } = await supabase.from('product_categories').delete().eq('id', categoryId);

      if (error) throw error;
    } catch (error) {
      console.error('Delete category error:', error);
      throw error;
    }
  }

  private static mapCategoryData(data: any): ProductCategory {
    return {
      id: data.id,
      storeId: data.store_id,
      name: data.name,
      description: data.description,
      parentCategoryId: data.parent_category_id,
      status: data.status,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}
