// services/auth.service.ts
// Authentication service for TrackOja Phase 1

import { supabase } from '../config/supabase';
import type { User } from '@supabase/supabase-js';
import type { SignUpRequest, LoginRequest, User as AppUser } from '../types';

export class AuthService {
  /**
   * Sign up a new user and create organization and store
   */
  static async signup(request: SignUpRequest) {
    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: request.email,
        password: request.password,
        options: {
          data: {
            first_name: request.firstName,
            last_name: request.lastName,
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create user');

      // Note: the public.users profile row is created automatically by the
      // on_auth_user_created trigger (handle_new_auth_user), since no
      // authenticated session exists yet to satisfy RLS at this point.

      // Note: Organization and Store creation happens in a separate step
      // This is to allow email verification before creating resources

      return {
        user: authData.user,
        session: authData.session,
      };
    } catch (error) {
      console.error('Signup error:', error);
      throw error;
    }
  }

  /**
   * Log in a user
   */
  static async login(request: LoginRequest) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: request.email,
        password: request.password,
      });

      if (error) throw error;
      if (!data.user) throw new Error('Login failed');

      // Update last login timestamp
      await supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', data.user.id);

      return {
        user: data.user,
        session: data.session,
      };
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Log out the current user
   */
  static async logout() {
    try {
      // Record the LOGOUT audit log while the session is still valid - logout
      // has no corresponding database write to hook a trigger into, so this is
      // handled by an Edge Function (see supabase/functions/log-logout).
      try {
        await supabase.functions.invoke('log-logout');
      } catch (auditError) {
        console.error('Log logout audit error:', auditError);
      }

      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }

  /**
   * Request a password reset email
   */
  static async forgotPassword(email: string) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
    } catch (error) {
      console.error('Forgot password error:', error);
      throw error;
    }
  }

  /**
   * Reset password with a token
   */
  static async resetPassword(password: string) {
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Reset password error:', error);
      throw error;
    }
  }

  /**
   * Get current authenticated user
   */
  static async getCurrentUser() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    } catch (error) {
      console.error('Get current user error:', error);
      return null;
    }
  }

  /**
   * Verify email with OTP
   */
  static async verifyOtp(email: string, token: string) {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Verify OTP error:', error);
      throw error;
    }
  }

  /**
   * Resend the signup verification email
   */
  static async resendVerification(email: string) {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });

      if (error) throw error;
    } catch (error) {
      console.error('Resend verification error:', error);
      throw error;
    }
  }

  /**
   * Get current session
   */
  static async getSession() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session;
    } catch (error) {
      console.error('Get session error:', error);
      return null;
    }
  }

  /**
   * Listen to auth state changes
   */
  static onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null);
    });
  }

  /**
   * Get the app-level profile (public.users row) for a user
   */
  static async getUserProfile(userId: string): Promise<AppUser | null> {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();

      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
        avatarUrl: data.avatar_url,
        currentOrgId: data.current_org_id,
        currentStoreId: data.current_store_id,
        emailVerifiedAt: data.email_verified_at,
        lastLoginAt: data.last_login_at,
        status: data.status,
        isPlatformAdmin: data.is_platform_admin,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      console.error('Get user profile error:', error);
      return null;
    }
  }
}
