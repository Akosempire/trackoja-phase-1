// services/audit.service.ts
// Read access to audit logs. Audit log entries themselves are written at the
// database layer (see database/011_audit_log_triggers.sql) or, for events with
// no corresponding table write (LOGOUT), by the log-logout Edge Function -
// never directly by this frontend service.

import { supabase } from '../config/supabase';
import type { AuditLog } from '../types';

export class AuditService {
  /**
   * Get audit logs for organization
   */
  static async getOrgAuditLogs(
    orgId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<AuditLog[]> {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data ? data.map((log) => this.mapAuditLogData(log)) : [];
    } catch (error) {
      console.error('Get organization audit logs error:', error);
      throw error;
    }
  }

  /**
   * Get audit logs for a store
   */
  static async getStoreAuditLogs(
    storeId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<AuditLog[]> {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data ? data.map((log) => this.mapAuditLogData(log)) : [];
    } catch (error) {
      console.error('Get store audit logs error:', error);
      throw error;
    }
  }

  private static mapAuditLogData(data: any): AuditLog {
    return {
      id: data.id,
      actorId: data.actor_id,
      orgId: data.org_id,
      storeId: data.store_id,
      action: data.action,
      resourceType: data.resource_type,
      resourceId: data.resource_id,
      resourceName: data.resource_name,
      changes: data.changes,
      details: data.details,
      status: data.status,
      createdAt: data.created_at,
    };
  }
}
