// The business experience model.
//
// One typed definition per supported business type, keyed by the STABLE category
// keys already stored in organizations.business_category. Renaming a user-facing
// label must never change a stored record type or reinterpret old data, so `key`
// and `category` are frozen and only the display strings move.
//
// This replaces "the whole business-type system is four label strings" with a
// real model: navigation, dashboard metrics, primary actions, terminology,
// statuses and transitions, stock behaviour, payment options, staff roles and
// reports, all per type.
//
// HONESTY RULE: any nav item, action or report whose workflow does not exist yet
// carries implemented: false. Navigation renders only implemented entries, so a
// merchant is never sent to a route that does not work, and `missingCapabilities()`
// produces the work list rather than hiding it.
//
// Business type is NOT subscription plan. A plan controls entitlements (seats,
// features); a business type controls how the merchant works. Nothing here reads
// or infers a plan.

import type { BusinessCategory } from './businessModules';
import { CATEGORY_CONFIGS, DEFAULT_CATEGORY } from './businessModules';

export type NavIconName =
  | 'home'
  | 'sales'
  | 'products'
  | 'customers'
  | 'staff'
  | 'reports'
  | 'payments'
  | 'settings'
  | 'kitchen'
  | 'expiry'
  | 'devices';

export interface ExperienceNavItem {
  key: string;
  label: string;
  route: string;
  icon: NavIconName;
  /** Permission the server enforces for this area, if any. */
  permission?: string;
  /** false = the workflow is not built yet. Nav hides it instead of linking nowhere. */
  implemented: boolean;
  /** What is missing, when implemented is false. */
  gap?: string;
}

export type StockModel = 'simple' | 'variant' | 'batch' | 'roll' | 'serial' | 'none';

export interface DashboardMetric {
  key: string;
  label: string;
  /** Table or function the number comes from. */
  source: string;
  /** How it is computed, stated plainly so it can be checked. */
  calculation: string;
  /** Time window the metric covers. */
  period: string;
  /** Filtered list this card opens. */
  linkTo?: string;
  tone?: 'default' | 'warn' | 'danger' | 'brand';
  implemented: boolean;
  /** Why the card is not available, when implemented is false. */
  gap?: string;
}

export interface ExperienceAction {
  label: string;
  route: string;
  implemented: boolean;
  gap?: string;
}

export interface ExperienceReport {
  label: string;
  implemented: boolean;
  gap?: string;
}

export interface BusinessExperience {
  category: BusinessCategory;
  displayName: string;
  onboardingDescription: string;
  /** The question this business opens the app to answer. */
  primaryQuestion: string;
  defaultModules: string[];
  nav: ExperienceNavItem[];
  /** Nav keys that appear in the mobile bottom bar, in order. */
  bottomNav: string[];
  primaryAction: ExperienceAction;
  secondaryActions: ExperienceAction[];
  terminology: {
    record: string;
    recordPlural: string;
    lineItem: string;
    stock: string;
    customer: string;
  };
  /** Statuses in normal forward order. */
  statuses: string[];
  /** Allowed moves, including permitted backward transitions. */
  allowedTransitions: Record<string, string[]>;
  stock: {
    model: StockModel;
    /** Can a quantity be fractional? Fabric sells 12.5 metres. */
    fractional: boolean;
    /** Must stock carry an expiry date? */
    expiryTracked: boolean;
    defaultUnit: string;
    units: string[];
    note?: string;
  };
  paymentOptions: string[];
  staffRoles: string[];
  dashboard: DashboardMetric[];
  reports: ExperienceReport[];
  emptyStates: {
    dashboard: string;
    primaryList: string;
  };
}

// ---------------------------------------------------------------- helpers

/** An existing, working route with a business-specific label. */
function live(
  key: string,
  label: string,
  route: string,
  icon: NavIconName,
  permission?: string
): ExperienceNavItem {
  return { key, label, route, icon, permission, implemented: true };
}

/** A workflow this business needs that is not built yet. */
function wanted(
  key: string,
  label: string,
  route: string,
  icon: NavIconName,
  gap: string,
  permission?: string
): ExperienceNavItem {
  return { key, label, route, icon, permission, implemented: false, gap };
}

const OVERVIEW = () => live('overview', 'Overview', '/dashboard', 'home');

// ================================================================ the model

const GENERAL_RETAIL_NAV: ExperienceNavItem[] = [
  live('checkout', 'Checkout', '/sales/checkout', 'sales', 'sales:create'),
  live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
  live('products', 'Products', '/inventory/products', 'products', 'inventory:view'),
  live('stock', 'Stock', '/inventory/stock', 'products', 'inventory:view'),
  live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
  wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
  wanted('expenses', 'Expenses', '/expenses', 'payments', 'No expense records exist yet.'),
  live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
];

function retailLike(overrides: Partial<BusinessExperience> = {}): BusinessExperience {
  return {
    category: DEFAULT_CATEGORY,
    displayName: CATEGORY_CONFIGS.general_retail.label,
    onboardingDescription: CATEGORY_CONFIGS.general_retail.description,
    primaryQuestion: 'What sold today, and what needs restocking?',
    defaultModules: ['inventory', 'sales', 'customers'],
    nav: [OVERVIEW(), ...GENERAL_RETAIL_NAV],
    bottomNav: ['overview', 'checkout', 'products'],
    primaryAction: { label: 'New sale', route: '/sales/checkout', implemented: true },
    secondaryActions: [
      { label: 'Add product', route: '/inventory/products/new', implemented: true },
      { label: 'Record expense', route: '/expenses', implemented: false, gap: 'No expense records yet.' },
    ],
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Product',
      stock: 'Stock',
      customer: 'Customer',
    },
    statuses: ['draft', 'pending', 'completed', 'cancelled', 'refunded'],
    allowedTransitions: {
      draft: ['pending', 'cancelled'],
      pending: ['completed', 'cancelled'],
      completed: ['refunded'],
      cancelled: [],
      refunded: [],
    },
    stock: {
      model: 'simple',
      fractional: false,
      expiryTracked: false,
      defaultUnit: 'piece',
      units: CATEGORY_CONFIGS.general_retail.unitOptions,
    },
    paymentOptions: ['cash', 'transfer', 'card', 'credit'],
    staffRoles: ['owner', 'manager', 'cashier', 'inventory_officer'],
    dashboard: [
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales created today, excluding cancelled',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'transactions_today',
        label: 'Transactions',
        source: 'sales',
        calculation: 'COUNT of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'low_stock',
        label: 'Low stock',
        source: 'products',
        calculation: 'Products where track_inventory and stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'expenses',
        label: 'Expenses',
        source: 'expenses',
        calculation: 'SUM of expenses recorded today',
        period: 'business-local day',
        linkTo: '/expenses',
        implemented: false,
      },
    ],
    reports: [
      { label: 'Sales summary', implemented: true },
      { label: 'Payment methods', implemented: true },
      { label: 'Top products', implemented: true },
      { label: 'Inventory valuation', implemented: true },
      { label: 'Profit summary', implemented: true },
      { label: 'Expenses', implemented: false, gap: 'No expense records yet.' },
    ],
    emptyStates: {
      dashboard: 'No sales yet. Add your first product, then record a sale to see today here.',
      primaryList: 'No sales recorded yet.',
    },
    ...overrides,
  };
}

const RAW_EXPERIENCES: Record<BusinessCategory, BusinessExperience> = {
  // ---------------------------------------------------------------- retail
  general_retail: retailLike(),

  // ------------------------------------------------------------ restaurant
  restaurant: {
    category: 'restaurant',
    displayName: CATEGORY_CONFIGS.restaurant.label,
    onboardingDescription: CATEGORY_CONFIGS.restaurant.description,
    primaryQuestion: 'What orders need attention right now?',
    defaultModules: ['inventory', 'sales', 'customers', 'restaurant', 'kitchen'],
    nav: [
      OVERVIEW(),
      live('orders', 'Orders', '/sales', 'sales', 'sales:create'),
      live('menu', 'Menu', '/inventory/products', 'products', 'inventory:view'),
      live('preparation', 'Preparation', '/kitchen', 'kitchen', 'sales:view'),
      live('stock', 'Stock', '/inventory/stock', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      live('expenses', 'Expenses', '/expenses', 'payments', 'expense:view'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    bottomNav: ['overview', 'orders', 'preparation'],
    primaryAction: { label: 'New order', route: '/sales/checkout', implemented: true },
    secondaryActions: [
      { label: 'Add menu item', route: '/inventory/products/new', implemented: true },
      { label: 'Open kitchen queue', route: '/kitchen', implemented: true },
    ],
    terminology: {
      record: 'Order',
      recordPlural: 'Orders',
      lineItem: 'Menu item',
      stock: 'Stock',
      customer: 'Customer',
    },
    // Fulfilment states, distinct from the sale's financial status.
    statuses: ['new', 'preparing', 'ready', 'served', 'cancelled'],
    allowedTransitions: {
      new: ['preparing', 'cancelled'],
      preparing: ['ready', 'cancelled'],
      ready: ['served', 'cancelled'],
      served: [],
      cancelled: [],
    },
    stock: {
      model: 'simple',
      fractional: false,
      expiryTracked: false,
      defaultUnit: 'portion',
      units: CATEGORY_CONFIGS.restaurant.unitOptions,
      note:
        'Menu items and ingredients are the same record today. Selling a meal does NOT deduct ingredient stock, '
        + 'and the app must not imply that it does until ingredients are modelled separately.',
    },
    paymentOptions: ['cash', 'transfer', 'card', 'credit'],
    staffRoles: ['owner', 'manager', 'cashier', 'kitchen'],
    dashboard: [
      {
        key: 'open_orders',
        label: 'Open orders',
        source: 'sales.order_status',
        calculation: "COUNT of sales with order_status = 'new'",
        period: 'current',
        linkTo: '/kitchen',
        tone: 'brand',
        implemented: true,
      },
      {
        key: 'preparing',
        label: 'Preparing',
        source: 'sales.order_status',
        calculation: "COUNT of sales with order_status = 'preparing'",
        period: 'current',
        linkTo: '/kitchen',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'ready',
        label: 'Ready',
        source: 'sales.order_status',
        calculation: "COUNT of sales with order_status = 'ready'",
        period: 'current',
        linkTo: '/kitchen',
        implemented: true,
      },
      {
        key: 'sales_today',
        label: 'Completed sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'unavailable_items',
        label: 'Unavailable menu items',
        source: 'products',
        calculation: "COUNT of active menu items where stock_qty <= 0 and track_inventory",
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'danger',
        implemented: true,
      },
    ],
    reports: [
      { label: 'Sales by item', implemented: true },
      { label: 'Payment methods', implemented: true },
      { label: 'Sales by period', implemented: true },
      { label: 'Order type breakdown', implemented: false, gap: 'Order type is stored but not reported.' },
      { label: 'Sales by staff member', implemented: false, gap: 'No staff attribution report.' },
      { label: 'Cancelled orders', implemented: false, gap: 'Cancellations are not reported.' },
    ],
    emptyStates: {
      dashboard: 'No orders yet. Add a menu item, then open your first order.',
      primaryList: 'No orders yet. Create your first order to see it here.',
    },
  },

  // ---------------------------------------------------------------- tailor
  tailor: {
    category: 'tailor',
    displayName: CATEGORY_CONFIGS.tailor.label,
    onboardingDescription: CATEGORY_CONFIGS.tailor.description,
    primaryQuestion: 'Which jobs and fittings need attention?',
    defaultModules: ['inventory', 'sales', 'customers', 'tailoring'],
    nav: [
      OVERVIEW(),
      live('jobs', 'Jobs', '/jobs', 'sales', 'job:view'),
      live('clients', 'Clients', '/customers', 'customers', 'customer:view'),
      wanted('measurements', 'Measurements', '/measurements', 'customers', 'Measurements live as free text on a customer today.'),
      wanted('fittings', 'Fittings', '/fittings', 'reports', 'No fitting schedule exists.'),
      live('materials', 'Materials', '/inventory/products', 'products', 'inventory:view'),
      live('payments', 'Payments', '/payments', 'payments', 'sales:refund'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    bottomNav: ['overview', 'clients', 'materials'],
    primaryAction: { label: 'Create job', route: '/jobs', implemented: true },
    secondaryActions: [
      { label: 'Add client', route: '/customers/new', implemented: true },
      { label: 'Add material', route: '/inventory/products/new', implemented: true },
    ],
    terminology: {
      record: 'Job',
      recordPlural: 'Jobs',
      lineItem: 'Garment',
      stock: 'Materials',
      customer: 'Client',
    },
    statuses: ['received', 'in_progress', 'ready_for_fitting', 'alterations', 'ready_for_pickup', 'delivered'],
    allowedTransitions: {
      received: ['in_progress'],
      in_progress: ['ready_for_fitting'],
      ready_for_fitting: ['alterations', 'ready_for_pickup'],
      alterations: ['ready_for_fitting', 'ready_for_pickup'],
      ready_for_pickup: ['delivered', 'alterations'],
      delivered: [],
    },
    stock: {
      model: 'roll',
      fractional: true,
      expiryTracked: false,
      defaultUnit: 'yard',
      units: CATEGORY_CONFIGS.tailor.unitOptions,
      note: 'Materials may be supplied by the client. Stock must not be deducted for client-supplied fabric.',
    },
    paymentOptions: ['cash', 'transfer', 'card', 'credit'],
    staffRoles: ['owner', 'manager', 'tailor', 'cashier'],
    dashboard: [
      {
        key: 'clients',
        label: 'Clients',
        source: 'customers',
        calculation: 'COUNT of active customers for this store',
        period: 'current',
        linkTo: '/customers',
        implemented: true,
      },
      {
        key: 'sales_today',
        label: 'Payments today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today - deposits and balance payments',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'low_stock',
        label: 'Materials low',
        source: 'products',
        calculation: 'Materials where track_inventory and stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'jobs_due_soon',
        label: 'Jobs due soon',
        source: 'jobs',
        calculation: 'COUNT of open jobs with due_date within 7 days',
        period: 'next 7 days',
        linkTo: '/jobs',
        tone: 'warn',
        implemented: false,
      },
      {
        key: 'jobs_overdue',
        label: 'Overdue jobs',
        source: 'jobs',
        calculation: 'COUNT of open jobs with due_date in the past',
        period: 'current',
        linkTo: '/jobs',
        tone: 'danger',
        implemented: false,
      },
      {
        key: 'upcoming_fittings',
        label: 'Upcoming fittings',
        source: 'fittings',
        calculation: 'COUNT of fittings scheduled in the next 7 days',
        period: 'next 7 days',
        linkTo: '/fittings',
        implemented: false,
      },
      {
        key: 'awaiting_pickup',
        label: 'Awaiting pickup',
        source: 'jobs',
        calculation: "COUNT of jobs with status = 'ready_for_pickup'",
        period: 'current',
        linkTo: '/jobs',
        implemented: false,
      },
      {
        key: 'outstanding_balances',
        label: 'Outstanding balances',
        source: 'jobs',
        calculation: 'SUM(price - deposit - payments) across undelivered jobs',
        period: 'current',
        linkTo: '/jobs',
        implemented: false,
      },
    ],
    reports: [
      { label: 'Jobs completed', implemented: false, gap: 'Needs the job record.' },
      { label: 'Turnaround time', implemented: false, gap: 'Needs job timestamps.' },
      { label: 'Revenue', implemented: true },
      { label: 'Deposits and balances', implemented: false, gap: 'Needs the job record.' },
      { label: 'Overdue jobs', implemented: false, gap: 'Needs the job record.' },
      { label: 'Work by assigned staff', implemented: false, gap: 'Needs job assignment.' },
    ],
    emptyStates: {
      dashboard: 'No jobs yet. Add a client and record their measurements to get started.',
      primaryList: 'No jobs yet.',
    },
  },

  // --------------------------------------------------------- fashion store
  fashion_store: {
    ...retailLike(),
    category: 'fashion_store',
    displayName: CATEGORY_CONFIGS.fashion_store.label,
    onboardingDescription: CATEGORY_CONFIGS.fashion_store.description,
    primaryQuestion: 'What sold, and which sizes or colours need restocking?',
    defaultModules: ['inventory', 'sales', 'customers', 'variants'],
    nav: [
      OVERVIEW(),
      live('checkout', 'Checkout', '/sales/checkout', 'sales', 'sales:create'),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('products', 'Products', '/inventory/products', 'products', 'inventory:view'),
      live('stock', 'Stock', '/inventory/stock', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    bottomNav: ['overview', 'checkout', 'products'],
    primaryAction: { label: 'New sale', route: '/sales/checkout', implemented: true },
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Variant',
      stock: 'Stock by size and colour',
      customer: 'Customer',
    },
    stock: {
      model: 'variant',
      fractional: false,
      expiryTracked: false,
      defaultUnit: 'piece',
      units: CATEGORY_CONFIGS.fashion_store.unitOptions,
      note: 'product_variants now holds stock per size/colour. Screens to manage variants are not built yet.',
    },
    dashboard: [
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'low_stock_variants',
        label: 'Low-stock variants',
        source: 'product_variants',
        calculation: 'Variants where stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: false,
      },
      {
        key: 'top_styles',
        label: 'Top-selling styles',
        source: 'sale_items',
        calculation: 'Revenue by product over the last 30 days, descending',
        period: 'last 30 days',
        linkTo: '/reports',
        implemented: false,
        gap: 'The Top products report exists; no per-type card is wired to it yet.',
      },
      {
        key: 'returns',
        label: 'Returns and exchanges',
        source: 'refunds',
        calculation: 'COUNT of refunds recorded today',
        period: 'business-local day',
        linkTo: '/payments',
        implemented: true,
      },
    ],
    reports: [
      { label: 'Sales by product', implemented: true },
      { label: 'Sales by period', implemented: true },
      { label: 'Sales by size and colour', implemented: false, gap: 'Needs variant reporting.' },
      { label: 'Stock by variant', implemented: false, gap: 'Needs a variant stock report.' },
      { label: 'Returns and exchanges', implemented: true },
    ],
    emptyStates: {
      dashboard: 'No sales yet. Add a style with its sizes and colours, then record a sale.',
      primaryList: 'No sales recorded yet.',
    },
  },

  // -------------------------------------------------------- fabric / textile
  fabric_textile: {
    ...retailLike(),
    category: 'fabric_textile',
    displayName: CATEGORY_CONFIGS.fabric_textile.label,
    onboardingDescription: CATEGORY_CONFIGS.fabric_textile.description,
    primaryQuestion: 'What fabric is available, and how much remains?',
    defaultModules: ['inventory', 'sales', 'customers', 'fabric'],
    nav: [
      OVERVIEW(),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('fabrics', 'Fabrics', '/inventory/products', 'products', 'inventory:view'),
      live('rolls', 'Rolls', '/inventory/lots', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    // Rolls are not a screen yet, so the bar exposes implemented areas only.
    bottomNav: ['overview', 'sales', 'fabrics'],
    primaryAction: { label: 'Sell fabric', route: '/sales/checkout', implemented: true },
    secondaryActions: [
      { label: 'Add fabric', route: '/inventory/products/new', implemented: true },
      { label: 'Receive a roll', route: '/inventory/rolls', implemented: false, gap: 'No roll receiving screen yet.' },
    ],
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Fabric',
      stock: 'Remaining length',
      customer: 'Customer',
    },
    stock: {
      model: 'roll',
      fractional: true,
      expiryTracked: false,
      defaultUnit: 'metre',
      units: CATEGORY_CONFIGS.fabric_textile.unitOptions,
      note:
        'Metres and yards are never silently converted: the unit travels with the lot and is shown in stock, '
        + 'checkout, receipts and reports.',
    },
    dashboard: [
      {
        key: 'low_length',
        label: 'Fabric low on length',
        source: 'stock_lots',
        calculation: 'Rolls where status = available and qty_available <= reorder threshold',
        period: 'current',
        linkTo: '/inventory/rolls',
        tone: 'warn',
        implemented: false,
      },
      {
        key: 'available_rolls',
        label: 'Available rolls',
        source: 'stock_lots',
        calculation: "COUNT of rolls with status = 'available' and qty_available > 0",
        period: 'current',
        linkTo: '/inventory/rolls',
        implemented: false,
      },
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
    ],
    reports: [
      { label: 'Length sold', implemented: false, gap: 'Needs unit-aware sales reporting.' },
      { label: 'Revenue by fabric', implemented: true },
      { label: 'Remaining quantity by roll', implemented: false, gap: 'list_remaining_rolls exists; no report screen.' },
      { label: 'Stock adjustments', implemented: false, gap: 'Needs a lot movement report.' },
    ],
    emptyStates: {
      dashboard: 'No fabric yet. Add a fabric and receive your first roll.',
      primaryList: 'No sales recorded yet.',
    },
  },

  // ------------------------------------------------------------ supermarket
  supermarket: {
    ...retailLike(),
    category: 'supermarket',
    displayName: CATEGORY_CONFIGS.supermarket.label,
    onboardingDescription: CATEGORY_CONFIGS.supermarket.description,
    primaryQuestion: 'Can the team check out customers quickly, and what needs replenishing?',
    defaultModules: ['inventory', 'sales', 'customers'],
    nav: [
      OVERVIEW(),
      live('checkout', 'Checkout', '/sales/checkout', 'sales', 'sales:create'),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('products', 'Products', '/inventory/products', 'products', 'inventory:view'),
      live('stock', 'Stock', '/inventory/stock', 'products', 'inventory:view'),
      wanted('purchases', 'Purchases', '/purchases', 'payments', 'No purchase records exist yet.'),
      wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
      live('staff', 'Staff', '/staff', 'staff', 'member:manage'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    bottomNav: ['overview', 'checkout', 'products'],
    primaryAction: { label: 'Start checkout', route: '/sales/checkout', implemented: true },
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Product',
      stock: 'Stock',
      customer: 'Customer',
    },
    stock: {
      model: 'simple',
      fractional: true,
      expiryTracked: true,
      defaultUnit: 'piece',
      units: CATEGORY_CONFIGS.supermarket.unitOptions,
      note: 'Per-product expiry dates are stored as attributes; batch-level expiry needs the batch flow.',
    },
    dashboard: [
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'transactions_today',
        label: 'Transactions',
        source: 'sales',
        calculation: 'COUNT of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'low_stock',
        label: 'Low-stock products',
        source: 'products',
        calculation: 'Products where track_inventory and stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'expiring',
        label: 'Approaching expiry',
        source: 'stock_lots',
        calculation: 'Batches expiring within 30 days with stock remaining',
        period: 'next 30 days',
        linkTo: '/pharmacy/expiry',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'cashier_activity',
        label: 'Cashier activity',
        source: 'sales',
        calculation: 'Sales count and value grouped by the staff member who recorded them, today',
        period: 'business-local day',
        linkTo: '/staff',
        implemented: false,
      },
    ],
    reports: [...retailLike().reports, { label: 'Purchases', implemented: false, gap: 'No purchase records yet.' }],
    emptyStates: {
      dashboard: 'No sales yet. Add or import products, then start a checkout to see today here.',
      primaryList: 'No sales recorded yet.',
    },
  },

  // -------------------------------------------------------------- pharmacy
  pharmacy: {
    ...retailLike(),
    category: 'pharmacy',
    displayName: CATEGORY_CONFIGS.pharmacy.label,
    onboardingDescription: CATEGORY_CONFIGS.pharmacy.description,
    primaryQuestion: 'Which items are low, unavailable, or close to expiry?',
    defaultModules: ['inventory', 'sales', 'customers', 'pharmacy'],
    nav: [
      OVERVIEW(),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('products', 'Products', '/inventory/products', 'products', 'inventory:view'),
      live('batches', 'Stock & Batches', '/inventory/lots', 'expiry', 'inventory:view'),
      live('expiry', 'Expiry', '/pharmacy/expiry', 'expiry', 'inventory:view'),
      wanted('purchases', 'Purchases', '/purchases', 'payments', 'No purchase records exist yet.'),
      wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    bottomNav: ['overview', 'sales', 'expiry'],
    primaryAction: { label: 'New sale', route: '/sales/checkout', implemented: true },
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Medicine',
      stock: 'Batch stock',
      customer: 'Customer',
    },
    // Sale statuses; batches carry their own lifecycle.
    statuses: ['draft', 'pending', 'completed', 'cancelled', 'refunded'],
    allowedTransitions: {
      draft: ['pending', 'cancelled'],
      pending: ['completed', 'cancelled'],
      completed: ['refunded'],
      cancelled: [],
      refunded: [],
    },
    stock: {
      model: 'batch',
      fractional: false,
      expiryTracked: true,
      defaultUnit: 'pack',
      units: CATEGORY_CONFIGS.pharmacy.unitOptions,
      note:
        'Batch stock with expiry is now enforced in the database: expired batches cannot be sold and each '
        + 'medicine can hold many batches. TrackOja is not an electronic medical record and gives no clinical guidance.',
    },
    dashboard: [
      {
        key: 'near_expiry',
        label: 'Near expiry',
        source: 'stock_lots (list_expiring_stock)',
        calculation: 'Batches expiring within 90 days with quantity remaining',
        period: 'next 90 days',
        linkTo: '/pharmacy/expiry',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'expired',
        label: 'Expired stock',
        source: 'stock_lots',
        calculation: "Batches with status = 'expired' or an expiry date in the past",
        period: 'current',
        linkTo: '/pharmacy/expiry',
        tone: 'danger',
        implemented: true,
      },
      {
        key: 'low_stock',
        label: 'Low stock',
        source: 'products',
        calculation: 'Products where track_inventory and stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'unavailable',
        label: 'Unavailable products',
        source: 'products',
        calculation: 'Active products with no sellable batch remaining',
        period: 'current',
        linkTo: '/inventory/products',
        implemented: false,
      },
    ],
    reports: [
      { label: 'Sales summary', implemented: true },
      { label: 'Top products', implemented: true },
      { label: 'Batch movement', implemented: false, gap: 'Lot movements are recorded; no report screen.' },
      { label: 'Expiry exposure', implemented: false, gap: 'list_expiring_stock exists; no report screen.' },
      { label: 'Purchases', implemented: false, gap: 'No purchase records yet.' },
    ],
    emptyStates: {
      dashboard: 'No stock yet. Add a medicine, then receive its first batch with an expiry date.',
      primaryList: 'No sales recorded yet.',
    },
  },

  // ----------------------------------------------------------- electronics
  electronics_gadget: {
    ...retailLike(),
    category: 'electronics_gadget',
    displayName: CATEGORY_CONFIGS.electronics_gadget.label,
    onboardingDescription: CATEGORY_CONFIGS.electronics_gadget.description,
    primaryQuestion: 'Which specific devices are in stock, sold, or under warranty?',
    defaultModules: ['inventory', 'sales', 'customers', 'gadgets'],
    nav: [
      OVERVIEW(),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('products', 'Products', '/inventory/products', 'products', 'inventory:view'),
      live('units', 'Units', '/inventory/lots', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
      wanted('warranties', 'Warranties', '/warranties', 'reports', 'No warranty record exists.'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    // A unit register is not a screen yet, so the bar exposes implemented areas only.
    bottomNav: ['overview', 'sales', 'products'],
    primaryAction: { label: 'New sale', route: '/sales/checkout', implemented: true },
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Unit',
      stock: 'Serialized stock',
      customer: 'Customer',
    },
    stock: {
      model: 'serial',
      fractional: false,
      expiryTracked: false,
      defaultUnit: 'unit',
      units: CATEGORY_CONFIGS.electronics_gadget.unitOptions,
      note:
        'A serialized unit is one indivisible thing and cannot be sold twice - enforced by a unique index on '
        + 'serial/IMEI plus a database constraint that its quantity is exactly 1. Accessories stay quantity-based.',
    },
    dashboard: [
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'units_available',
        label: 'Units available',
        source: 'stock_lots',
        calculation: "COUNT of serialized units with status = 'available'",
        period: 'current',
        linkTo: '/inventory/units',
        implemented: false,
      },
      {
        key: 'awaiting_resolution',
        label: 'Units awaiting resolution',
        source: 'stock_lots',
        calculation: "Serialized units with status in ('quarantined') - faulty or returned items",
        period: 'current',
        linkTo: '/inventory/units',
        tone: 'warn',
        implemented: false,
      },
    ],
    reports: [
      { label: 'Sales by product', implemented: true },
      { label: 'Serialized stock', implemented: false, gap: 'Needs a unit register report.' },
      { label: 'Margin', implemented: true },
      { label: 'Returns', implemented: true },
      { label: 'Warranty activity', implemented: false, gap: 'No warranty record exists.' },
    ],
    emptyStates: {
      dashboard: 'No devices yet. Add a product, then receive its units with serial numbers.',
      primaryList: 'No sales recorded yet.',
    },
  },

  // --------------------------------------------------------- beauty / cosmetics
  beauty_cosmetics: {
    ...retailLike(),
    category: 'beauty_cosmetics',
    displayName: CATEGORY_CONFIGS.beauty_cosmetics.label,
    onboardingDescription: CATEGORY_CONFIGS.beauty_cosmetics.description,
    primaryQuestion: 'Which products and shades are selling, low, or approaching expiry?',
    defaultModules: ['inventory', 'sales', 'customers'],
    nav: [
      OVERVIEW(),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('products', 'Products', '/inventory/products', 'products', 'inventory:view'),
      live('stock', 'Stock', '/inventory/stock', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    bottomNav: ['overview', 'sales', 'products'],
    primaryAction: { label: 'New sale', route: '/sales/checkout', implemented: true },
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Shade',
      stock: 'Stock by shade',
      customer: 'Customer',
    },
    stock: {
      model: 'variant',
      fractional: false,
      expiryTracked: true,
      defaultUnit: 'piece',
      units: CATEGORY_CONFIGS.beauty_cosmetics.unitOptions,
      note: 'Shades are variants; expiry needs the batch flow where the product carries a batch.',
    },
    dashboard: [
      {
        key: 'popular_products',
        label: 'Popular products',
        source: 'sale_items',
        calculation: 'Revenue by product over the last 30 days, descending',
        period: 'last 30 days',
        linkTo: '/reports',
        implemented: false,
        gap: 'The Top products report exists; no per-type card is wired to it yet.',
      },
      {
        key: 'low_stock_shades',
        label: 'Low-stock shades',
        source: 'product_variants',
        calculation: 'Variants where stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: false,
      },
      {
        key: 'near_expiry',
        label: 'Near expiry',
        source: 'stock_lots',
        calculation: 'Batches expiring within 90 days with quantity remaining',
        period: 'next 90 days',
        linkTo: '/pharmacy/expiry',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
    ],
    reports: [
      { label: 'Sales by product', implemented: true },
      { label: 'Sales by shade', implemented: false, gap: 'Needs variant reporting.' },
      { label: 'Stock by variant', implemented: false, gap: 'Needs a variant stock report.' },
      { label: 'Sales by category', implemented: true },
    ],
    emptyStates: {
      dashboard: 'No products yet. Add a product and its shades, then record a sale.',
      primaryList: 'No sales recorded yet.',
    },
  },

  // ------------------------------------------------------ building materials
  building_materials: {
    ...retailLike(),
    category: 'building_materials',
    displayName: CATEGORY_CONFIGS.building_materials.label,
    onboardingDescription: CATEGORY_CONFIGS.building_materials.description,
    primaryQuestion: 'Which quotes and orders need fulfilment, and what stock is available?',
    defaultModules: ['inventory', 'sales', 'customers'],
    nav: [
      OVERVIEW(),
      wanted('quotes', 'Quotes & Orders', '/quotes', 'sales', 'No quote or order record exists.'),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('materials', 'Materials', '/inventory/products', 'products', 'inventory:view'),
      live('stock', 'Stock', '/inventory/stock', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      wanted('suppliers', 'Suppliers', '/suppliers', 'customers', 'No supplier records exist yet.'),
      wanted('deliveries', 'Deliveries', '/deliveries', 'reports', 'No delivery record exists.'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    // Quotes are not a screen yet, so the bar exposes implemented areas only.
    bottomNav: ['overview', 'sales', 'materials'],
    primaryAction: { label: 'Create quote', route: '/quotes/new', implemented: false, gap: 'No quote record exists yet.' },
    terminology: {
      record: 'Quote',
      recordPlural: 'Quotes',
      lineItem: 'Material',
      stock: 'Stock',
      customer: 'Customer',
    },
    statuses: ['draft', 'sent', 'accepted', 'ordered', 'partially_fulfilled', 'fulfilled', 'closed', 'cancelled'],
    allowedTransitions: {
      draft: ['sent', 'cancelled'],
      sent: ['accepted', 'cancelled'],
      accepted: ['ordered', 'cancelled'],
      ordered: ['partially_fulfilled', 'fulfilled', 'cancelled'],
      partially_fulfilled: ['fulfilled'],
      fulfilled: ['closed'],
      closed: [],
      cancelled: [],
    },
    stock: {
      model: 'simple',
      fractional: true,
      expiryTracked: false,
      defaultUnit: 'bag',
      units: CATEGORY_CONFIGS.building_materials.unitOptions,
      note:
        'A quote is not a sale and an accepted order is not a completed delivery. Those states are shown '
        + 'separately, and the record must never collapse them.',
    },
    dashboard: [
      {
        key: 'open_quotes',
        label: 'Open quotes',
        source: 'quotes',
        calculation: 'COUNT of quotes not yet accepted or cancelled',
        period: 'current',
        linkTo: '/quotes',
        tone: 'brand',
        implemented: false,
      },
      {
        key: 'awaiting_fulfilment',
        label: 'Orders awaiting fulfilment',
        source: 'quotes',
        calculation: 'COUNT of accepted orders with outstanding quantity',
        period: 'current',
        linkTo: '/quotes',
        implemented: false,
      },
      {
        key: 'partial_deliveries',
        label: 'Partial deliveries',
        source: 'quotes',
        calculation: 'Orders where fulfilled quantity is less than ordered quantity',
        period: 'current',
        linkTo: '/deliveries',
        tone: 'warn',
        implemented: false,
      },
      {
        key: 'low_stock',
        label: 'Low stock',
        source: 'products',
        calculation: 'Products where track_inventory and stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'receivables',
        label: 'Outstanding balances',
        source: 'customers',
        calculation: 'SUM of positive customer balances for this store',
        period: 'current',
        linkTo: '/customers',
        implemented: false,
        gap: 'The Customer balances report exists; no card is wired to it yet.',
      },
    ],
    reports: [
      { label: 'Quote conversion', implemented: false, gap: 'Needs the quote record.' },
      { label: 'Sales by product', implemented: true },
      { label: 'Outstanding orders', implemented: false, gap: 'Needs the order record.' },
      { label: 'Receivables', implemented: true },
    ],
    emptyStates: {
      dashboard: 'No quotes yet. Add your materials, then create your first quote.',
      primaryList: 'No quotes yet.',
    },
  },

  // ------------------------------------------------------------- stationery
  stationery: {
    ...retailLike(),
    category: 'stationery',
    displayName: CATEGORY_CONFIGS.stationery.label,
    onboardingDescription: CATEGORY_CONFIGS.stationery.description,
    primaryQuestion: 'What is selling, what is low, and are bulk orders pending?',
    defaultModules: ['inventory', 'sales', 'customers'],
    nav: [
      OVERVIEW(),
      live('checkout', 'Checkout', '/sales/checkout', 'sales', 'sales:create'),
      live('products', 'Products', '/inventory/products', 'products', 'inventory:view'),
      live('stock', 'Stock', '/inventory/stock', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      wanted('purchases', 'Purchases', '/purchases', 'payments', 'No purchase records exist yet.'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
    ],
    bottomNav: ['overview', 'checkout', 'products'],
    primaryAction: { label: 'New sale', route: '/sales/checkout', implemented: true },
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Item',
      stock: 'Stock',
      customer: 'Customer',
    },
    stock: {
      model: 'simple',
      fractional: false,
      expiryTracked: false,
      defaultUnit: 'piece',
      units: CATEGORY_CONFIGS.stationery.unitOptions,
      note: 'Pack and single-unit pricing both need unit_of_measure on the sale line, which now exists.',
    },
    dashboard: [
      {
        key: 'sales_today',
        label: 'Sales today',
        source: 'sales',
        calculation: 'SUM(total) of completed sales today',
        period: 'business-local day',
        linkTo: '/sales/history',
        implemented: true,
      },
      {
        key: 'frequent_items',
        label: 'Frequently sold items',
        source: 'sale_items',
        calculation: 'Quantity sold by product over the last 30 days, descending',
        period: 'last 30 days',
        linkTo: '/reports',
        implemented: false,
        gap: 'The Top products report exists; no per-type card is wired to it yet.',
      },
      {
        key: 'low_stock',
        label: 'Low stock',
        source: 'products',
        calculation: 'Products where track_inventory and stock_qty <= reorder_level',
        period: 'current',
        linkTo: '/inventory/products',
        tone: 'warn',
        implemented: true,
      },
      {
        key: 'pending_bulk_orders',
        label: 'Pending bulk orders',
        source: 'quotes',
        calculation: 'Bulk orders not yet fulfilled',
        period: 'current',
        linkTo: '/quotes',
        implemented: false,
      },
    ],
    emptyStates: {
      dashboard: 'No sales yet. Add items with their pack sizes, then start a checkout.',
      primaryList: 'No sales recorded yet.',
    },
  },

  // ----------------------------------------------------------------- other
  other: {
    ...retailLike(),
    category: 'other',
    displayName: CATEGORY_CONFIGS.other.label,
    onboardingDescription: CATEGORY_CONFIGS.other.description,
    primaryQuestion: 'What did you sell or deliver today, and what needs attention?',
    // Deliberately NOT assumed to be retail. Onboarding asks what the business
    // sells, whether it tracks stock, and whether it has a team, then sets these.
    defaultModules: ['inventory', 'sales', 'customers'],
    nav: [
      OVERVIEW(),
      live('sales', 'Sales', '/sales/history', 'sales', 'sales:view'),
      live('products', 'Products or Services', '/inventory/products', 'products', 'inventory:view'),
      live('customers', 'Customers', '/customers', 'customers', 'customer:view'),
      live('expenses', 'Expenses', '/expenses', 'payments', 'expense:view'),
      live('reports', 'Reports', '/reports', 'reports', 'reports:view'),
      live('settings', 'Settings', '/settings', 'settings', 'store:update'),
    ],
    // No checkout: whether this business sells products, services, or both is not
    // known until onboarding asks, so nothing is assumed.
    bottomNav: ['overview', 'sales', 'products'],
    primaryAction: { label: 'Choose your model', route: '/settings', implemented: true },
    terminology: {
      record: 'Sale',
      recordPlural: 'Sales',
      lineItem: 'Item or service',
      stock: 'Stock',
      customer: 'Customer',
    },
    stock: {
      model: 'simple',
      fractional: true,
      expiryTracked: false,
      defaultUnit: 'unit',
      units: CATEGORY_CONFIGS.other.unitOptions,
      note: 'Stock tracking, units and terminology are chosen during onboarding rather than assumed.',
    },
    dashboard: retailLike().dashboard,
    reports: retailLike().reports,
    emptyStates: {
      dashboard: 'Tell us what you sell so this workspace can be set up around it.',
      primaryList: 'Nothing recorded yet.',
    },
  },
};

/**
 * Makes the honesty guarantee structural: an unavailable metric must state why,
 * so a dashboard can never be quietly missing a card with no recorded reason.
 * Applying it here means a new metric cannot forget the annotation.
 */
function normaliseExperience(experience: BusinessExperience): BusinessExperience {
  return {
    ...experience,
    dashboard: experience.dashboard.map((metric) =>
      metric.implemented || metric.gap
        ? metric
        : { ...metric, gap: `No card is wired to ${metric.source} yet.` }
    ),
  };
}

export const BUSINESS_EXPERIENCES: Record<BusinessCategory, BusinessExperience> =
  Object.fromEntries(
    Object.entries(RAW_EXPERIENCES).map(([key, experience]) => [key, normaliseExperience(experience)])
  ) as Record<BusinessCategory, BusinessExperience>;

// ================================================================ accessors

export function getBusinessExperience(category: BusinessCategory | string): BusinessExperience {
  return BUSINESS_EXPERIENCES[category as BusinessCategory] ?? BUSINESS_EXPERIENCES[DEFAULT_CATEGORY];
}

/** Nav the merchant should actually see: implemented entries only. */
export function visibleNav(experience: BusinessExperience): ExperienceNavItem[] {
  return experience.nav.filter((item) => item.implemented);
}

/** The work list: everything this business needs that is not built yet. */
export function missingCapabilities(experience: BusinessExperience): string[] {
  const gaps: string[] = [];
  experience.nav.forEach((item) => {
    if (!item.implemented) gaps.push(`${item.label}: ${item.gap ?? 'not implemented'}`);
  });
  if (!experience.primaryAction.implemented) {
    gaps.push(`Primary action "${experience.primaryAction.label}": ${experience.primaryAction.gap ?? 'not implemented'}`);
  }
  experience.secondaryActions.forEach((action) => {
    if (!action.implemented) gaps.push(`${action.label}: ${action.gap ?? 'not implemented'}`);
  });
  experience.dashboard.forEach((metric) => {
    if (!metric.implemented) gaps.push(`Metric "${metric.label}": not implemented`);
  });
  experience.reports.forEach((report) => {
    if (!report.implemented) gaps.push(`Report "${report.label}": ${report.gap ?? 'not implemented'}`);
  });
  return gaps;
}

/** Modules this business could add later without disturbing existing records. */
export function addableModules(experience: BusinessExperience, allModules: string[]): string[] {
  return allModules.filter((m) => !experience.defaultModules.includes(m));
}

export const ALL_EXPERIENCES = Object.values(BUSINESS_EXPERIENCES);
