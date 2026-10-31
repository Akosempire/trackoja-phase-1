// services/rbac.service.ts
// Role-based access control service

import { supabase } from '../config/supabase';
import type { Permission, Role, UserPermissions } from '../types';

export class RbacService {
  /**
   * Get all system roles
   */
  static async getSystemRoles(): Promise<Role[]> {
    try {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .eq('is_system', true)
        .order('level', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Get system roles error:', error);
      throw error;
    }
  }

  /**
   * Get all permissions
   */
  static async getPermissions(): Promise<Permission[]> {
    try {
      const { data, error } = await supabase.from('permissions').select('*').order('category');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Get permissions error:', error);
      throw error;
    }
  }

  /**
   * Get user's permissions for a store
   */
  static async getUserPermissions(_userId: string, storeId: string): Promise<UserPermissions> {
    // The database answers for whoever is working on this account: the staff
    // member switched in by PIN, else the signed-in account.
    const { data, error } = await supabase.rpc('get_my_permissions', { p_store_id: storeId });
    if (error) {
      console.error('Get user permissions error:', error);
      throw error;
    }
    const result = (data ?? {}) as { role?: UserPermissions['role'] | null; permissions?: UserPermissions['permissions']; acting?: { user_id: string; name: string } | null };
    if (!result.role) throw new Error('User is not a member of this store');
    return { role: result.role, permissions: result.permissions ?? [], acting: result.acting ?? null };
  }

  /**
   * Check if user has a specific permission
   */
  static async hasPermission(
    userId: string,
    storeId: string,
    permissionName: string
  ): Promise<boolean> {
    try {
      const userPermissions = await this.getUserPermissions(userId, storeId);
      return userPermissions.permissions.some((p) => p.name === permissionName);
    } catch (error) {
      console.error('Has permission error:', error);
      return false;
    }
  }

  /**
   * Get role's permissions
   */
  static async getRolePermissions(roleId: string): Promise<Permission[]> {
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select(
          `permissions(
             id,
             name,
             resource,
             action,
             description,
             category
           )
        `
        )
        .eq('role_id', roleId);

      if (error) throw error;
      return data?.map((rp: any) => rp.permissions).filter(Boolean) || [];
    } catch (error) {
      console.error('Get role permissions error:', error);
      throw error;
    }
  }
}
