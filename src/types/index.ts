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
  isPlatformAdmin?: boolean;
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
  loyaltyEnabled: boolean;
  loyaltyEarnRate: number;
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

export interface StoreMemberWithDetails extends StoreMember {
  roleName?: string;
  name?: string;
  email?: string;
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
// Inventory (Phase 2)
// ============================================================
export interface ProductCategory {
  id: string;
  storeId: string;
  name: string;
  description?: string;
  parentCategoryId?: string;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  storeId: string;
  categoryId?: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  taxRate: number;
  trackInventory: boolean;
  stockQty: number;
  reorderLevel: number;
  imageUrl?: string;
  status: 'active' | 'inactive' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type InventoryMovementType =
  | 'replenishment'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'sale'
  | 'return';

export interface InventoryMovement {
  id: string;
  storeId: string;
  productId: string;
  movementType: InventoryMovementType;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  reason?: string;
  sourceType?: string;
  sourceId?: string;
  createdBy: string;
  createdAt: string;
}

// ============================================================
// Inventory Request DTOs
// ============================================================
export interface CreateCategoryRequest {
  name: string;
  description?: string;
  parentCategoryId?: string;
}

export interface UpdateCategoryRequest {
  name?: string;
  description?: string;
  parentCategoryId?: string | null;
  status?: 'active' | 'inactive';
}

export interface CreateProductRequest {
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  categoryId?: string;
  unit?: string;
  costPrice?: number;
  sellingPrice: number;
  taxRate?: number;
  trackInventory?: boolean;
  stockQty?: number;
  reorderLevel?: number;
  imageUrl?: string;
}

export interface UpdateProductRequest {
  name?: string;
  sku?: string;
  barcode?: string;
  description?: string;
  categoryId?: string | null;
  unit?: string;
  costPrice?: number;
  sellingPrice?: number;
  taxRate?: number;
  trackInventory?: boolean;
  reorderLevel?: number;
  imageUrl?: string;
  status?: 'active' | 'inactive' | 'archived';
}

export interface AdjustStockRequest {
  productId: string;
  movementType: InventoryMovementType;
  quantity: number;
  reason?: string;
  sourceType?: string;
  sourceId?: string;
}

// ============================================================
// Sales (Phase 3)
// ============================================================
export type SaleStatus = 'completed' | 'voided';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other' | 'credit';

export interface Sale {
  id: string;
  storeId: string;
  saleNumber: string;
  status: SaleStatus;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  changeDue: number;
  refundedAmount: number;
  loyaltyPointsEarned: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  items?: SaleItem[];
  payments?: SalePayment[];
  refunds?: Refund[];
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId?: string;
  productName: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  lineTotal: number;
  refundedQuantity: number;
  createdAt: string;
}

export type VerificationStatus = 'verified' | 'pending' | 'rejected';

export interface SalePayment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  verificationStatus: VerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  createdAt: string;
}

// ============================================================
// Sales Request DTOs
// ============================================================
export interface CreateSaleItemRequest {
  productId: string;
  quantity: number;
  discountAmount?: number;
}

export interface CreateSalePaymentRequest {
  method: PaymentMethod;
  amount: number;
  reference?: string;
  pending?: boolean;
}

export interface CreateSaleRequest {
  items: CreateSaleItemRequest[];
  payments: CreateSalePaymentRequest[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  discountTotal?: number;
  notes?: string;
}

// ============================================================
// Refunds & Payment Verification (Phase 8)
// ============================================================
export interface RefundItem {
  saleItemId: string;
  quantity: number;
}

export interface Refund {
  id: string;
  storeId: string;
  saleId: string;
  amount: number;
  reason: string;
  method: PaymentMethod;
  items?: RefundItem[];
  createdBy: string;
  createdAt: string;
}

export interface ProcessRefundRequest {
  amount: number;
  reason: string;
  method: PaymentMethod;
  items?: RefundItem[];
}

export interface PendingSalePayment {
  id: string;
  saleId: string;
  saleNumber: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  createdAt: string;
}

export interface RecentRefund {
  id: string;
  saleId: string;
  saleNumber: string;
  amount: number;
  reason: string;
  method: PaymentMethod;
  createdByEmail?: string;
  createdAt: string;
}

// ============================================================
// Customers (Phase 4)
// ============================================================
export type CreditTransactionType = 'sale_credit' | 'payment' | 'adjustment' | 'sale_void';
export type LoyaltyTransactionType = 'earn' | 'redeem' | 'adjustment' | 'void';

export interface Customer {
  id: string;
  storeId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  creditLimit: number;
  balance: number;
  loyaltyPoints: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerCreditTransaction {
  id: string;
  storeId: string;
  customerId: string;
  type: CreditTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  sourceType?: string;
  sourceId?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface CustomerLoyaltyTransaction {
  id: string;
  storeId: string;
  customerId: string;
  type: LoyaltyTransactionType;
  points: number;
  pointsBefore: number;
  pointsAfter: number;
  sourceType?: string;
  sourceId?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

// ============================================================
// Customer Request DTOs
// ============================================================
export interface CreateCustomerRequest {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  creditLimit?: number;
}

export interface UpdateCustomerRequest {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  creditLimit?: number;
  isActive?: boolean;
}

// ============================================================
// Reports (Phase 5)
// ============================================================
export interface SalesSummary {
  totalRevenue: number;
  discountTotal: number;
  taxTotal: number;
  transactionCount: number;
  voidedCount: number;
  averageSale: number;
}

export interface PaymentMethodBreakdown {
  method: PaymentMethod;
  amount: number;
  transactionCount: number;
}

export interface TopProduct {
  productId: string | null;
  productName: string;
  sku: string | null;
  quantitySold: number;
  revenue: number;
}

export interface InventoryValuation {
  productCount: number;
  totalStockQty: number;
  totalCostValue: number;
  totalRetailValue: number;
  lowStockCount: number;
}

export interface CustomerBalancesSummary {
  totalReceivables: number;
  customersWithBalance: number;
  totalLoyaltyPoints: number;
}

// ============================================================
// Subscriptions & Billing (Phase 6)
// ============================================================
export type BillingInterval = 'monthly' | 'yearly';

export type SubscriptionPlanStatus = 'active' | 'inactive';

export interface SubscriptionFeatureSet {
  stores: number;
  products: number;
  customers: number;
  team_members: number;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  featureSet: SubscriptionFeatureSet;
  status: SubscriptionPlanStatus;
}

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'
  | 'expired';

export interface Subscription {
  id: string;
  orgId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: string;
  trialEnd: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  endedAt: string | null;
  plan?: SubscriptionPlan;
}

export type SubscriptionTransactionStatus = 'pending' | 'success' | 'failed' | 'abandoned';

export interface SubscriptionTransaction {
  id: string;
  orgId: string;
  subscriptionId: string | null;
  planId: string;
  reference: string;
  amount: number;
  currency: string;
  status: SubscriptionTransactionStatus;
  paidAt: string | null;
  createdAt: string;
}

// ============================================================
// Platform Dashboard (Phase 7)
// ============================================================
export interface PlatformOverview {
  totalOrganizations: number;
  newOrganizations30d: number;
  totalStores: number;
  activeStores: number;
  totalUsers: number;
  trialingSubscriptions: number;
  activeSubscriptions: number;
  pastDueOrganizations: number;
}

export interface PlatformOrganization {
  orgId: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  billingStatus: string;
  planName: string | null;
  subscriptionStatus: string | null;
  storeCount: number;
  createdAt: string;
}

export interface PlatformRevenueSummary {
  totalRevenue: number;
  transactionCount: number;
  successfulCount: number;
  failedCount: number;
}

export interface PlatformRevenueByPlan {
  planId: string;
  planName: string;
  revenue: number;
  transactionCount: number;
}

export interface PlatformSystemHealth {
  failedAuditEvents24h: number;
  failedTransactions24h: number;
  pastDueOrganizations: number;
  suspendedOrganizations: number;
}

export interface PlatformRecentError {
  id: string;
  orgId: string;
  orgName: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceName: string | null;
  status: string;
  createdAt: string;
}

// ============================================================
// Devices (Phase 9)
// ============================================================
export type DeviceType = 'payment_terminal' | 'scanner' | 'printer' | 'tablet' | 'mobile';
export type DeviceStatus = 'pending' | 'active' | 'offline' | 'maintenance' | 'decommissioned';
export type DeviceConnectivity = 'online' | 'offline' | 'bluetooth' | 'wifi' | 'cellular';

export interface Device {
  id: string;
  storeId: string;
  name: string;
  type: DeviceType;
  provider?: string;
  serialNumber?: string;
  status: DeviceStatus;
  model?: string;
  firmwareVersion?: string;
  connectivity?: DeviceConnectivity;
  batteryLevel?: number;
  lastSeenAt?: string;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeviceRequest {
  name: string;
  type: DeviceType;
  provider?: string;
  serialNumber?: string;
  model?: string;
}

export interface UpdateDeviceRequest {
  name?: string;
  status?: DeviceStatus;
  provider?: string;
  serialNumber?: string;
  model?: string;
  firmwareVersion?: string;
  connectivity?: DeviceConnectivity;
}

export type DeviceSessionStatus = 'active' | 'ended' | 'expired' | 'failed';

export interface DeviceSession {
  id: string;
  deviceId: string;
  storeId: string;
  userId: string;
  sessionToken?: string;
  status: DeviceSessionStatus;
  startedAt: string;
  endedAt?: string;
  expiresAt?: string;
  lastHeartbeatAt?: string;
  metadata: Record<string, unknown>;
}

export type DeviceTransactionType = 'payment_request' | 'payment_confirmation' | 'refund' | 'reconciliation' | 'status_check';
export type DeviceTransactionStatus = 'pending' | 'success' | 'failed' | 'cancelled';

export interface DeviceTransaction {
  id: string;
  deviceId: string;
  storeId: string;
  sessionId?: string;
  saleId?: string;
  salePaymentId?: string;
  refundId?: string;
  transactionType: DeviceTransactionType;
  amount?: number;
  currency: string;
  status: DeviceTransactionStatus;
  externalRef?: string;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export interface RecordDeviceTransactionRequest {
  deviceId: string;
  transactionType: DeviceTransactionType;
  amount?: number;
  currency?: string;
  sessionId?: string;
  saleId?: string;
  salePaymentId?: string;
  refundId?: string;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// OPay Integration (Phase 10)
// ============================================================
export interface OpayInitiatePaymentRequest {
  deviceId: string;
  amount: number;
  currency?: string;
  saleId?: string;
  salePaymentId?: string;
  sessionId?: string;
}

export interface OpayInitiatePaymentResponse {
  transaction: DeviceTransaction;
  reference: string;
  checkoutUrl?: string;
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
