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
  static async getUserPermissions(userId: string, storeId: string): Promise<UserPermissions> {
    try {
      // Get user's store member record
      const { data: memberData, error: memberError } = await supabase
        .from('store_members')
        .select(
          `*,
           roles(
             id,
             name,
             description,
             is_system,
             level
           )
        `
        )
        .eq('user_id', userId)
        .eq('store_id', storeId)
        .eq('status', 'active')
        .single();

      if (memberError || !memberData || !memberData.roles) {
        throw new Error('User is not a member of this store');
      }

      // Get permissions for the role
      const { data: permissions, error: permError } = await supabase
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
        .eq('role_id', memberData.role_id);

      if (permError) throw permError;

      const permissionList = permissions?.map((rp: any) => rp.permissions).filter(Boolean) || [];

      return {
        role: memberData.roles,
        permissions: permissionList,
      };
    } catch (error) {
      console.error('Get user permissions error:', error);
      throw error;
    }
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
