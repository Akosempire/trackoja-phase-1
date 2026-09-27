// Public landing page content.
//
// Copy here is the single source of truth for the marketing page so it can be
// reviewed without reading JSX. Everything is plain data plus a few pure
// helpers, which keeps it testable in tests/landing.test.ts.
//
// Prices are deliberately NOT in this file. The plan ladder is typed into the
// platform console, which writes `product_plans`, so a price literal here is a
// duplicate that no admin edit can reach and that drifts from what customers are
// actually charged. The page reads the published catalogue
// (`list_published_plans` through `SubscriptionService.getPublishedPlans`) and
// shapes it for the pricing section with `toPricingPlans` below.
//
// Accuracy rule for this file: a feature that the product does not ship yet must
// be marked `upcoming: true` so the page can label it instead of claiming it.

import type { PublishedPlan } from '../../services/subscription.service';

export type BillingCycle = 'monthly' | 'annual';

export interface PlanFeature {
  /** The catalogue's own feature key, so a card keys its list by identity. */
  key?: string;
  label: string;
  /** Not shipped yet - rendered with an "Upcoming" marker. */
  upcoming?: boolean;
}

/**
 * A published plan, shaped for what the pricing section renders.
 *
 * Every figure is carried over from the catalogue and none is derived from copy
 * in this file: a null price pair means the tier is published without a listed
 * price and is sold by conversation, not that a price was unavailable.
 */
export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  /** null means custom/negotiated pricing. */
  monthlyPrice: number | null;
  annualPrice: number | null;
  userLimit: string;
  features: PlanFeature[];
  /** The catalogue's own onboarding terms, or null when it states none. */
  onboardingNote: string | null;
  ctaLabel: string;
  ctaHref: string;
  /** Visually emphasised card. */
  featured: boolean;
}

/** The price fields any published plan exposes. `PublishedPlan` satisfies this. */
export interface PricedPlan {
  monthlyPrice: number | null;
  annualPrice: number | null;
}

/** A plan the catalogue publishes without prices is sold by conversation. */
export function isCustomPriced(plan: PricedPlan): boolean {
  return plan.monthlyPrice === null || plan.annualPrice === null;
}

/**
 * The published contact address. Deliberately the operating company's address
 * rather than a personal mailbox: this is what appears on the pricing section's
 * "Talk to Sales" button and on the Privacy and Terms pages.
 */
export const CONTACT_EMAIL = 'mercuriusmerchandise@gmail.com';
export const COMPANY_NAME = 'Mercurius Merchandise Limited';

// ---------------------------------------------------------------- pricing

/** `₦1234` -> `₦1,234`. Deterministic (no locale data needed). */
export function formatNaira(value: number): string {
  return `₦${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * How many monthly payments the annual price saves. The pricing baseline is
 * "two months free", i.e. annual = monthly x 10. Returns 0 for custom plans.
 */
export function monthsFree(monthlyPrice: number | null, annualPrice: number | null): number {
  if (!monthlyPrice || !annualPrice || monthlyPrice <= 0) return 0;
  return Math.round((monthlyPrice * 12 - annualPrice) / monthlyPrice);
}

export interface PriceDisplay {
  amount: string;
  suffix: string;
}

export function priceFor(plan: PricedPlan, cycle: BillingCycle): PriceDisplay {
  const { monthlyPrice, annualPrice } = plan;
  if (monthlyPrice === null || annualPrice === null) {
    return { amount: 'Custom pricing', suffix: '' };
  }
  return cycle === 'annual'
    ? { amount: formatNaira(annualPrice), suffix: '/year' }
    : { amount: formatNaira(monthlyPrice), suffix: '/month' };
}

/**
 * The seat line, from the plan's published seat limit. A plan published without
 * one has no number to quote, so it says so instead of guessing a figure.
 */
export function seatLabel(userLimit: number | null): string {
  if (userLimit === null || userLimit <= 0) return 'Custom users';
  return `Up to ${userLimit} user${userLimit === 1 ? '' : 's'}`;
}

/** The annual discount is exactly two monthly payments on every paid plan. */
export const ANNUAL_SAVINGS_LABEL = '2 months free';

/** Short line under the toggle so the saving is explicit on both settings. */
export function billingNote(cycle: BillingCycle): string {
  return cycle === 'annual'
    ? `Billed once a year · ${ANNUAL_SAVINGS_LABEL}`
    : 'Billed every month';
}

export interface PlanCta {
  label: string;
  href: string;
}

/**
 * The call to action for a published plan. A tier published without prices has
 * no checkout to send anyone to, so it gets the contact address instead.
 */
export function ctaFor(plan: Pick<PublishedPlan, 'name' | 'key'> & PricedPlan): PlanCta {
  if (isCustomPriced(plan)) {
    return {
      label: 'Talk to Sales',
      href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`TrackOja ${plan.name} enquiry`)}`,
    };
  }
  return { label: `Choose ${plan.name}`, href: `/signup?plan=${plan.key}` };
}

/**
 * Shapes one published plan for the pricing section.
 *
 * Nothing is invented: a description, onboarding note or seat limit the
 * catalogue does not state stays absent rather than being filled with plausible
 * copy, and no price is ever produced from anything but the plan itself.
 */
export function toPricingPlan(plan: PublishedPlan, featured = false): PricingPlan {
  const cta = ctaFor(plan);
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description ?? '',
    monthlyPrice: plan.monthlyPrice,
    annualPrice: plan.annualPrice,
    userLimit: seatLabel(plan.userLimit),
    features: plan.features.map((feature) => ({
      key: feature.key,
      label: feature.label,
      upcoming: feature.upcoming === true,
    })),
    onboardingNote: plan.onboardingNote,
    ctaLabel: cta.label,
    ctaHref: cta.href,
    featured,
  };
}

/**
 * Which card carries the "Recommended" marker: the dearest published plan that
 * has a price.
 *
 * The catalogue holds no marketing flag, so emphasis is a presentation choice
 * and this keeps the one the page already made — its top buyable tier. It is
 * deliberately not `isDefault`, which in the catalogue is the cheapest plan new
 * signups get and is not what the page recommends.
 */
export function recommendedPlanId(plans: PublishedPlan[]): string | null {
  let best: PublishedPlan | null = null;
  for (const plan of plans) {
    if (isCustomPriced(plan)) continue;
    if (best === null || (plan.monthlyPrice ?? 0) > (best.monthlyPrice ?? 0)) best = plan;
  }
  return best?.id ?? null;
}

/**
 * Shapes the published catalogue for the pricing section, in the order the
 * catalogue returns (its own `sort_order`, cheapest first, negotiated last).
 */
export function toPricingPlans(plans: PublishedPlan[]): PricingPlan[] {
  const featuredId = recommendedPlanId(plans);
  return plans.map((plan) => toPricingPlan(plan, plan.id === featuredId));
}

// ---------------------------------------------------------- business types

export interface BusinessPreviewRow {
  label: string;
  meta: string;
  value?: string;
  tone?: 'ok' | 'warn' | 'info';
}

export interface LandingBusinessType {
  /** Matches a BusinessCategory key in src/config/businessModules.ts. */
  id: string;
  tabLabel: string;
  heading: string;
  workflow: string;
  previewTitle: string;
  rows: BusinessPreviewRow[];
}

export const BUSINESS_TYPES: LandingBusinessType[] = [
  {
    id: 'general_retail',
    tabLabel: 'Retail shop',
    heading: 'Retail shop',
    workflow:
      'Add your products, record sales at checkout, and let stock update as you sell.',
    previewTitle: 'Products',
    rows: [
      { label: 'Golden Penny Semovita 1kg', meta: '3 left', value: '₦4,200', tone: 'warn' },
      { label: 'Peak Milk Sachet', meta: '18 left', value: '₦700', tone: 'ok' },
      { label: 'Indomie Chicken (carton)', meta: '2 left', value: '₦9,500', tone: 'warn' },
    ],
  },
  {
    id: 'restaurant',
    tabLabel: 'Restaurant',
    heading: 'Restaurant',
    workflow:
      'Set up menu items, take orders for dine-in or takeaway, and move them through the kitchen queue.',
    previewTitle: 'Kitchen queue',
    rows: [
      { label: 'Table 4 · 2 items', meta: 'New order', tone: 'info' },
      { label: 'Takeaway · 1 item', meta: 'Preparing', tone: 'warn' },
      { label: 'Table 7 · 3 items', meta: 'Ready to serve', tone: 'ok' },
    ],
  },
  {
    id: 'fashion_store',
    tabLabel: 'Fashion business',
    heading: 'Fashion business',
    workflow:
      'List items with their sizes and colours, and keep your stock count in one place.',
    previewTitle: 'Items',
    rows: [
      { label: 'Ankara Midi Dress', meta: 'Sizes S, M, L, XL · Black, Wine', value: '₦18,500' },
      { label: 'Denim Jacket', meta: 'Sizes M, L · Blue', value: '₦24,000' },
      { label: 'Kaftan Set', meta: 'Sizes L, XL · Cream', value: '₦32,000' },
    ],
  },
  {
    id: 'pharmacy',
    tabLabel: 'Pharmacy',
    heading: 'Pharmacy',
    workflow:
      'Record batch numbers and expiry dates on medicines, and see what is expiring before it does.',
    previewTitle: 'Expiry alerts',
    rows: [
      { label: 'Paracetamol 500mg · BN2026-014', meta: 'Expires 12 Oct 2026', tone: 'warn' },
      { label: 'Amoxicillin 250mg · BN2026-021', meta: 'Expires 03 Nov 2026', tone: 'info' },
      { label: 'Vitamin C 100mg · BN2026-009', meta: 'Expires 28 Dec 2026', tone: 'ok' },
    ],
  },
];

/**
 * Other business types TrackOja can be set up for. These are the categories the
 * product actually ships in src/config/businessModules.ts, so the page never
 * promises a specialised workflow that does not exist.
 */
export const OTHER_BUSINESSES = [
  'Supermarkets',
  'Electronics and gadget shops',
  'Beauty and cosmetics sellers',
  'Fabric and textile sellers',
  'Stationery stores',
  'Building material dealers',
  'Tailors and fashion designers',
];

// --------------------------------------------------------------- workflow

export interface LandingStep {
  title: string;
  detail: string;
}

export const STEPS: LandingStep[] = [
  {
    title: 'Create your business account',
    detail:
      'Sign up with your email, name your business, and confirm your address. You are in your own workspace straight away.',
  },
  {
    title: 'Choose your business type and add your products',
    detail:
      'Pick the type of business you run so TrackOja shows the right labels and fields, then add products or services. Add them yourself or import a spreadsheet.',
  },
  {
    title: 'Record sales and manage daily activity',
    detail:
      'Sell from your phone, watch stock move, keep customer records, and check how the day went.',
  },
];

// ----------------------------------------------------------- capabilities

export interface Capability {
  title: string;
  copy: string;
  fragment: { label: string; meta: string; value?: string; tone?: 'ok' | 'warn' | 'info' }[];
  note?: string;
}

export const CAPABILITIES: Capability[] = [
  {
    title: 'Make every sale count',
    copy: 'Record sales and manage checkout.',
    fragment: [
      { label: 'Cart · 3 items', meta: 'Semovita, Peak Milk, Indomie', value: '₦14,400' },
      { label: 'Payment', meta: 'Cash received', value: '₦15,000', tone: 'ok' },
    ],
  },
  {
    title: "Know what's in stock",
    copy: 'Organise products and identify items running low.',
    fragment: [
      { label: 'Golden Penny Semovita 1kg', meta: 'At or below reorder level', value: '3 left', tone: 'warn' },
      { label: 'Peak Milk Sachet', meta: 'Healthy stock', value: '18 left', tone: 'ok' },
    ],
  },
  {
    title: 'Keep customers close',
    copy: 'Keep customer and supplier records together.',
    fragment: [
      { label: 'Chidinma Okafor', meta: 'Owes on credit', value: '₦12,000' },
      { label: 'Walk-in customers', meta: '23 sales today', value: '₦96,300' },
    ],
    note: 'Supplier records are in development.',
  },
  {
    title: 'See the full picture',
    copy: 'Understand sales, expenses, and business performance through reports.',
    fragment: [
      { label: 'This week', meta: '184 sales', value: '₦1,284,500' },
      { label: 'Top product', meta: 'Best seller by revenue', value: 'Indomie carton' },
    ],
    note: 'Expense tracking is in development.',
  },
];

// ------------------------------------------------------- hero / team views

export const HERO_STATS = {
  salesToday: '₦184,500',
  salesCount: 27,
  averageSale: '₦6,833',
  lowStockCount: 3,
};

export const HERO_TRANSACTIONS = [
  { id: '#1042', amount: '₦12,400', method: 'Cash', time: '2m ago' },
  { id: '#1041', amount: '₦7,800', method: 'Transfer', time: '14m ago' },
  { id: '#1040', amount: '₦23,000', method: 'POS', time: '31m ago' },
];

export const HERO_LOW_STOCK = [
  { name: 'Golden Penny Semovita 1kg', left: '3 left' },
  { name: 'Indomie Chicken (carton)', left: '2 left' },
];

export const OWNER_VIEW_ROWS = [
  { label: 'Sales today', value: '₦184,500' },
  { label: 'Transactions', value: '27' },
  { label: 'Average sale', value: '₦6,833' },
  { label: 'Low stock items', value: '3', tone: 'warn' as const },
];

export const STAFF_VIEW_ROWS = [
  { label: 'Rice 50kg', meta: '1 x ₦62,000', value: '₦62,000' },
  { label: 'Peak Milk Sachet', meta: '4 x ₦700', value: '₦2,800' },
  { label: 'Golden Penny Semovita', meta: '2 x ₦4,200', value: '₦8,400' },
];

export const STAFF_VIEW_TOTAL = '₦73,200';

export const TEAM_ROLES = [
  { role: 'Owner', detail: 'Sees every store, sales, stock, staff, and report.' },
  { role: 'Manager', detail: 'Runs day-to-day operations for the stores they are assigned.' },
  { role: 'Cashier', detail: 'Records sales and takes payment without seeing reports.' },
  { role: 'Inventory Officer', detail: 'Manages products and stock adjustments.' },
];

export const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Businesses', href: '#businesses' },
  { label: 'Pricing', href: '#pricing' },
];
