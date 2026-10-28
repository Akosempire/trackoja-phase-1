// Sample data for staff, devices, reports, billing, settings and workspace screens
// in the preview harness (tests/visual/app.html). Not used by the app.
import { useAuth } from '../app-hooks';

type Mock = (svc: string, key: string, value: unknown) => void;
type Fixtures = typeof import('../app-fixtures');

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
const ahead = (days: number) => new Date(now + days * 86400000).toISOString();
const DAY = 24 * 60;
const path = new URLSearchParams(location.search).get('path') ?? '';

export default (mock: Mock, F: Fixtures) => {
  // Billing and settings need an organisation on the profile; other screens are left as they were.
  if (/^\/(billing|settings)/.test(path)) Object.assign(useAuth().profile, { currentOrgId: 'fixture-org' });

  // ── Staff ────────────────────────────────────────────────────
  const role = (id: string, name: string) => ({ id, name, isSystem: true, createdAt: iso(90000), updatedAt: iso(90000) });
  const roles = [role('r-owner', 'owner'), role('r-manager', 'manager'), role('r-cashier', 'cashier'), role('r-stock', 'stock_keeper')];
  const member = (id: string, userId: string, roleId: string, status: string, extra: Record<string, unknown>) => ({
    id, storeId: 'fixture-store', userId, roleId, status, joinedAt: iso(30000), createdAt: iso(30000), updatedAt: iso(100),
    roleName: roles.find((r) => r.id === roleId)?.name, ...extra,
  });
  mock('MemberService', 'getStoreMembersDetailed', [
    member('m1', 'fixture-user', 'r-owner', 'active', { name: 'Ada Obi', email: 'ada@example.com' }),
    member('m2', 'u-emeka', 'r-manager', 'active', { name: 'Emeka Nwosu', email: 'emeka.nwosu@example.com' }),
    member('m3', 'u-funmi', 'r-cashier', 'active', { name: 'Funmilayo Adebayo-Williams', email: 'funmilayo.adebayo@example.com' }),
    member('m4', 'u-pending', 'r-cashier', 'invited', { invitedEmail: 'blessing.k@example.com' }),
    member('m5', 'u-sus', 'r-stock', 'suspended', { name: 'Musa Ibrahim', email: 'musa@example.com' }),
  ]);
  mock('RbacService', 'getSystemRoles', roles);

  // ── Devices ──────────────────────────────────────────────────
  const device = (id: string, name: string, type: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, storeId: 'fixture-store', name, type, status, metadata: {}, createdBy: 'fixture-user', createdAt: iso(40000), updatedAt: iso(60), ...extra,
  });
  const devices = [
    device('d1', 'Front counter terminal', 'payment_terminal', 'active', { provider: 'opay', serialNumber: 'OP-77120034', model: 'OPay P2', firmwareVersion: '3.4.1', connectivity: 'cellular', batteryLevel: 82, lastSeenAt: iso(4) }),
    device('d2', 'Barcode scanner', 'scanner', 'active', { provider: 'Zebra', serialNumber: 'ZB-20931', connectivity: 'bluetooth', lastSeenAt: iso(30) }),
    device('d3', 'Receipt printer', 'printer', 'offline', { model: 'Xprinter XP-58', connectivity: 'wifi', lastSeenAt: iso(2 * DAY) }),
    device('d4', 'Old tablet', 'tablet', 'decommissioned', { model: 'Galaxy Tab A7' }),
  ];
  mock('DeviceService', 'getDevices', devices);
  mock('DeviceService', 'getDeviceSessions', [
    { id: 'ds1', deviceId: 'd1', storeId: 'fixture-store', userId: 'fixture-user', sessionToken: 'tko_pair_8f2a91c4e7d3', status: 'active', startedAt: iso(55), expiresAt: ahead(0.3), lastHeartbeatAt: iso(2), metadata: {} },
    { id: 'ds2', deviceId: 'd1', storeId: 'fixture-store', userId: 'u-funmi', status: 'ended', startedAt: iso(DAY + 300), endedAt: iso(DAY + 20), lastHeartbeatAt: iso(DAY + 22), metadata: {} },
  ]);
  mock('DeviceService', 'getDeviceTransactions', [
    { id: 'dt1', deviceId: 'd1', storeId: 'fixture-store', transactionType: 'payment_request', amount: 14700, currency: 'NGN', status: 'success', metadata: {}, createdBy: 'fixture-user', createdAt: iso(25) },
    { id: 'dt2', deviceId: 'd1', storeId: 'fixture-store', transactionType: 'payment_request', amount: 5000, currency: 'NGN', status: 'failed', metadata: {}, createdBy: 'fixture-user', createdAt: iso(140) },
    { id: 'dt3', deviceId: 'd1', storeId: 'fixture-store', transactionType: 'status_check', currency: 'NGN', status: 'pending', metadata: {}, createdBy: 'fixture-user', createdAt: iso(160) },
  ]);
  // Another fixture registers a minimal getDevice; this one runs after every fixture has loaded.
  queueMicrotask(() => mock('DeviceService', 'getDevice', async (id: string) => devices.find((d) => d.id === id) ?? devices[0]));

  // ── Reports ──────────────────────────────────────────────────
  mock('ReportService', 'getTopProducts', [
    { productId: 'p5', productName: 'Indomie Chicken (carton)', sku: 'FD-011', quantitySold: 1, revenue: 11500 },
    { productId: 'p3', productName: 'Hollandia Yoghurt 1L', sku: 'DRK-003', quantitySold: 2, revenue: 5000 },
    { productId: 'p6', productName: 'Peak Milk Tin 400g', sku: 'FD-012', quantitySold: 1, revenue: 3200 },
    { productId: 'p1', productName: 'Coca-Cola 50cl', sku: 'DRK-001', quantitySold: 3, revenue: 1200 },
  ]);
  const p = F.products;
  mock('ReportService', 'getInventoryValuation', {
    productCount: p.length,
    totalStockQty: p.reduce((sum, item) => sum + item.stockQty, 0),
    totalCostValue: p.reduce((sum, item) => sum + item.stockQty * item.costPrice, 0),
    totalRetailValue: p.reduce((sum, item) => sum + item.stockQty * item.sellingPrice, 0),
    lowStockCount: p.filter((item) => item.stockQty <= item.reorderLevel).length,
  });
  mock('ReportService', 'getProfitSummary', 5340);
  mock('ReportService', 'getCustomerBalancesSummary', { totalReceivables: 22500, customersWithBalance: 2, totalLoyaltyPoints: 643 });

  // ── Billing ──────────────────────────────────────────────────
  mock('SubscriptionService', 'getBillingAvailability', { paymentSystem: 'LIVE', trialEnabled: true, trialDays: 14 });
  mock('SubscriptionService', 'getMyEntitlement', {
    orgId: 'fixture-org', orgName: 'Ada Supermarket', productKey: 'trackoja', productName: 'TrackOja', planId: 'plan-standard', planKey: 'standard', planName: 'Standard',
    status: 'active', source: 'self_service', agreedMonthlyPrice: null, agreedAnnualPrice: null, agreedUserLimit: 5, agreedStoreLimit: 2, billingCycle: 'monthly',
    currency: 'NGN', trialEndsAt: null, activatedAt: iso(20 * DAY), expiresAt: ahead(10), cancelledAt: null, seatsUsed: 4, storesUsed: 2, daysRemaining: 10,
  });
  const plan = (id: string, name: string, monthly: number | null, annual: number | null, userLimit: number | null, features: string[], extra: Record<string, unknown> = {}) => ({
    id, productKey: 'trackoja', productName: 'TrackOja', key: id.replace('plan-', ''), name, description: null, monthlyPrice: monthly, annualPrice: annual, currency: 'NGN',
    billingCycle: monthly === null ? 'custom' : 'monthly', userLimit, storeLimit: null,
    features: features.map((label, i) => ({ key: `${id}-f${i}`, label, upcoming: label.includes('WhatsApp') })),
    onboardingNote: null, setupFee: null, trialDays: 14, isDefault: false, sortOrder: 0, publishedAt: iso(90000), effectiveFrom: iso(90000),
    monthlyVersionId: `${id}-m`, annualVersionId: `${id}-a`, monthlyVersion: 1, annualVersion: 1, monthlySetupFee: 0, annualSetupFee: 0, ...extra,
  });
  mock('SubscriptionService', 'getPublishedPlans', [
    plan('plan-starter', 'Starter', 4500, 45000, 2, ['Point of sale', 'Products and stock', 'Daily sales report']),
    plan('plan-standard', 'Standard', 9500, 95000, 5, ['Point of sale', 'Products and stock', 'Customers and credit', 'Reports and profit', 'Moniepoint POS', 'Staff roles', 'Multiple stores', 'WhatsApp receipts'], { isDefault: true }),
    plan('plan-premium', 'Premium', 19500, 195000, -1, ['Everything in Standard', 'Unlimited staff', 'Priority support'], { monthlySetupFee: 25000, annualSetupFee: 0 }),
    plan('plan-custom', 'Enterprise', null, null, null, ['Custom integrations'], { onboardingNote: 'For chains with more than 10 branches.' }),
  ]);
  mock('SubscriptionService', 'getTransactions', [
    { id: 'tx1', orgId: 'fixture-org', subscriptionId: 'sub1', planId: 'plan-standard', reference: 'TKO-9F3K2LQ8', amount: 9500, currency: 'NGN', status: 'success', paidAt: iso(20 * DAY), createdAt: iso(20 * DAY) },
    { id: 'tx2', orgId: 'fixture-org', subscriptionId: 'sub1', planId: 'plan-standard', reference: 'TKO-1A7XW03M', amount: 9500, currency: 'NGN', status: 'failed', paidAt: null, createdAt: iso(21 * DAY) },
  ]);
  const doc = {
    invoiceId: 'inv1', invoiceNumber: 'INV-202610-ABC1234567', receiptId: 'rct1', receiptNumber: 'RCT-202610-DEF9876543', planName: 'Standard', billingCycle: 'monthly',
    totalMinor: 950000, currency: 'NGN', status: 'paid', isTestData: false, issuedAt: iso(20 * DAY), paidAt: iso(20 * DAY), reference: 'TKO-9F3K2LQ8', billingEmail: 'accounts@adasupermarket.ng',
  };
  mock('SubscriptionService', 'getBillingDocuments', [doc, { ...doc, invoiceId: 'inv0', invoiceNumber: 'INV-202609-TST0000001', receiptId: null, receiptNumber: null, isTestData: true, status: 'issued', issuedAt: iso(50 * DAY), paidAt: null }]);
  mock('SubscriptionService', 'getBillingDocument', async (number: string) => (number.includes('NOTMINE') ? null : {
    invoiceNumber: doc.invoiceNumber, status: 'paid', isTestData: number.includes('TST'), issuedAt: doc.issuedAt, paidAt: doc.paidAt, currency: 'NGN',
    subtotalMinor: 3450000, totalMinor: 3450000, billingEmail: doc.billingEmail, businessName: 'Ada Supermarket', planName: 'Premium', billingCycle: 'monthly', reference: doc.reference,
    lines: [
      { lineType: 'subscription', description: 'Premium - monthly', quantity: 1, unitAmountMinor: 1950000, totalAmountMinor: 1950000 },
      { lineType: 'setup_fee', description: 'Setup fee', quantity: 1, unitAmountMinor: 1500000, totalAmountMinor: 1500000 },
    ],
    receipt: { receiptNumber: 'RCT-202610-DEF9876543', amountMinor: 3450000, currency: 'NGN', paymentMode: 'live', providerReference: 'ps_ref_8812bd', isTestData: false, paidAt: doc.paidAt },
  }));
  mock('OrganizationService', 'getOrganization', { id: 'fixture-org', name: 'Ada Supermarket', ownerId: 'fixture-user', billingEmail: 'accounts@adasupermarket.ng' });

  // ── Settings ─────────────────────────────────────────────────
  if (path.startsWith('/settings')) {
    mock('StoreService', 'getStore', {
      id: 'fixture-store', orgId: 'fixture-org', name: 'Ada Supermarket', slug: 'ada-supermarket', address: '14 Allen Avenue', city: 'Ikeja', state: 'Lagos',
      country: 'NG', phone: '0803 123 4567', email: 'hello@adasupermarket.ng', status: 'active', timezone: 'Africa/Lagos', currency: 'NGN', createdBy: 'fixture-user', createdAt: iso(90000), updatedAt: iso(60),
    });
  }

  // ── Workspace selection ──────────────────────────────────────
  mock('EntryService', 'listWorkspaces', [
    { orgId: 'fixture-org', orgName: 'Ada Supermarket', role: 'owner', storeId: 'fixture-store', storeName: 'Ikeja branch', hasAccess: true },
    { orgId: 'org-2', orgName: 'Obi Pharmacy and Wellness Centre', role: 'manager', storeId: 'store-9', storeName: 'Surulere', hasAccess: true },
    { orgId: 'org-3', orgName: 'Mama Nkechi Stores', role: 'cashier', storeId: null, storeName: null, hasAccess: false },
  ]);
};
