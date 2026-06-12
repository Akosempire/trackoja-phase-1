// types/index.ts
// TrackOja Phase 1 TypeScript type definitions

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ============================================================
// Authentication & Users
// ============================================================
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  currentOrgId?: string;
  currentStoreId?: string;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
  aud?: string;
  confirmation_sent_at?: string;
  confirmed_at?: string;
  email_confirmed_at?: string;
  phone_confirmed_at?: string;
  last_sign_in_at?: string;
  role?: string;
  updated_at?: string;
  identities?: Identity[];
}

export interface Identity {
  id: string;
  user_id: string;
  identity_data?: Record<string, any>;
  provider: string;
  last_sign_in_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UserSession {
  id: string;
  userId: string;
  sessionToken: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: string;
  expiresAt?: string;
  endedAt?: string;
}

// ============================================================
// Organizations
// ============================================================
export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  description?: string;
  ownerId: string;
  billingEmail?: string;
  billingStatus: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  trialEndsAt?: string;
  subscriptionPlanId?: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  orgId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  invitedBy?: string;
  invitedAt?: string;
  acceptedAt?: string;
}

// ============================================================
// Stores
// ============================================================
export interface Store {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  status: 'active' | 'inactive' | 'maintenance' | 'closed';
  timezone: string;
  currency: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreSettings {
  id: string;
  storeId: string;
  allowNegativeStock: boolean;
  requireCustomerForSale: boolean;
  autoPrintReceipt: boolean;
  receiptFormat: 'thermal' | 'a4' | 'pos';
  createdAt: string;
  updatedAt: string;
}

export interface StoreMember {
  id: string;
  storeId: string;
  userId: string;
  roleId: string;
  status: 'active' | 'inactive' | 'invited' | 'suspended';
  invitedBy?: string;
  invitedAt?: string;
  acceptedAt?: string;
  invitedEmail?: string;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// RBAC
// ============================================================
export interface Role {
  id: string;
  orgId?: string;
  name: string;
  description?: string;
  isSystem: boolean;
  level?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description?: string;
  category?: string;
  createdAt: string;
}

export interface RolePermission {
  id: string;
  roleId: string;
  permissionId: string;
  createdAt: string;
}

export interface UserPermissions {
  permissions: Permission[];
  role: Role;
}

// ============================================================
// Audit Logging
// ============================================================
export interface AuditLog {
  id: string;
  actorId: string;
  orgId: string;
  storeId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  changes?: Json;
  details?: Json;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failed' | 'attempted';
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  orgId: string;
  storeId?: string;
  activityType: string;
  description?: string;
  context?: Json;
  ipAddress?: string;
  createdAt: string;
}

// ============================================================
// API Responses
// ============================================================
export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  status: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

// ============================================================
// Auth Contexts
// ============================================================
export interface AuthContext {
  user?: User;
  organization?: Organization;
  store?: Store;
  storeMember?: StoreMember;
  role?: Role;
  permissions?: Permission[];
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface StoreContext {
  storeId?: string;
  orgId?: string;
  userId?: string;
  role?: Role;
  permissions?: Permission[];
}

// ============================================================
// Request/Response DTOs
// ============================================================
export interface SignUpRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  // Collected during onboarding, after email verification.
  organizationName?: string;
  storeName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateStoreRequest {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
}

export interface InviteStaffRequest {
  email: string;
  roleId: string;
  message?: string;
}

export interface SwitchStoreRequest {
  storeId: string;
}
