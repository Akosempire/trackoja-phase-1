import { supabase } from '../config/supabase';

export type EntryKind =
  | 'platform_admin' | 'new_user' | 'onboarding_in_progress' | 'existing_user'
  | 'invited_user' | 'billing_action_required' | 'access_restricted'
  | 'workspace_selection_required';

export interface EntryResolution {
  kind: EntryKind;
  destination: '/platform' | '/onboarding' | '/dashboard' | '/billing' | '/workspace';
  hasAccess: boolean;
  currentOrgId: string | null;
  currentStoreId: string | null;
  organizationCount: number;
  role: string | null;
  isInvitedUser: boolean;
  onboardingState: string | null;
  entitlementStatus: string | null;
  /** Platform admins can also own a customer workspace. This destination keeps
   * that commercial route separate from their default platform destination. */
  merchantDestination: '/onboarding' | '/dashboard' | '/billing' | '/workspace' | null;
  merchantKind: Exclude<EntryKind, 'platform_admin'> | null;
}

export interface WorkspaceChoice {
  orgId: string; orgName: string; role: string; storeId: string | null;
  storeName: string | null; hasAccess: boolean;
}

function mapResolution(data: any): EntryResolution {
  return {
    kind: data.kind, destination: data.destination, hasAccess: Boolean(data.has_access),
    currentOrgId: data.current_org_id, currentStoreId: data.current_store_id,
    organizationCount: Number(data.organization_count ?? 0), role: data.role ?? null,
    isInvitedUser: Boolean(data.is_invited_user), onboardingState: data.onboarding_state ?? null,
    entitlementStatus: data.entitlement_status ?? null,
    merchantDestination: data.merchant_destination ?? (data.kind === 'platform_admin' ? null : data.destination),
    merchantKind: data.merchant_kind ?? (data.kind === 'platform_admin' ? null : data.kind),
  };
}

export class EntryService {
  static async resolve(): Promise<EntryResolution> {
    const { data, error } = await supabase.rpc('resolve_my_trackoja_entry');
    if (error) throw error;
    return mapResolution(data);
  }

  static async listWorkspaces(): Promise<WorkspaceChoice[]> {
    const { data, error } = await supabase.rpc('list_my_trackoja_workspaces');
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ orgId: row.org_id, orgName: row.org_name,
      role: row.role, storeId: row.store_id, storeName: row.store_name, hasAccess: Boolean(row.has_access) }));
  }

  static async selectWorkspace(orgId: string): Promise<EntryResolution> {
    const { data, error } = await supabase.rpc('select_my_trackoja_workspace', { p_org_id: orgId });
    if (error) throw error;
    return mapResolution(data);
  }
}
