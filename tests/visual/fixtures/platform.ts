// Sample data for the platform owner console in the preview harness
// (tests/visual/app.html?path=/platform/...). Not used by the app.
//
// The console needs a platform admin, so for /platform paths the harness profile
// is promoted. Extra switches:
//   devmode=1       show the developer-access banner
//   impersonate=1   show the read-only support session banner
//   access=support  sign in as a support agent instead of the platform owner
import { useAuth } from '../app-hooks';

type Mock = (svc: string, key: string, value: unknown) => void;

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
const ahead = (days: number) => new Date(now + days * 86400000).toISOString();
const DAY = 24 * 60;
const params = new URLSearchParams(location.search);
const path = params.get('path') ?? '';

export default (mock: Mock) => {
  if (!path.startsWith('/platform')) return;
  Object.assign(useAuth().profile, { isPlatformAdmin: true });

  const support = params.get('access') === 'support';
  mock('PlatformAdminService', 'getMyAccess', support
    ? { isPlatformAdmin: true, isSuperAdmin: false, developerMode: false, permissions: ['platform:view', 'platform:support', 'platform:manage_businesses'] }
    : { isPlatformAdmin: true, isSuperAdmin: true, developerMode: params.get('devmode') === '1', permissions: [] });
  mock('PlatformAdminService', 'listSettings', [
    { key: 'environment', value: 'staging', description: 'Which environment this database serves.', category: 'general', updatedAt: iso(9000) },
    { key: 'support_email', value: 'support@usetally.example', description: 'Shown to merchants on help screens.', category: 'support', updatedAt: iso(20000) },
    { key: 'trial_days', value: 14, description: 'Default trial length for new businesses.', category: 'billing', updatedAt: iso(40000) },
    { key: 'maintenance_mode', value: false, description: 'Blocks merchant sign-in while true.', category: 'general', updatedAt: iso(60000) },
  ]);
  mock('PlatformAdminService', 'getDeveloperStatus', {
    isPlatformAdmin: true, isSuperAdmin: true, developerMode: params.get('devmode') === '1',
    grantedAt: iso(2 * DAY), expiresAt: ahead(28), activeSessionId: params.get('devmode') === '1' ? 'dev-session' : null,
  });
  mock('PlatformAdminService', 'getActiveImpersonation', params.get('impersonate') === '1'
    ? { sessionId: 'imp-1', orgId: 'org-1', orgName: 'Mama Put Kitchen', expiresAt: ahead(0.01), secondsRemaining: 742, reason: 'Ticket 4412: receipts not printing' }
    : null);

  // ── Businesses ──────────────────────────────────────────────
  const biz = (i: number, name: string, billingStatus: string, entitlementStatus: string, extra: Record<string, unknown> = {}) => ({
    orgId: `org-${i}`, name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), ownerEmail: `owner${i}@example.com`,
    businessCategory: ['supermarket', 'restaurant', 'pharmacy', 'fashion', 'general_retail'][i % 5], billingStatus, isSandbox: false,
    productKey: 'trackoja', productName: 'Usetally POS', planKey: 'standard', planName: 'Standard', entitlementStatus,
    agreedUserLimit: 5, seatUsed: (i % 5) + 1, expiresAt: ahead(10 + i * 9), trialEndsAt: null, storeCount: (i % 3) + 1, createdAt: iso(i * 3 * DAY), ...extra,
  });
  const businesses = [
    biz(1, 'Mama Put Kitchen', 'active', 'active'),
    biz(2, 'Ada Supermarket', 'active', 'active', { planName: 'Growth', planKey: 'growth', agreedUserLimit: 10 }),
    biz(3, 'Kemi Pharmacy', 'trial', 'pending', { trialEndsAt: ahead(6), expiresAt: ahead(6) }),
    biz(4, 'Lekki Threads', 'past_due', 'past_due', { expiresAt: ahead(-3) }),
    biz(5, 'Yaba Electronics Hub', 'suspended', 'suspended'),
    biz(6, 'Ikeja Fresh Mart', 'active', 'active', { expiresAt: ahead(20) }),
    biz(7, 'Sandbox Store', 'trial', 'pending', { isSandbox: true }),
  ];
  mock('PlatformAdminService', 'listBusinesses', businesses);
  mock('PlatformService', 'listOrganizations', businesses.map(b => ({ orgId: b.orgId, name: b.name, slug: b.slug, ownerEmail: b.ownerEmail, billingStatus: b.billingStatus, planName: b.planName, subscriptionStatus: b.entitlementStatus, storeCount: b.storeCount, createdAt: b.createdAt, businessCategory: b.businessCategory })));
  mock('PlatformAdminService', 'getBusiness', {
    organization: { id: 'org-1', name: 'Mama Put Kitchen', slug: 'mama-put-kitchen', billing_status: 'active', business_category: 'restaurant', is_sandbox: false, created_at: iso(90 * DAY), owner_email: 'owner1@example.com' },
    products: [{ product_key: 'trackoja', product_name: 'Usetally POS', plan_name: 'Standard', status: 'active', agreed_user_limit: 5, expires_at: ahead(19), entitlement_id: 'ent-1', source: 'self_service' }],
    stores: [{ id: 's1', name: 'Surulere branch', status: 'active', created_at: iso(90 * DAY) }, { id: 's2', name: 'Ikeja branch', status: 'active', created_at: iso(30 * DAY) }],
    staff: [{ user_id: 'u1', email: 'owner1@example.com', role: 'owner', status: 'active' }, { user_id: 'u2', email: 'cashier@example.com', role: 'cashier', status: 'active' }],
    payments: [{ id: 'pay-1', reference: 'TRX-88213', amount: 22500, status: 'success', created_at: iso(12 * DAY), plan_name: 'Standard' }],
    supportNotes: [{ id: 'n1', note_type: 'call', body: 'Walked the owner through receipt printer pairing.', admin_email: 'support@usetally.example', created_at: iso(3 * DAY) }],
    adjustments: [{ id: 'adj-1', adjustment_type: 'extend', reason: 'Goodwill after outage', performed_by_email: 'ops@usetally.example', created_at: iso(20 * DAY) }],
    seatUsed: 2,
    billingEmail: 'accounts@mamaput.example',
  });

  // ── Overview ────────────────────────────────────────────────
  mock('PlatformAdminService', 'getOverview', { totalBusinesses: 6, activeSubscriptions: 3, trialingSubscriptions: 1, pastDueSubscriptions: 1, expiringWithin30d: 2, failedPayments30d: 2, revenue30d: 112500, sandboxBusinesses: 1 });
  mock('PlatformService', 'getOverview', { totalOrganizations: 7, newOrganizations30d: 3, totalStores: 12, activeStores: 11, totalUsers: 31, trialingSubscriptions: 1, activeSubscriptions: 3, pastDueOrganizations: 1 });
  mock('PlatformService', 'getInventoryOverview', { totalProducts: 1840, totalStaff: 31, inventoryValueCost: 18400000, inventoryValueRetail: 24800000 });
  mock('PlatformService', 'getRevenueSummary', { totalRevenue: 112500, transactionCount: 7, successfulCount: 5, failedCount: 2 });
  mock('PlatformService', 'getRevenueByPlan', [{ planId: 'standard', planName: 'Standard', revenue: 67500, transactionCount: 3 }, { planId: 'growth', planName: 'Growth', revenue: 45000, transactionCount: 2 }]);
  mock('PlatformService', 'getSystemHealth', { failedAuditEvents24h: 3, failedTransactions24h: 1, pastDueOrganizations: 1, suspendedOrganizations: 1 });
  const errors = [
    { id: 'e1', orgId: 'org-4', orgName: 'Lekki Threads', actorEmail: 'owner4@example.com', action: 'SUBSCRIPTION_PAYMENT', resourceType: 'subscription', resourceName: 'Standard', status: 'failed', createdAt: iso(45) },
    { id: 'e2', orgId: 'org-2', orgName: 'Ada Supermarket', actorEmail: 'owner2@example.com', action: 'MONIEPOINT_SYNC', resourceType: 'integration', resourceName: 'Terminal 2', status: 'attempted', createdAt: iso(260) },
  ];
  mock('PlatformService', 'getRecentErrors', errors);
  const audit = [
    { id: 'a1', actorEmail: 'ops@usetally.example', orgId: 'org-1', orgName: 'Mama Put Kitchen', action: 'SUBSCRIPTION_EXTENDED', resourceType: 'subscription', resourceId: 'ent-1', resourceName: 'Standard', status: 'success', changes: { expires_at: { from: iso(-10 * DAY), to: ahead(19) } }, details: { reason: 'Goodwill after outage' }, createdAt: iso(30) },
    { id: 'a2', actorEmail: 'support@usetally.example', orgId: 'org-3', orgName: 'Kemi Pharmacy', action: 'SUPPORT_NOTE_ADDED', resourceType: 'organization', resourceId: 'org-3', resourceName: 'Kemi Pharmacy', status: 'success', changes: null, details: {}, createdAt: iso(140) },
    { id: 'a3', actorEmail: 'owner4@example.com', orgId: 'org-4', orgName: 'Lekki Threads', action: 'SUBSCRIPTION_PAYMENT', resourceType: 'subscription', resourceId: null, resourceName: null, status: 'failed', changes: null, details: { reason: 'Card declined' }, createdAt: iso(45) },
    { id: 'a4', actorEmail: 'ops@usetally.example', orgId: null, orgName: null, action: 'ACTIVATION_KEY_ISSUED', resourceType: 'activation_key', resourceId: 'k1', resourceName: 'TALLY-****-7Q2M', status: 'success', changes: null, details: {}, createdAt: iso(DAY) },
  ];
  mock('PlatformAdminService', 'listAuditLogs', { entries: audit, total: audit.length });

  // ── Billing ─────────────────────────────────────────────────
  mock('PlatformAdminService', 'listProducts', [
    { id: 'prod-1', key: 'trackoja', name: 'Usetally POS', tagline: 'Point of sale and stock for growing shops', description: null, status: 'active', visibility: 'public', features: [{ key: 'pos', label: 'Point of sale' }, { key: 'inventory', label: 'Inventory' }], onboardingNote: null, accessSettings: {}, planCount: 2, businessCount: 6, sortOrder: 1, updatedAt: iso(9000) },
  ]);
  const plan = (id: string, key: string, name: string, monthly: number, users: number, subs: number, extra: Record<string, unknown> = {}) => ({
    id, productId: 'prod-1', productKey: 'trackoja', productName: 'Usetally POS', key, name, description: `${name} plan for shops`, monthlyPrice: monthly, annualPrice: monthly * 10,
    currency: 'NGN', userLimit: users, setupFee: 0, trialDays: 14, storeLimit: users > 5 ? 3 : 1, features: [{ key: 'pos', label: 'Point of sale' }], onboardingNote: null,
    billingCycle: 'monthly', status: 'active', isDefault: key === 'standard', isPublic: true, sortOrder: 1, subscriberCount: subs, updatedAt: iso(9000), publishedAt: iso(9000), effectiveFrom: iso(9000), ...extra,
  });
  mock('PlatformAdminService', 'listPlans', [plan('plan-1', 'standard', 'Standard', 22500, 5, 4), plan('plan-2', 'growth', 'Growth', 45000, 10, 1), plan('plan-3', 'enterprise', 'Enterprise', 120000, 50, 0, { status: 'draft', isPublic: false, publishedAt: null })]);
  mock('PlatformAdminService', 'listPlanRevisions', []);
  const trx = (ref: string, org: number, status: string, amount: number, mins: number, extra: Record<string, unknown> = {}) => ({
    reference: ref, orgId: `org-${org}`, businessName: businesses[org - 1].name, businessIsSandbox: false, productName: 'Usetally POS', planName: 'Standard', planKey: 'standard', planVersion: 2, planVersionId: 'pv-2',
    billingCycle: 'monthly', amountMinor: amount * 100, currency: 'NGN', status, paymentMode: 'live', environment: 'production', isTestData: false, failureReason: status === 'failed' ? 'Card declined by issuer' : null,
    createdAt: iso(mins), paidAt: status === 'success' ? iso(mins - 1) : null, verifiedAt: status === 'success' ? iso(mins - 1) : null, settledBy: status === 'success' ? 'webhook' : null, gatewayReference: `PSK_${ref}`, providerReference: null,
    invoiceNumber: status === 'success' ? `INV-${ref.slice(-4)}` : null, receiptNumber: status === 'success' ? `RCT-${ref.slice(-4)}` : null, subscriptionStatus: 'active', entitlementStatus: 'active', entitlementExpiresAt: ahead(20), auditEventCount: 2, webhookEventCount: 1, ...extra,
  });
  mock('PlatformAdminService', 'listCommercialTransactions', [
    trx('TRX-88213', 1, 'success', 22500, 12 * DAY), trx('TRX-88240', 2, 'success', 45000, 6 * DAY, { planName: 'Growth' }), trx('TRX-88251', 4, 'failed', 22500, 45), trx('TRX-88262', 6, 'pending', 22500, 20),
  ]);
  mock('PlatformAdminService', 'listAdjustments', [
    { id: 'adj-1', orgId: 'org-1', orgName: 'Mama Put Kitchen', adjustmentType: 'extend', reason: 'Goodwill after outage', previousValues: null, newValues: { days: 7 }, performedByEmail: 'ops@usetally.example', isSandbox: false, createdAt: iso(20 * DAY) },
  ]);

  // ── Activation, support, settings, developer ───────────────
  mock('PlatformAdminService', 'listActivationKeys', [
    { id: 'k1', keyCodeMasked: 'TALLY-****-7Q2M', productKey: 'trackoja', productName: 'Usetally POS', planName: 'Standard', orgId: null, orgName: null, status: 'issued', validFrom: iso(DAY), validUntil: ahead(30), userLimit: 5, redeemedAt: null, isSandbox: false, createdAt: iso(DAY) },
    { id: 'k2', keyCodeMasked: 'TALLY-****-4KD9', productKey: 'trackoja', productName: 'Usetally POS', planName: 'Growth', orgId: 'org-2', orgName: 'Ada Supermarket', status: 'redeemed', validFrom: iso(20 * DAY), validUntil: ahead(10), userLimit: 10, redeemedAt: iso(18 * DAY), isSandbox: false, createdAt: iso(20 * DAY) },
    { id: 'k3', keyCodeMasked: 'TALLY-****-P0LX', productKey: 'trackoja', productName: 'Usetally POS', planName: 'Standard', orgId: null, orgName: null, status: 'revoked', validFrom: iso(40 * DAY), validUntil: iso(10 * DAY), userLimit: 5, redeemedAt: null, isSandbox: false, createdAt: iso(40 * DAY) },
  ]);
  mock('PlatformAdminService', 'listSupportNotes', [
    { id: 'n1', noteType: 'call', body: 'Walked the owner through receipt printer pairing. Printer now prints.', adminEmail: 'support@usetally.example', productKey: 'trackoja', isSandbox: false, createdAt: iso(3 * DAY) },
    { id: 'n2', noteType: 'billing', body: 'Owner asked about annual billing; sent pricing.', adminEmail: 'ops@usetally.example', productKey: 'trackoja', isSandbox: false, createdAt: iso(9 * DAY) },
  ]);
  mock('PlatformAdminService', 'listNotificationTemplates', [
    { id: 't1', key: 'trial_ending', name: 'Trial ending', channel: 'email', subject: 'Your trial ends in 3 days', body: 'Hi {{name}}, your trial ends soon.', status: 'active', updatedAt: iso(30 * DAY) },
    { id: 't2', key: 'payment_failed', name: 'Payment failed', channel: 'email', subject: 'We could not take your payment', body: 'Hi {{name}}, your last payment failed.', status: 'draft', updatedAt: iso(12 * DAY) },
  ]);
  mock('PlatformAdminService', 'listDeveloperGrants', [
    { userId: 'u-dev', email: 'tunde.dev@usetally.example', status: 'active', level: 'developer', grantedByEmail: 'owner@usetally.example', grantedAt: iso(2 * DAY), expiresAt: ahead(28), revokedAt: null, reason: 'Investigating Moniepoint sync' },
  ]);
  mock('PlatformAdminService', 'listSandboxBusinesses', [{ orgId: 'org-7', name: 'Sandbox Store', slug: 'sandbox-store', ownerEmail: 'dev@usetally.example', createdAt: iso(10 * DAY) }]);
  mock('PlatformAdminService', 'listUsers', [
    { userId: 'u1', email: 'owner1@example.com', fullName: 'Bisi Adeyemi', isPlatformAdmin: false, platformLevel: null, developerMode: false, orgId: 'org-1', orgName: 'Mama Put Kitchen', isSandbox: false, storeRole: 'owner', entitledProducts: ['trackoja'], seatLimit: 5, lastLoginAt: iso(60), createdAt: iso(90 * DAY) },
  ]);
  const admin = (userId: string, email: string, fullName: string, level: string, permissions: string[]) => ({ userId, email, fullName, level, status: 'active', permissions, permissionCount: permissions.length, developerMode: level === 'developer', grantedByEmail: 'owner@usetally.example', grantedAt: iso(60 * DAY), revokedAt: null, note: null });
  const admins = [
    admin('u-owner', 'owner@usetally.example', 'Ada Obi', 'super_admin', []),
    admin('u-ops', 'ops@usetally.example', 'Emeka Nwosu', 'admin', ['platform:view', 'platform:manage_businesses', 'platform:support']),
    admin('u-sup', 'support@usetally.example', 'Funmi Adebayo', 'support', ['platform:view', 'platform:support']),
    admin('u-dev', 'tunde.dev@usetally.example', 'Tunde Bakare', 'developer', ['platform:view', 'developer:access']),
  ];
  mock('PlatformAdminService', 'listAdminAccounts', admins);
  mock('PlatformAdminService', 'listPlatformAdminAccountsV2', admins);
  mock('PlatformAdminService', 'getDiagnostics', { org_id: 'org-1', stores: 2, products: 140, last_sale_at: iso(15) });
};
