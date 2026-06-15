// services/member.service.ts
// Store member and staff management service

import { supabase } from '../config/supabase';
import type { StoreMember, StoreMemberWithDetails, InviteStaffRequest } from '../types';

export class MemberService {
  /**
   * Link the current user to any pending staff invitations matching their
   * email (sets store_members to active and joins organization_members).
   * Safe to call on every login - a no-op if there are no pending invites.
   */
  static async acceptPendingInvitations(): Promise<void> {
    const { error } = await supabase.rpc('accept_pending_invitations');
    if (error) throw error;
  }

  /**
   * Get all non-removed members (active + pending invites) of a store, with
   * the invited/joined user's name and the role's name resolved.
   */
  static async getStoreMembersDetailed(storeId: string): Promise<StoreMemberWithDetails[]> {
    try {
      const { data, error } = await supabase
        .from('store_members')
        .select('*, roles(name)')
        .eq('store_id', storeId)
        .neq('status', 'inactive')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const members = data ?? [];

      const userIds = members.map((m: any) => m.user_id).filter(Boolean);
      let usersById: Record<string, { firstName: string | null; lastName: string | null; email: string }> = {};
      if (userIds.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, first_name, last_name, email')
          .in('id', userIds);
        if (usersError) throw usersError;
        usersById = Object.fromEntries(
          (users ?? []).map((u: any) => [u.id, { firstName: u.first_name, lastName: u.last_name, email: u.email }])
        );
      }

      return members.map((m: any) => {
        const u = m.user_id ? usersById[m.user_id] : undefined;
        return {
          ...this.mapMemberData(m),
          roleName: m.roles?.name,
          name: u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email : undefined,
          email: u?.email,
        };
      });
    } catch (error) {
      console.error('Get store members error:', error);
      throw error;
    }
  }

  /**
   * Invite a staff member to a store
   */
  static async inviteStaff(
    storeId: string,
    invitedBy: string,
    request: InviteStaffRequest
  ): Promise<StoreMember> {
    try {
      const { data, error } = await supabase
        .from('store_members')
        .insert({
          store_id: storeId,
          role_id: request.roleId,
          invited_email: request.email,
          invited_by: invitedBy,
          invited_at: new Date().toISOString(),
          status: 'invited',
        })
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to invite staff member');

      return this.mapMemberData(data);
    } catch (error) {
      console.error('Invite staff error:', error);
      throw error;
    }
  }

  /**
   * Accept a staff invitation
   */
  static async acceptInvitation(userId: string, storeId: string): Promise<StoreMember> {
    try {
      // Find the invitation
      const { data: invitation, error: findError } = await supabase
        .from('store_members')
        .select('*')
        .eq('store_id', storeId)
        .eq('invited_email', (await supabase.auth.getUser()).data.user?.email)
        .eq('status', 'invited')
        .single();

      if (findError || !invitation) {
        throw new Error('Invitation not found');
      }

      // Update the membership
      const { data, error } = await supabase
        .from('store_members')
        .update({
          user_id: userId,
          status: 'active',
          accepted_at: new Date().toISOString(),
        })
        .eq('id', invitation.id)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to accept invitation');

      return this.mapMemberData(data);
    } catch (error) {
      console.error('Accept invitation error:', error);
      throw error;
    }
  }

  /**
   * Get store members
   */
  static async getStoreMembers(storeId: string): Promise<StoreMember[]> {
    try {
      const { data, error } = await supabase
        .from('store_members')
        .select('*')
        .eq('store_id', storeId)
        .eq('status', 'active')
        .order('joined_at', { ascending: false });

      if (error) throw error;
      return data ? data.map((m) => this.mapMemberData(m)) : [];
    } catch (error) {
      console.error('Get store members error:', error);
      throw error;
    }
  }

  /**
   * Get user's store membership
   */
  static async getUserStoreMembership(userId: string, storeId: string): Promise<StoreMember> {
    try {
      const { data, error } = await supabase
        .from('store_members')
        .select('*')
        .eq('user_id', userId)
        .eq('store_id', storeId)
        .eq('status', 'active')
        .single();

      if (error) throw error;
      if (!data) throw new Error('User is not a member of this store');

      return this.mapMemberData(data);
    } catch (error) {
      console.error('Get user store membership error:', error);
      throw error;
    }
  }

  /**
   * Remove a member from a store
   */
  static async removeMember(storeId: string, memberId: string): Promise<void> {
    try {
      const { error } = await supabase.from('store_members').update({ status: 'inactive' }).eq('id', memberId).eq('store_id', storeId);

      if (error) throw error;
    } catch (error) {
      console.error('Remove member error:', error);
      throw error;
    }
  }

  /**
   * Update member role
   */
  static async updateMemberRole(storeId: string, memberId: string, roleId: string): Promise<StoreMember> {
    try {
      const { data, error } = await supabase
        .from('store_members')
        .update({ role_id: roleId })
        .eq('id', memberId)
        .eq('store_id', storeId)
        .select()
        .single();

      if (error) throw error;
      if (!data) throw new Error('Failed to update member role');

      return this.mapMemberData(data);
    } catch (error) {
      console.error('Update member role error:', error);
      throw error;
    }
  }

  private static mapMemberData(data: any): StoreMember {
    return {
      id: data.id,
      storeId: data.store_id,
      userId: data.user_id,
      roleId: data.role_id,
      status: data.status,
      invitedBy: data.invited_by,
      invitedAt: data.invited_at,
      acceptedAt: data.accepted_at,
      invitedEmail: data.invited_email,
      joinedAt: data.joined_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}
