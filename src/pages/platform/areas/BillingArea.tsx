import { updateListFilter } from '../../../utils/list-filters';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { SearchInput } from '../../../components/ui/SearchInput';
// Four billing sections share URL filters and one stable shell. Legacy secondary
// section links redirect to their canonical areas; server checks enforce access.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  PlatformAdminService,
  type PlanRevision,
  type PlatformOverviewV2,
  type PlatformProduct,
  type ProductBusiness,
  type ProductPlan,
  type SubscriptionAdjustment,
  type CommercialTransaction,
  type CommercialTransactionDetail,
  type CommercialTransactionFilters,
} from '../../../services/platformAdmin.service';
import { PlatformService } from '../../../services/platform.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import {
  PermissionDenied,
  PlatformPageHead,
  RefreshButton,
} from '../../../components/platform/PlatformPageHead';
import { AttentionList, HealthyStrip, type AttentionItem } from '../../../components/ui/AttentionList';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog, Dialog } from '../../../components/ui/Dialog';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList } from '../../../components/ui/DefList';
import { Disclosure } from '../../../components/ui/Disclosure';
import { FormField } from '../../../components/ui/FormField';
import { KpiCard, KpiGrid } from '../../../components/ui/KpiCard';
import { MeterList, type MeterItem } from '../../../components/ui/MeterList';
import { MetricStrip, type Metric } from '../../../components/ui/MetricStrip';
import { Pagination } from '../../../components/ui/Pagination';
import { SectionHead } from '../../../components/ui/SectionHead';
import { SectionState, StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Timeline, type TimelineEntry } from '../../../components/ui/Timeline';
import { useToast } from '../../../components/ui/Toast';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import {
  getReportDateRange,
  REPORT_DATE_RANGE_PRESETS,
  type ReportDateRangePreset,
} from '../../../utils/report-date-ranges';
import {
  daysUntil,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  formatRelative,
  formatSeatLimit,
  humaniseToken,
} from '../../../utils/format';
import type { PlatformRevenueByPlan, PlatformRevenueSummary } from '../../../types';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'billing')!;

const PAGE_SIZE = 25;

/** Entitlement statuses the directory endpoint can filter on (organization_products.status). */
const ENTITLEMENT_STATUSES = ['active', 'trialing', 'pending', 'past_due', 'suspended', 'expired', 'cancelled'] as const;

/** Permission key each read or write needs. The server re-checks every one of them. */
const PERMISSIONS = {
  /** Overview, catalogue, pricing history and revenue reporting. */
  view: 'platform:view',
  /** The subscription directory and one business's agreed deal. */
  entitlements: 'platform:manage_businesses',
  /** Reading and recording subscription adjustments. */
  payments: 'platform:manage_payments',
  /** Writing a plan, and publishing it. */
  plans: 'platform:manage_plans',
  /** The activation-key lifecycle summary; the key list lives in its own area. */
  activation: 'platform:manage_activation',
  /** The billing settings this area reports on. */
  settings: 'platform:manage_settings',
  /** The billing audit trail. */
  audit: 'platform:view_audit',
} as const;

/** list_platform_audit_logs accepts this as a fallback for platform:view_audit. */
const AUDIT_FALLBACK = 'platform:support';

type SectionId = 'overview' | 'plans' | 'subscriptions' | 'payments' | 'activation' | 'settings' | 'audit';

interface Section {
  id: SectionId;
  label: string;
  /** Any one of these opens the section. The server re-checks every call behind it. */
  permissions: string[];
}

const SECTIONS: Section[] = [
  { id: 'overview', label: 'Overview', permissions: [PERMISSIONS.view] },
  { id: 'plans', label: 'Plans', permissions: [PERMISSIONS.plans] },
  { id: 'subscriptions', label: 'Subscriptions', permissions: [PERMISSIONS.payments] },
  { id: 'payments', label: 'Payments', permissions: [PERMISSIONS.payments, 'platform:view_payments'] },
  { id: 'activation', label: 'Activation & access', permissions: [PERMISSIONS.activation] },
  { id: 'settings', label: 'Billing settings', permissions: [PERMISSIONS.settings] },
  { id: 'audit', label: 'Audit trail', permissions: [PERMISSIONS.audit, AUDIT_FALLBACK] },
];

/**
 * Which section an inbound link opens.
 *
 * The dashboard links straight at /platform/billing?filter=…, written before
 * this area had sections, so a filter, a search or a page with no explicit
 * ?section= still opens the list it was pointing at rather than the Overview.
 */
function resolveSection(requested: string | null, params: URLSearchParams): SectionId {
  if (requested !== null && SECTIONS.some((section) => section.id === requested)) {
    return requested as SectionId;
  }
  const filter = params.get('filter') ?? '';
  if (filter === 'failed') return 'payments';
  if (filter !== '' || params.has('status') || params.has('q') || params.has('product') || params.has('plan')) {
    return 'subscriptions';
  }
  return 'overview';
}

// ------------------------------------------------------------------ helpers

/**
 * The real server message, whatever shape it arrives in.
 *
 * Supabase returns PostgrestError objects, which are plain objects rather than
 * Error instances, so `cause instanceof Error` silently replaces the server's own
 * wording with a generic sentence. An operator cannot act on a generic sentence.
 */
function messageOf(cause: unknown): string {
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  if (cause && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return 'The request failed without a message from the server.';
}

/** require_platform_permission raises these, so they are worth distinguishing. */
function isPermissionDenied(message: string): boolean {
  return /permission denied/i.test(message);
}

/**
 * True when the failure is a missing function rather than a refusal.
 *
 * PostgREST answers an unknown function with a schema cache error, and that is
 * the one failure an operator can act on: the migration has not been applied.
 */
function looksUndeployed(message: string): boolean {
  return /schema cache|could not find the function|does not exist|404/i.test(message);
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** NULL price means custom/negotiated pricing, not zero and not missing data. */
function priceLabel(value: number | null, currency: string): string {
  return value === null ? 'Custom' : formatMoney(value, currency);
}

function priceFromJson(value: unknown, currency: string): string {
  return priceLabel(asNumber(value), currency);
}

function nullIfBlank(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

/** Seat limits arrive as unknown from JSON payloads; -1 is unlimited, NULL custom. */
function seatLabelFromJson(value: unknown): string {
  return formatSeatLimit(asNumber(value));
}

/** Store caps share user_limit's semantics (-1 unlimited, NULL custom) but not its noun. */
function storeLimitLabel(limit: number | null): string {
  if (limit === null) return 'Custom';
  if (limit === -1) return 'Unlimited';
  return `${formatNumber(limit)} store${limit === 1 ? '' : 's'}`;
}

function storeLimitFromJson(value: unknown): string {
  return storeLimitLabel(asNumber(value));
}

function trialDaysLabel(value: unknown): string {
  const days = asNumber(value);
  if (days === null) return '—';
  return days === 0 ? 'No trial' : `${formatNumber(days)} days`;
}

/** The server takes TIMESTAMPTZ; the form collects a date. */
function toTimestamp(dateOnly: string): string | null {
  if (!dateOnly) return null;
  // Local midnight, then to ISO: the date stored is the date the operator typed,
  // read back in their own timezone, rather than a UTC-midnight day.
  const parsed = new Date(`${dateOnly}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The same day widened to its last millisecond, so a `to` bound includes the whole
 * day the operator typed rather than stopping at its midnight.
 */
function toEndOfDayTimestamp(dateOnly: string): string | null {
  if (!dateOnly) return null;
  const parsed = new Date(`${dateOnly}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toDateInput(timestamp: string | null): string {
  if (!timestamp) return '';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
}

interface AnnualOffer {
  /** Twelve monthly payments less the annual price. Negative = annual costs more. */
  amount: number;
  /** The saving expressed in months of the monthly price. */
  months: number;
}

/**
 * The annual offer, computed from the two stored prices.
 *
 * The agreed ladder is monthly x 10, but the interface only says so where the
 * arithmetic on the row agrees with it: a column that assumed "two months free"
 * would keep claiming it after either price was edited.
 */
function annualOffer(plan: ProductPlan): AnnualOffer | null {
  if (plan.monthlyPrice === null || plan.annualPrice === null || plan.monthlyPrice <= 0) return null;
  const twelveMonthlyPayments = plan.monthlyPrice * 12;
  const amount = twelveMonthlyPayments - plan.annualPrice;
  return { amount, months: amount / plan.monthlyPrice };
}

function monthsFreeLabel(months: number): string {
  const rounded = Math.round(months * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} months` : `~${rounded.toFixed(1)} months`;
}

function findListPlan(plans: ProductPlan[], row: ProductBusiness): ProductPlan | null {
  if (!row.planKey) return null;
  return plans.find((plan) => plan.productKey === row.productKey && plan.key === row.planKey) ?? null;
}

/**
 * Whether a plan is on sale, by the definition list_published_plans applies.
 *
 * Active, publicly offered, published, and past its effective date — the one test
 * the public pricing page and the customer Billing page both read, which is what
 * stops the three surfaces disagreeing. A NULL effective_from fails the date test,
 * so an unpublished row cannot leak out through it.
 *
 * `publishedAt === undefined` means the database predates migration 092 and the
 * column is not returned at all: the operator's intent (active and public) is then
 * the only thing that can be reported, and the caller says so.
 */
function isCustomerVisible(plan: ProductPlan, now = Date.now()): boolean {
  if (plan.status !== 'active' || !plan.isPublic) return false;
  if (plan.publishedAt === undefined) return true;
  if (plan.publishedAt === null || !plan.effectiveFrom) return false;
  const effective = new Date(plan.effectiveFrom).getTime();
  return !Number.isNaN(effective) && effective <= now;
}

/**
 * What the catalogue says about a plan's publication state.
 *
 * Three states, not two: `undefined` means list_product_plans does not return
 * published_at at all, which says nothing about the plan. Reporting that as
 * "never published" would be a claim the payload does not support.
 */
function publicationLabel(plan: ProductPlan): { value: ReactNode; muted: boolean } {
  if (plan.publishedAt === undefined) {
    return { value: 'Not returned by list_product_plans, so it cannot be read here', muted: true };
  }
  if (plan.publishedAt === null) {
    return { value: 'Never published — a plan is customer-visible only once it is published', muted: true };
  }
  return {
    value: `${formatDateTime(plan.publishedAt)} · effective ${
      plan.effectiveFrom ? formatDate(plan.effectiveFrom) : 'not set, so not on sale yet'
    }`,
    muted: false,
  };
}

interface InboundFilter {
  status: string;
  /**
   * A date window the directory endpoint cannot express, applied in this browser
   * and stated in the interface rather than silently narrowing the rows.
   */
  window: 'expiring' | 'trials' | null;
  paymentsUnavailable: boolean;
}

/**
 * Maps the ?filter= values the Overview links with onto real server filters.
 *
 * Explicit trials use trialing. Expiring and trials also apply a date window.
 */
function resolveInboundFilter(filter: string): InboundFilter {
  switch (filter) {
    case 'active':
    case 'pending':
    case 'past_due':
    case 'suspended':
    case 'expired':
    case 'cancelled':
      return { status: filter, window: null, paymentsUnavailable: false };
    case 'trialing':
      return { status: 'trialing', window: null, paymentsUnavailable: false };
    case 'trials':
      return { status: 'trialing', window: 'trials', paymentsUnavailable: false };
    case 'expiring':
      return { status: 'active', window: 'expiring', paymentsUnavailable: false };
    case 'failed':
      return { status: '', window: null, paymentsUnavailable: true };
    default:
      return { status: '', window: null, paymentsUnavailable: false };
  }
}

/** A permission refusal is a different state from an outage. */
function SectionFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  if (isPermissionDenied(message)) {
    return <StateBlock variant="denied" title="The server refused this read" body={message} />;
  }
  return (
    <StateBlock
      variant="error"
      title="Could not load this panel"
      body={message}
      actions={
        <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
          <span className="btn-label">Try again</span>
        </button>
      }
    />
  );
}

function LoadingLines() {
  return (
    <div className="skeleton-inline" role="status" aria-label="Loading">
      <span className="skeleton skeleton-text" />
      <span className="skeleton skeleton-text" />
      <span className="skeleton skeleton-text is-short" />
    </div>
  );
}

// ------------------------------------------------------------- data loading

/**
 * Plans and products, read together but kept apart.
 *
 * The catalogue cannot be filtered by product without the product list, yet a
 * product list that failed must not blank the plans that did arrive, so both
 * results are inspected separately.
 */
function useCatalogue(permitted: boolean, productKey: string, refreshToken: number) {
  const [plans, setPlans] = useState<ProductPlan[]>([]);
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    const [planResult, productResult] = await Promise.allSettled([
      PlatformAdminService.listPlans(productKey || undefined),
      PlatformAdminService.listProducts(),
    ]);
    if (planResult.status === 'fulfilled') {
      setPlans(planResult.value);
    } else {
      setPlans([]);
      setError(messageOf(planResult.reason));
    }
    setProducts(productResult.status === 'fulfilled' ? productResult.value : []);
    setLoading(false);
  }, [permitted, productKey, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { plans, products, loading, error, reload: load };
}

function useEntitlements(
  permitted: boolean,
  productKey: string,
  search: string,
  status: string,
  page: number,
  refreshToken: number,
) {
  const [rows, setRows] = useState<ProductBusiness[]>([]);
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    try {
      setRows(
        await PlatformAdminService.listBusinesses({
          productKey: productKey || undefined,
          search: search || undefined,
          status: status || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
      );
    } catch (cause) {
      setRows([]);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [permitted, productKey, search, status, page, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, reload: load };
}

/** How many entitlements the browser-side date windows below are computed over. */
const WATCHLIST_LIMIT = 200;

/**
 * Trials ending soon, and entitlements past their expiry.
 *
 * list_product_businesses filters on status only, so a date window cannot be
 * asked for: the newest 200 entitlements are read and the windows applied here,
 * exactly as the entitlement directory already applies its own. Every headline
 * count on the Overview comes from get_platform_overview_v2 instead, so a capped
 * read can never be mistaken for the whole directory.
 */
function useEntitlementWatchlist(permitted: boolean, refreshToken: number) {
  const [rows, setRows] = useState<ProductBusiness[]>([]);
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await PlatformAdminService.listBusinesses({ limit: WATCHLIST_LIMIT }));
    } catch (cause) {
      setRows([]);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [permitted, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, reload: load };
}

function useBillingOverview(permitted: boolean, refreshToken: number) {
  const [data, setData] = useState<PlatformOverviewV2 | null>(null);
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    try {
      setData(await PlatformAdminService.getOverview());
    } catch (cause) {
      setData(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [permitted, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}

function useRevenue(permitted: boolean, preset: ReportDateRangePreset, refreshToken: number) {
  const [summary, setSummary] = useState<PlatformRevenueSummary | null>(null);
  const [byPlan, setByPlan] = useState<PlatformRevenueByPlan[]>([]);
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    const { from, to } = getReportDateRange(preset);
    const [summaryResult, byPlanResult] = await Promise.allSettled([
      PlatformService.getRevenueSummary(from, to),
      PlatformService.getRevenueByPlan(from, to),
    ]);
    if (summaryResult.status === 'fulfilled') {
      setSummary(summaryResult.value);
    } else {
      setSummary(null);
      setError(messageOf(summaryResult.reason));
    }
    setByPlan(byPlanResult.status === 'fulfilled' ? byPlanResult.value : []);
    setLoading(false);
  }, [permitted, preset, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { summary, byPlan, loading, error, reload: load };
}

function useAdjustments(permitted: boolean, refreshToken: number) {
  const [rows, setRows] = useState<SubscriptionAdjustment[]>([]);
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await PlatformAdminService.listAdjustments(undefined, 100));
    } catch (cause) {
      setRows([]);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [permitted, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, reload: load };
}

/**
 * The billing slice of the audit trail.
 *
 * Four filtered reads, merged and de-duplicated. One family failing leaves the
 * other three on screen: the failure is reported beside them rather than
 * replacing them with an error, because a partial history is still evidence.
 */

// ------------------------------------------------------------ plan revisions

interface RevisionField {
  key: string;
  label: string;
  format: (value: unknown, currency: string) => string;
}

const REVISION_FIELDS: RevisionField[] = [
  { key: 'monthly_price', label: 'Monthly', format: (value, currency) => priceFromJson(value, currency) },
  { key: 'annual_price', label: 'Annual', format: (value, currency) => priceFromJson(value, currency) },
  { key: 'setup_fee', label: 'Setup fee', format: (value, currency) => priceFromJson(value, currency) },
  { key: 'user_limit', label: 'Seats', format: (value) => seatLabelFromJson(value) },
  { key: 'store_limit', label: 'Stores', format: (value) => storeLimitFromJson(value) },
  { key: 'trial_days', label: 'Trial', format: (value) => trialDaysLabel(value) },
  { key: 'status', label: 'Status', format: (value) => humaniseToken(asText(value)) },
  { key: 'billing_cycle', label: 'Billing cycle', format: (value) => humaniseToken(asText(value)) },
  {
    key: 'published_at',
    label: 'Published',
    format: (value) => (asText(value) ? formatDateTime(asText(value)) : 'not published'),
  },
  {
    key: 'effective_from',
    label: 'Effective from',
    format: (value) => (asText(value) ? formatDate(asText(value)) : 'not set'),
  },
];

/**
 * What a revision actually changed, from the before/after maps the server wrote.
 *
 * Only fields that differ are listed, so the history reads as changes rather than
 * as two dumps of the same row. Revisions written before billing_cycle existed
 * simply show nothing for it.
 */
function describeRevision(revision: PlanRevision, plan: ProductPlan): string {
  const before = revision.previousValues;
  const after = revision.newValues;
  if (!before) return 'Created — no previous version.';

  const changes: string[] = [];
  const nameBefore = asText(before.name);
  const nameAfter = asText(after?.name);
  if (nameBefore !== nameAfter) {
    changes.push(`name ${nameBefore ?? '—'} → ${nameAfter ?? '—'}`);
  }

  for (const field of REVISION_FIELDS) {
    const from = before[field.key];
    const to = after?.[field.key];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    changes.push(`${field.label} ${field.format(from, plan.currency)} → ${field.format(to, plan.currency)}`);
  }

  const featuresBefore = Array.isArray(before.features) ? before.features.length : null;
  const featuresAfter = Array.isArray(after?.features) ? after.features.length : null;
  if (featuresBefore !== featuresAfter) {
    changes.push(`feature list ${formatNumber(featuresBefore)} → ${formatNumber(featuresAfter)} entries`);
  }

  return changes.length > 0 ? changes.join(' · ') : 'No field changed.';
}

// ------------------------------------------------------- plan edit + preview

interface PlanDraft {
  name: string;
  description: string;
  monthlyPrice: string;
  annualPrice: string;
  setupFee: string;
  userLimit: string;
  status: ProductPlan['status'];
  isDefault: boolean;
  isPublic: boolean;
  featuresJson: string;
  onboardingNote: string;
}

/** A copy of the stored plan. Nothing here writes until the operator confirms. */
function draftFromPlan(plan: ProductPlan): PlanDraft {
  return {
    name: plan.name,
    description: plan.description ?? '',
    monthlyPrice: plan.monthlyPrice === null ? '' : String(plan.monthlyPrice),
    annualPrice: plan.annualPrice === null ? '' : String(plan.annualPrice),
    setupFee: plan.setupFee === null ? '' : String(plan.setupFee),
    userLimit: plan.userLimit === null ? '' : String(plan.userLimit),
    status: plan.status,
    isDefault: plan.isDefault,
    isPublic: plan.isPublic,
    featuresJson: JSON.stringify(plan.features ?? [], null, 2),
    onboardingNote: plan.onboardingNote ?? '',
  };
}

function parseNumberField(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Interface validation mirroring upsert_product_plan's own checks.
 *
 * The wording on the price and seat rules is the server's, so an operator who
 * trips one sees the same sentence here as they would from a failed call.
 */
function validateDraft(draft: PlanDraft): string | null {
  if (draft.name.trim() === '') {
    return 'A plan name is required; the server accepts an empty one, but the catalogue would then read as blank.';
  }
  const monthly = parseNumberField(draft.monthlyPrice);
  if (draft.monthlyPrice.trim() !== '' && (monthly === null || monthly < 0)) {
    return 'Monthly price cannot be negative. Blank means custom pricing.';
  }
  const annual = parseNumberField(draft.annualPrice);
  if (draft.annualPrice.trim() !== '' && (annual === null || annual < 0)) {
    return 'Annual price cannot be negative. Blank means custom pricing.';
  }
  const setupFee = parseNumberField(draft.setupFee);
  if (draft.setupFee.trim() !== '' && (setupFee === null || setupFee < 0)) {
    return 'Setup fee cannot be negative. Blank means no setup fee.';
  }
  const seats = parseNumberField(draft.userLimit);
  if (draft.userLimit.trim() !== '' && seats !== null && seats !== -1 && seats < 1) {
    return 'User limit must be positive, -1 for unlimited, or NULL for custom';
  }
  try {
    const parsed: unknown = JSON.parse(draft.featuresJson);
    if (!Array.isArray(parsed)) return 'Features must be a JSON array of { key, label, upcoming }.';
  } catch (cause) {
    return `Features is not valid JSON: ${messageOf(cause)}`;
  }
  return null;
}

/** Every difference the save would write, in the order the form presents them. */
function describePlanChanges(plan: ProductPlan, draft: PlanDraft, statusAfterSave: ProductPlan['status']): string[] {
  const changes: string[] = [];
  if (draft.name.trim() !== plan.name) changes.push(`Name "${plan.name}" → "${draft.name.trim()}"`);

  const monthly = parseNumberField(draft.monthlyPrice);
  if (monthly !== plan.monthlyPrice) {
    changes.push(
      `Monthly price ${priceLabel(plan.monthlyPrice, plan.currency)} → ${priceLabel(monthly, plan.currency)}`,
    );
  }
  const annual = parseNumberField(draft.annualPrice);
  if (annual !== plan.annualPrice) {
    changes.push(`Annual price ${priceLabel(plan.annualPrice, plan.currency)} → ${priceLabel(annual, plan.currency)}`);
  }
  const setupFee = parseNumberField(draft.setupFee);
  if (setupFee !== plan.setupFee) {
    changes.push(`Setup fee ${priceLabel(plan.setupFee, plan.currency)} → ${priceLabel(setupFee, plan.currency)}`);
  }
  const seats = parseNumberField(draft.userLimit);
  if (seats !== plan.userLimit) {
    changes.push(`Seat limit ${formatSeatLimit(plan.userLimit)} → ${formatSeatLimit(seats)}`);
  }
  if (statusAfterSave !== plan.status) {
    changes.push(`Status ${humaniseToken(plan.status)} → ${humaniseToken(statusAfterSave)}`);
  }
  if (draft.isDefault !== plan.isDefault) {
    changes.push(`Default plan ${plan.isDefault ? 'yes' : 'no'} → ${draft.isDefault ? 'yes' : 'no'}`);
  }
  if (draft.isPublic !== plan.isPublic) {
    changes.push(`Publicly offered ${plan.isPublic ? 'yes' : 'no'} → ${draft.isPublic ? 'yes' : 'no'}`);
  }
  if ((plan.description ?? '') !== draft.description.trim()) changes.push('Description changed');
  if ((plan.onboardingNote ?? '') !== draft.onboardingNote.trim()) changes.push('Onboarding note changed');

  try {
    const parsed: unknown = JSON.parse(draft.featuresJson);
    if (JSON.stringify(parsed) !== JSON.stringify(plan.features ?? [])) {
      const before = (plan.features ?? []).length;
      const after = Array.isArray(parsed) ? parsed.length : 0;
      changes.push(`Feature list ${formatNumber(before)} → ${formatNumber(after)} entries`);
    }
  } catch {
    // validateDraft has already refused an unparseable list, so this cannot fire.
  }

  return changes;
}

interface PlanEditDialogProps {
  plan: ProductPlan | null;
  /** Other plans of the same product, so the default-plan side effect can be stated. */
  siblingPlans: ProductPlan[];
  onClose: () => void;
  onSaved: () => void;
}

function PlanEditDialog({ plan, siblingPlans, onClose, onSaved }: PlanEditDialogProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<PlanDraft | null>(plan ? draftFromPlan(plan) : null);
  const [stage, setStage] = useState<'form' | 'preview'>('form');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The stored row is always the starting point, and a different plan starts a
  // fresh draft rather than carrying the previous plan's edits across.
  useEffect(() => {
    setDraft(plan ? draftFromPlan(plan) : null);
    setStage('form');
    setFormError(null);
    setBusy(false);
  }, [plan]);

  if (!plan || !draft) return null;

  // Re-bound after the guard so the save closure keeps the non-null types:
  // TypeScript does not carry a parameter's narrowing into a nested function.
  const storedPlan = plan;
  const activeDraft = draft;

  /*
   * An edit neither publishes nor unpublishes. `published_at` is absent from
   * upsert_product_plan's ON CONFLICT DO UPDATE list by design, so a live plan
   * stays live through a typo fix and a plan created here starts unpublished
   * (the column defaults to NULL) — which is what makes preview-then-publish mean
   * something. Publishing is the separate action below.
   */
  const statusAfterSave = activeDraft.status;
  const changes = describePlanChanges(storedPlan, activeDraft, statusAfterSave);
  const otherDefault = siblingPlans.find((candidate) => candidate.isDefault && candidate.id !== storedPlan.id);
  const seats = parseNumberField(activeDraft.userLimit);

  function review() {
    const invalid = validateDraft(activeDraft);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    if (changes.length === 0) {
      setFormError('Nothing has changed yet. Edit a value before saving.');
      return;
    }
    setFormError(null);
    setStage('preview');
  }

  async function save(reason: string) {
    if (reason.trim().length < 5) {
      // The function accepts a NULL note, but a price change with no note leaves
      // the pricing history unexplained, so this screen asks for one.
      throw new Error('Describe the change (at least 5 characters).');
    }
    setBusy(true);
    const toastId = toast.loading(`Saving ${storedPlan.name}…`);
    try {
      await PlatformAdminService.savePlan({
        productKey: storedPlan.productKey,
        planKey: storedPlan.key,
        name: activeDraft.name.trim(),
        description: nullIfBlank(activeDraft.description),
        monthlyPrice: parseNumberField(activeDraft.monthlyPrice),
        annualPrice: parseNumberField(activeDraft.annualPrice),
        setupFee: parseNumberField(activeDraft.setupFee),
        userLimit: parseNumberField(activeDraft.userLimit),
        features: JSON.parse(activeDraft.featuresJson) as { key: string; label: string; upcoming?: boolean }[],
        onboardingNote: nullIfBlank(activeDraft.onboardingNote),
        status: statusAfterSave,
        isDefault: activeDraft.isDefault,
        isPublic: activeDraft.isPublic,
        sortOrder: storedPlan.sortOrder,
        note: reason.trim(),
      });
      toast.update(toastId, {
        variant: 'success',
        message: `${storedPlan.name} saved`,
        description: `${humaniseToken(statusAfterSave)}. Journalled in product_plan_revisions. Existing subscribers keep their agreed prices.`,
      });
      onSaved();
      onClose();
    } catch (cause) {
      const message = messageOf(cause);
      toast.update(toastId, { variant: 'error', message: `Could not save ${storedPlan.name}`, description: message });
      // Rethrown so the confirmation stays open and shows the server's own words.
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  const consequence = [
    changes.length > 0 ? changes.join(' · ') : 'No field changed.',
    `${formatNumber(storedPlan.subscriberCount)} subscriber${storedPlan.subscriberCount === 1 ? '' : 's'} hold this plan (status active, trialing or pending). None is repriced: agreed prices are snapshotted at activation.`,
    activeDraft.isDefault && otherDefault
      ? `Making this the default also clears the flag on ${otherDefault.name}.`
      : '',
    storedPlan.publishedAt
      ? 'This plan is already published and an edit never changes that, so it stays on sale with the new values.'
      : 'This plan is not published. Saving does not publish it: it stays invisible to customers until it is published.',
    'The setup fee is charged once in the authoritative checkout total. Trials are currently unsupported, so customers are never promised an unimplemented trial.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <Dialog
        open={stage === 'form'}
        onClose={onClose}
        title={`Edit ${storedPlan.name}`}
        description={`${storedPlan.productName} · plan key ${storedPlan.key}. Nothing is written until you confirm.`}
        wide
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="ghost" onClick={() => setDraft(draftFromPlan(storedPlan))} disabled={busy}>
              Reset to stored values
            </Button>
            <Button onClick={review} disabled={busy}>
              Review change
            </Button>
          </>
        }
      >
        <FormField
          id="plan-name"
          label="Name"
          value={draft.name}
          onChange={(value) => setDraft({ ...draft, name: value })}
          disabled={busy}
          required
        />

        <div className="form-group">
          <label className="form-label" htmlFor="plan-description">
            Description
          </label>
          <textarea
            id="plan-description"
            className="form-input"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            disabled={busy}
          />
        </div>

        <div className="plat-form-row">
          <FormField
            id="plan-monthly"
            label="Monthly price (NGN)"
            type="number"
            value={draft.monthlyPrice}
            onChange={(value) => setDraft({ ...draft, monthlyPrice: value })}
            placeholder="Blank = custom"
            disabled={busy}
          />
          <FormField
            id="plan-annual"
            label="Annual price (NGN)"
            type="number"
            value={draft.annualPrice}
            onChange={(value) => setDraft({ ...draft, annualPrice: value })}
            placeholder="Blank = custom"
            disabled={busy}
          />
        </div>
        <p className="form-hint">Blank means custom pricing (stored as NULL), not zero.</p>

        <FormField
          id="plan-setup-fee"
          label="One-off setup fee (NGN)"
          type="number"
          value={draft.setupFee}
          onChange={(value) => setDraft({ ...draft, setupFee: value })}
          placeholder="Blank = none"
          disabled={busy}
        />
        <p className="form-hint">Included in the first checkout only and preserved in the purchased plan version.</p>

        <div className="plat-form-row">
          <FormField
            id="plan-seats"
            label="Seat limit"
            value={draft.userLimit}
            onChange={(value) => setDraft({ ...draft, userLimit: value })}
            placeholder="-1 unlimited, blank custom"
            disabled={busy}
          />
          <div className="form-group">
            <label className="form-label" htmlFor="plan-status">
              Status
            </label>
            <select
              id="plan-status"
              className="select-input"
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as ProductPlan['status'] })}
              disabled={busy}
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="inactive">Inactive</option>
              <option value="retired">Retired</option>
            </select>
            <p className="form-hint">
              {statusAfterSave === 'draft'
                ? 'A draft stays invisible to customers whatever the other switches say.'
                : 'Retired keeps the row for existing subscribers but blocks new signups.'}
            </p>
          </div>
        </div>
        <p className="form-hint">
          Seat limit becomes {seats === null ? 'custom' : formatSeatLimit(seats)}. -1 is unlimited, blank is custom, a
          positive number is a hard cap.
        </p>

        <div className="plat-form-row">
          <label className="plat-check" htmlFor="plan-default">
            <input
              id="plan-default"
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
              disabled={busy}
            />
            Default plan for this product
          </label>
          <label className="plat-check" htmlFor="plan-public">
            <input
              id="plan-public"
              type="checkbox"
              checked={draft.isPublic}
              onChange={(event) => setDraft({ ...draft, isPublic: event.target.checked })}
              disabled={busy}
            />
            Publicly offered
          </label>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="plan-features">
            Features (JSON)
          </label>
          <textarea
            id="plan-features"
            className="form-input"
            value={draft.featuresJson}
            onChange={(event) => setDraft({ ...draft, featuresJson: event.target.value })}
            disabled={busy}
          />
          <p className="form-hint">
            A JSON array of {'{ key, label, upcoming }'}. It replaces the stored array.
          </p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="plan-onboarding">
            Onboarding note
          </label>
          <textarea
            id="plan-onboarding"
            className="form-input"
            value={draft.onboardingNote}
            onChange={(event) => setDraft({ ...draft, onboardingNote: event.target.value })}
            disabled={busy}
          />
        </div>

        {changes.length > 0 && (
          <>
            <p className="plat-section-sub">Pending changes (not saved yet)</p>
            <ul className="list">
              {changes.map((change, index) => (
                <li className="list-item" key={`${index}-${change}`}>
                  <div>
                    <p className="list-item-subtitle">{change}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
      </Dialog>

      <ConfirmDialog
        open={stage === 'preview'}
        onClose={() => setStage('form')}
        onConfirm={save}
        title={`Save changes to ${plan.name}?`}
        confirmLabel="Save plan change"
        requireReason
        reasonLabel="Change note"
        reasonHint="At least 5 characters. Written to product_plan_revisions.note and the audit trail."
        consequence={consequence}
      />
    </>
  );
}

// ---------------------------------------------------------------- publishing

interface PublishPlanDialogProps {
  plan: ProductPlan | null;
  onClose: () => void;
  onPublished: () => void;
}

/**
 * Publishing, as a separate and deliberate step.
 *
 * publish_product_plan stamps published_at and the effective date and journals a
 * `published` revision. The impact statement below comes from the model rather
 * than from a guess: organization_products snapshots agreed_monthly_price,
 * agreed_annual_price and agreed_user_limit at activation, so a published price
 * applies to new customers only. No list of affected subscribers is drawn,
 * because no such list exists — the snapshot is per entitlement, and nothing
 * records which subscriptions a given price change would touch.
 */
function PublishPlanDialog({ plan, onClose, onPublished }: PublishPlanDialogProps) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [stage, setStage] = useState<'form' | 'review'>('form');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNote('');
    setEffectiveFrom('');
    setStage('form');
    setFormError(null);
    setBusy(false);
  }, [plan]);

  if (!plan) return null;

  const storedPlan = plan;

  function review() {
    if (note.trim().length < 5) {
      // publish_product_plan accepts a NULL note, but an unexplained price change
      // is exactly what the pricing history exists to prevent.
      setFormError('Describe the change (at least 5 characters).');
      return;
    }
    if (effectiveFrom !== '') {
      const chosen = toTimestamp(effectiveFrom);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      // The server's own requirement, restated with its own wording:
      // 'The effective date cannot be in the past'.
      if (chosen === null || new Date(chosen).getTime() < startOfToday.getTime()) {
        setFormError('The effective date cannot be in the past');
        return;
      }
    }
    setFormError(null);
    setStage('review');
  }

  async function publish() {
    setBusy(true);
    const toastId = toast.loading(`Publishing ${storedPlan.name}…`);
    try {
      await PlatformAdminService.publishPlan({
        productKey: storedPlan.productKey,
        planKey: storedPlan.key,
        note: note.trim(),
        effectiveFrom: toTimestamp(effectiveFrom),
      });
      toast.update(toastId, {
        variant: 'success',
        message: `${storedPlan.name} published`,
        description:
          'Status is now active. New subscriptions pay the published prices; existing subscribers are not repriced.',
      });
      onPublished();
      onClose();
    } catch (cause) {
      const message = messageOf(cause);
      const explained = looksUndeployed(message)
        ? 'publish_product_plan is not available on this database, so nothing was published. The publishing migration has not been applied here.'
        : message;
      toast.update(toastId, { variant: 'error', message: 'The plan was not published', description: explained });
      // Rethrown so the confirmation stays open showing the server's own words.
      throw new Error(explained);
    } finally {
      setBusy(false);
    }
  }

  const consequence = [
    `${formatNumber(storedPlan.subscriberCount)} subscriber${storedPlan.subscriberCount === 1 ? '' : 's'} hold this plan now, and none is repriced — agreed prices are snapshotted at activation.`,
    `New customers pay ${priceLabel(storedPlan.monthlyPrice, storedPlan.currency)}/month, ${priceLabel(storedPlan.annualPrice, storedPlan.currency)}/year, ${formatSeatLimit(storedPlan.userLimit)} seats.`,
    storedPlan.effectiveFrom
      ? `This plan already has an effective date of ${formatDate(storedPlan.effectiveFrom)} and publishing keeps it: the argument is COALESCEd, so a new date is recorded only when none is set.`
      : `Effective ${effectiveFrom ? formatDate(toTimestamp(effectiveFrom)) : 'immediately'}, and not buyable until that date arrives.`,
    `Note: ${note.trim()}`,
  ].join(' ');

  return (
    <>
      <Dialog
        open={stage === 'form'}
        onClose={onClose}
        title={`Publish ${storedPlan.name}`}
        description={`${storedPlan.productName} · plan key ${storedPlan.key}. Editing never publishes: this is the only write that puts a plan in front of customers.`}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={review} disabled={busy}>
              Review impact
            </Button>
          </>
        }
      >
        <div className="callout callout-info">
          <div>
            <p className="callout-title">Who this reaches</p>
            <p className="callout-text">
              New customers only. {formatNumber(storedPlan.subscriberCount)} existing subscriber
              {storedPlan.subscriberCount === 1 ? '' : 's'} keep the agreed monthly price, annual price and seat limit
              snapshotted on organization_products when they activated.
            </p>
          </div>
        </div>

        <FormField
          id="publish-note"
          label="Publishing note"
          value={note}
          onChange={setNote}
          placeholder="What changed, and why"
          hint="At least 5 characters. Written to product_plan_revisions and the audit trail."
          disabled={busy}
        />

        <FormField
          id="publish-effective-from"
          label="Effective from (optional)"
          type="date"
          value={effectiveFrom}
          onChange={setEffectiveFrom}
          disabled={busy}
        />
        <p className="form-hint">
          Blank publishes with immediate effect; the server refuses a date in the past. Nothing schedules a future
          date — the plan is simply not buyable until it arrives.
        </p>

        {!storedPlan.isPublic && (
          <p className="form-hint">
            This plan is not publicly offered, and publishing does not change that: it forces the status to active and
            leaves is_public alone, so the plan stays invisible to customers until it is made public.
          </p>
        )}

        {storedPlan.publishedAt ? (
          <p className="form-hint">
            Already published. publish_product_plan COALESCEs both stamps, so re-publishing records the note and any
            status change but does not move an existing effective date.
          </p>
        ) : null}

        {storedPlan.publishedAt === undefined && (
          <p className="form-hint">
            list_product_plans does not return published_at on this database, so the current published stamp cannot be
            shown — only the status above.
          </p>
        )}

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
      </Dialog>

      <ConfirmDialog
        open={stage === 'review'}
        onClose={() => setStage('form')}
        onConfirm={publish}
        title={`Publish ${plan.name}?`}
        confirmLabel="Publish plan"
        consequence={consequence}
      />
    </>
  );
}

// --------------------------------------------------- subscription adjustment

interface AdjustmentIntent {
  value: 'upgrade' | 'downgrade' | 'extend_expiry' | 'cancel' | 'suspend' | 'reactivate' | 'seat_change';
  label: string;
  requiresPlan: boolean;
  requiresExpiry: boolean;
  requiresSeats: boolean;
  /** The server's own requirement for this adjustment type. */
  requirement: string;
  consequence: string;
}

/**
 * The seven adjustment types this screen performs, each with the condition the
 * function actually enforces.
 *
 * record_subscription_adjustment accepts five more (change_plan, shorten_expiry,
 * reinstate, manual_price, manual_activation); they are left out of this form
 * rather than half-built, and change_plan and reinstate are each the same write as
 * an upgrade and a reactivate. The conditions below are quoted from
 * 20260927000089_platform_owner_hardening.sql, lines 705-841, which re-created
 * the function from 20260926000071 unchanged in this respect.
 */
const ADJUSTMENT_INTENTS: AdjustmentIntent[] = [
  {
    value: 'upgrade',
    label: 'Upgrade to another plan',
    requiresPlan: true,
    requiresExpiry: false,
    requiresSeats: false,
    requirement: 'A plan key is required, and the plan must belong to this product.',
    consequence:
      'The entitlement takes the new plan immediately and its agreed prices are overwritten with the new list prices. Nothing is prorated and nothing is charged.',
  },
  {
    value: 'downgrade',
    label: 'Downgrade to another plan',
    requiresPlan: true,
    requiresExpiry: false,
    requiresSeats: false,
    requirement: 'A plan key is required, and the plan must belong to this product.',
    consequence:
      'The entitlement moves to the smaller plan and its agreed prices follow. The new seat limit applies to the next staff member added; nobody is removed.',
  },
  {
    value: 'extend_expiry',
    label: 'Renew / extend expiry',
    requiresPlan: false,
    requiresExpiry: true,
    requiresSeats: false,
    requirement:
      'A new expiry date is required, and it must be later than the current expiry — the server refuses anything earlier.',
    consequence:
      'The expiry date moves and an expired entitlement returns to active. No payment is taken or verified.',
  },
  {
    value: 'cancel',
    label: 'Cancel the subscription',
    requiresPlan: false,
    requiresExpiry: false,
    requiresSeats: false,
    requirement: 'No extra field is required; the reason alone is enough.',
    consequence:
      'The entitlement is marked cancelled and stamped with the time. Prices, staff and data are untouched, and adding a staff member is refused afterwards.',
  },
  {
    value: 'suspend',
    label: 'Suspend access',
    requiresPlan: false,
    requiresExpiry: false,
    requiresSeats: false,
    requirement: 'No extra field is required; the reason alone is enough.',
    consequence:
      'The entitlement stops counting as live, so the seat check refuses new staff with "This business has no active subscription". Existing staff keep working, and the agreed prices, expiry and recorded billing status are untouched.',
  },
  {
    value: 'reactivate',
    label: 'Reactivate / reinstate',
    requiresPlan: false,
    requiresExpiry: false,
    requiresSeats: false,
    requirement:
      'A plan key and a seat limit are optional; an entitlement that has already expired also needs a new expiry date.',
    consequence:
      'The entitlement returns to active and any cancellation is cleared, so this is also how a suspension is lifted. A plan or seat limit supplied here rewrites the agreed deal.',
  },
  {
    value: 'seat_change',
    label: 'Change the seat limit',
    requiresPlan: false,
    requiresExpiry: false,
    requiresSeats: true,
    requirement: 'A seat limit of -1 (unlimited) or a positive number is required. Zero is refused.',
    consequence:
      'Only agreed_user_limit changes, enforced when the next staff member is invited, so a reduction below the current headcount removes nobody.',
  },
];

interface SubscriptionChangeDialogProps {
  target: ProductBusiness | null;
  plans: ProductPlan[];
  onClose: () => void;
  onRecorded: () => void;
}

function SubscriptionChangeDialog({ target, plans, onClose, onRecorded }: SubscriptionChangeDialogProps) {
  const toast = useToast();
  const [intentValue, setIntentValue] = useState<AdjustmentIntent['value']>('upgrade');
  const [planKey, setPlanKey] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [userLimit, setUserLimit] = useState('');
  const [stage, setStage] = useState<'form' | 'review'>('form');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const currentLimit = target?.agreedUserLimit;
    setIntentValue('upgrade');
    setPlanKey('');
    setExpiresAt(target ? toDateInput(target.expiresAt) : '');
    setUserLimit(currentLimit === null || currentLimit === undefined ? '' : String(currentLimit));
    setStage('form');
    setFormError(null);
    setBusy(false);
  }, [target]);

  if (!target) return null;

  // Re-bound after the guard so the record closure keeps the non-null type.
  const storedTarget = target;
  const intent = ADJUSTMENT_INTENTS.find((candidate) => candidate.value === intentValue) ?? ADJUSTMENT_INTENTS[0];
  // Only this product's plans are offered: the server refuses a plan from
  // another product outright ('Plan % belongs to a different product').
  const productPlans = plans.filter((candidate) => candidate.productKey === storedTarget.productKey);
  const seats = parseNumberField(userLimit);

  function review() {
    if (intent.requiresPlan && planKey === '') {
      setFormError(`A new plan key is required for a ${intent.value} adjustment`);
      return;
    }
    if (intent.requiresExpiry && expiresAt === '') {
      setFormError(`A new expiry date is required for a ${intent.value} adjustment`);
      return;
    }
    if (intent.requiresSeats && (seats === null || seats === 0 || seats < -1)) {
      setFormError('A seat limit of -1 (unlimited) or a positive number is required for a seat change');
      return;
    }
    setFormError(null);
    setStage('review');
  }

  async function record(reason: string) {
    if (reason.trim().length < 5) {
      // The server's own threshold: 'A reason of at least 5 characters is
      // required for every subscription adjustment'.
      throw new Error('A reason of at least 5 characters is required for every subscription adjustment');
    }
    setBusy(true);
    const toastId = toast.loading(`Recording ${humaniseToken(intent.value).toLowerCase()} for ${storedTarget.name}…`);
    try {
      await PlatformAdminService.recordAdjustment({
        orgId: storedTarget.orgId,
        adjustmentType: intent.value,
        productKey: storedTarget.productKey,
        newPlanKey: intent.requiresPlan ? planKey : null,
        newExpiresAt: intent.requiresExpiry ? toTimestamp(expiresAt) : null,
        newUserLimit: intent.requiresSeats ? seats : null,
        reason: reason.trim(),
      });
      toast.update(toastId, {
        variant: 'success',
        message: `${humaniseToken(intent.value)} recorded`,
        description: 'Written to subscription_adjustments and copied to the support timeline.',
      });
      onRecorded();
      onClose();
    } catch (cause) {
      const message = messageOf(cause);
      toast.update(toastId, { variant: 'error', message: 'The adjustment was refused', description: message });
      // Rethrown so the confirmation stays open showing the server's own words.
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  const summary: string[] = [`Type: ${intent.label}`, `Business: ${target.name}`, `Product: ${target.productKey}`];
  summary.push(`Current plan: ${target.planName ?? 'none recorded'}`);
  if (intent.requiresPlan && planKey !== '') summary.push(`New plan: ${planKey}`);
  if (intent.requiresExpiry && expiresAt !== '') summary.push(`New expiry: ${expiresAt}`);
  if (intent.requiresSeats && seats !== null) summary.push(`New seat limit: ${formatSeatLimit(seats)}`);

  return (
    <>
      <Dialog
        open={stage === 'form'}
        onClose={onClose}
        title={`Change the subscription for ${target.name}`}
        description={`${target.productName} · entitlement ${humaniseToken(target.entitlementStatus)} · current plan ${target.planName ?? 'none recorded'}.`}
        wide
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={review} disabled={busy}>
              Review change
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label" htmlFor="adjustment-type">
            Change
          </label>
          <select
            id="adjustment-type"
            className="select-input"
            value={intentValue}
            onChange={(event) => setIntentValue(event.target.value as AdjustmentIntent['value'])}
            disabled={busy}
          >
            {ADJUSTMENT_INTENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="callout callout-info">
          <div>
            <p className="callout-title">What the server requires for this change</p>
            <p className="callout-text">{intent.requirement}</p>
          </div>
        </div>

        {intent.requiresPlan && (
          <div className="form-group">
            <label className="form-label" htmlFor="adjustment-plan">
              New plan
            </label>
            <select
              id="adjustment-plan"
              className="select-input"
              value={planKey}
              onChange={(event) => setPlanKey(event.target.value)}
              disabled={busy || productPlans.length === 0}
            >
              <option value="">Choose a plan…</option>
              {productPlans.map((option) => (
                <option key={option.id} value={option.key}>
                  {option.name} — {priceLabel(option.monthlyPrice, option.currency)}/month
                </option>
              ))}
            </select>
            {productPlans.length === 0 && (
              <p className="form-hint">
                No plans could be read for {target.productKey}, so a plan change cannot be completed here. Expiry,
                suspension, cancellation and seat changes still work.
              </p>
            )}
          </div>
        )}

        {intent.requiresExpiry && (
          <>
            <FormField
              id="adjustment-expiry"
              label="New expiry date"
              type="date"
              value={expiresAt}
              onChange={setExpiresAt}
              disabled={busy}
            />
            <p className="form-hint">
              Current expiry: {target.expiresAt ? formatDate(target.expiresAt) : 'none recorded'}. A renewal must be later
              than this.
            </p>
          </>
        )}

        {intent.requiresSeats && (
          <FormField
            id="adjustment-seats"
            label="New seat limit"
            value={userLimit}
            onChange={setUserLimit}
            placeholder="-1 unlimited, or a positive number"
            disabled={busy}
          />
        )}

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
      </Dialog>

      <ConfirmDialog
        open={stage === 'review'}
        onClose={() => setStage('form')}
        onConfirm={record}
        title="Record this change?"
        confirmLabel="Record adjustment"
        danger={['cancel', 'downgrade', 'suspend'].includes(intent.value)}
        requireReason
        reasonLabel="Reason"
        reasonHint="At least 5 characters (the server refuses less). Stored on the adjustment and copied to the business's support timeline."
        consequence={`${summary.join(' · ')}. ${intent.consequence}`}
      />
    </>
  );
}

// ------------------------------------------------------------- agreed price

interface AgreedSnapshot {
  monthlyPrice: number | null;
  annualPrice: number | null;
  userLimit: number | null;
  source: string | null;
  planKey: string | null;
  currency: string | null;
}

/**
 * The agreed deal for one business, taken from one business's detail payload.
 *
 * list_product_businesses returns agreed_user_limit but no agreed price (its
 * column list stops there), so the only endpoint that exposes agreed prices is
 * get_platform_business, which serves one business at a time. Reading it for
 * every row would be one request per row, so it is a deliberate operator action.
 */
function pickAgreed(
  businessProductRows: Record<string, unknown>[],
  productKey: string,
): AgreedSnapshot | null {
  const row = businessProductRows.find((candidate) => asText(candidate.product_key) === productKey);
  if (!row) return null;
  return {
    monthlyPrice: asNumber(row.agreed_monthly_price),
    annualPrice: asNumber(row.agreed_annual_price),
    userLimit: asNumber(row.agreed_user_limit),
    source: asText(row.source),
    planKey: asText(row.plan_key),
    currency: asText(row.currency),
  };
}

interface CompareState {
  row: ProductBusiness;
  loading: boolean;
  error: string | null;
}

/**
 * The statuses `subscription_transactions` can hold, from its own CHECK constraint.
 *
 * Declared rather than derived from the rows on screen: the rows are now one filtered
 * page, so a derived list would lose an option the moment that filter was used.
 */
const TRANSACTION_STATUSES = ['pending', 'success', 'failed', 'abandoned'] as const;

/**
 * The stored payment modes and environments, plus the stand-in the endpoint compares a
 * NULL column against. Selecting "Not recorded" therefore matches a row whose column is
 * NULL, which is exactly what the endpoint does with `uninitialized` and `unknown`.
 */
const TRANSACTION_PAYMENT_MODES: { value: string; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'test', label: 'Test' },
  { value: 'mock', label: 'Mock' },
  { value: 'uninitialized', label: 'Not recorded' },
];

const TRANSACTION_ENVIRONMENTS: { value: string; label: string }[] = [
  { value: 'production', label: 'Production' },
  { value: 'staging', label: 'Staging' },
  { value: 'development', label: 'Development' },
  { value: 'unknown', label: 'Not recorded' },
];

/** The window the table asks for. The endpoint caps its own limit at 500 regardless. */
const TRANSACTION_WINDOW = 100;

type TestDataFilter = 'all' | 'test' | 'production';

interface TransactionQuery {
  search: string;
  status: string;
  paymentMode: string;
  environment: string;
  from: string;
  to: string;
  testData: TestDataFilter;
}

const NO_TRANSACTION_QUERY: TransactionQuery = {
  search: '',
  status: 'all',
  paymentMode: 'all',
  environment: 'all',
  from: '',
  to: '',
  testData: 'all',
};

function hasActiveTransactionFilters(query: TransactionQuery): boolean {
  return (
    query.search !== '' ||
    query.status !== 'all' ||
    query.paymentMode !== 'all' ||
    query.environment !== 'all' ||
    query.from !== '' ||
    query.to !== '' ||
    query.testData !== 'all'
  );
}

/**
 * The transaction table and its filters.
 *
 * Every filter goes to the endpoint. Filtering the returned page here would look
 * identical on a small table and be wrong on a large one: the row limit is applied
 * inside the function, so a browser-side filter would only ever search the newest page
 * and would hide a match behind newer non-matching rows. The trade is that an empty
 * result is now a real answer — no attempt matches — rather than "none in this page".
 */
function CommercialTransactionsPanel({
  permitted,
  refreshToken,
  initialStatus = 'all',
}: {
  permitted: boolean;
  refreshToken: number;
  /** Seeds the status filter so an inbound failed-payments link lands filtered. */
  initialStatus?: string;
}) {
  const [rows, setRows] = useState<CommercialTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState<TransactionQuery>({ ...NO_TRANSACTION_QUERY, status: initialStatus });
  const [searchDraft, setSearchDraft] = useState('');
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft] = useState('');
  const [detailReference, setDetailReference] = useState<string | null>(null);

  useEffect(() => {
    if (!permitted) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters: CommercialTransactionFilters = {
      search: nullIfBlank(query.search) ?? undefined,
      status: query.status,
      paymentMode: query.paymentMode,
      environment: query.environment,
      // A date input gives a calendar day and the endpoint compares timestamps, so
      // the range is widened to whole days in this browser's timezone.
      from: toTimestamp(query.from) ?? undefined,
      to: toEndOfDayTimestamp(query.to) ?? undefined,
      testOnly: query.testData === 'all' ? null : query.testData === 'test',
      limit: TRANSACTION_WINDOW,
    };
    PlatformAdminService.listCommercialTransactions(filters)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((cause) => {
        if (cancelled) return;
        setRows([]);
        setError(messageOf(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [permitted, refreshToken, retry, query]);

  if (!permitted) {
    return (
      <StateBlock
        variant="denied"
        title="Payment records need platform:view_payments"
        body="This section opens with platform:manage_payments or platform:view_payments, but list_platform_commercial_transactions and get_platform_commercial_transaction both require platform:view_payments. This account does not hold that key, so no request is made and no transaction is read. A platform owner can grant it from Users & roles."
      />
    );
  }

  if (error) {
    return (
      <StateBlock
        variant="error"
        title="Transactions unavailable"
        body={error}
        actions={
          <Button variant="outline" className="btn-sm" onClick={() => setRetry((value) => value + 1)}>
            Try again
          </Button>
        }
      />
    );
  }

  const filtersActive = hasActiveTransactionFilters(query);
  const rangeInverted = query.from !== '' && query.to !== '' && query.from > query.to;

  function applyFilters() {
    setQuery((current) => ({ ...current, search: searchDraft.trim(), from: fromDraft, to: toDraft }));
  }

  function setQueryField<K extends keyof TransactionQuery>(key: K, value: TransactionQuery[K]) {
    setQuery((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setQuery({ ...NO_TRANSACTION_QUERY });
    setSearchDraft('');
    setFromDraft('');
    setToDraft('');
  }

  return (
    <div>
      <form
        className="plat-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <div className="plat-field plat-field-grow">
          <label className="form-label" htmlFor="billing-transaction-search">Search transactions</label>
          <SearchInput
            aria-label="Search transactions"
            id="billing-transaction-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Reference, business, plan, document or gateway reference"
          />
        </div>

        <div className="plat-field">
          <label className="form-label" htmlFor="billing-transaction-status">Status</label>
          <select
            id="billing-transaction-status"
            className="select-input"
            value={query.status}
            onChange={(event) => setQueryField('status', event.target.value)}
          >
            <option value="all">All statuses</option>
            {TRANSACTION_STATUSES.map((value) => (
              <option key={value} value={value}>{humaniseToken(value)}</option>
            ))}
          </select>
        </div>

        <div className="plat-field">
          <label className="form-label" htmlFor="billing-transaction-mode">Payment mode</label>
          <select
            id="billing-transaction-mode"
            className="select-input"
            value={query.paymentMode}
            onChange={(event) => setQueryField('paymentMode', event.target.value)}
          >
            <option value="all">Any mode</option>
            {TRANSACTION_PAYMENT_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </div>

        <div className="plat-field">
          <label className="form-label" htmlFor="billing-transaction-environment">Environment</label>
          <select
            id="billing-transaction-environment"
            className="select-input"
            value={query.environment}
            onChange={(event) => setQueryField('environment', event.target.value)}
          >
            <option value="all">Any environment</option>
            {TRANSACTION_ENVIRONMENTS.map((environment) => (
              <option key={environment.value} value={environment.value}>{environment.label}</option>
            ))}
          </select>
        </div>

        <div className="plat-field">
          <label className="form-label" htmlFor="billing-transaction-from">From</label>
          <input
            id="billing-transaction-from"
            className="form-input"
            type="date"
            value={fromDraft}
            onChange={(event) => setFromDraft(event.target.value)}
          />
        </div>

        <div className="plat-field">
          <label className="form-label" htmlFor="billing-transaction-to">To</label>
          <input
            id="billing-transaction-to"
            className="form-input"
            type="date"
            value={toDraft}
            onChange={(event) => setToDraft(event.target.value)}
          />
        </div>

        <div className="plat-field">
          <label className="form-label" htmlFor="billing-transaction-test">Test data</label>
          <select
            id="billing-transaction-test"
            className="select-input"
            value={query.testData}
            onChange={(event) => setQueryField('testData', event.target.value as TestDataFilter)}
          >
            <option value="all">Test and production</option>
            <option value="production">Production only</option>
            <option value="test">Test only</option>
          </select>
        </div>

        <Button type="submit" variant="neutral" className="btn-sm">Apply filters</Button>
        {filtersActive && (
          <Button type="button" variant="ghost" className="btn-sm" onClick={clearFilters}>Clear filters</Button>
        )}
      </form>

      <p className="form-hint">
        Search and dates apply when you submit; the dropdowns apply as soon as they change. Every filter runs in the
        database before the row limit, so nothing matching is hidden behind a newer attempt that does not match.
      </p>

      {rangeInverted && (
        <p className="form-hint">
          The From date is after the To date, so no attempt can fall inside the range and the table is empty until one
          of them is changed.
        </p>
      )}

      <DataTable
        columns={[
          {
            key: 'reference',
            header: 'Reference',
            label: '',
            render: (row) => (
              <>
                <span className="data-table-primary mono">{row.reference}</span>
                {row.isTestData && <Badge tone="warning">Test</Badge>}
              </>
            ),
          },
          {
            key: 'business',
            header: 'Business',
            render: (row) => (
              <>
                <span className="data-table-primary">{row.businessName}</span>
                {row.businessIsSandbox && <Badge tone="workspace">sandbox</Badge>}
                <span className="data-table-secondary">
                  {row.productName ?? 'Product unavailable'} · {row.planName ?? 'No plan recorded'}
                  {row.planVersion === null ? '' : ` · v${row.planVersion}`}
                </span>
              </>
            ),
          },
          {
            key: 'amount',
            header: 'Amount',
            numeric: true,
            render: (row) => (row.amountMinor === null ? '—' : formatMoney(row.amountMinor / 100, row.currency)),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <>
                <StatusBadge status={row.status} />
                {row.failureReason && <span className="data-table-secondary">{row.failureReason}</span>}
              </>
            ),
          },
          {
            key: 'environment',
            header: 'Environment',
            render: (row) => (
              <>
                <span className="data-table-primary">
                  {row.environment ? humaniseToken(row.environment) : 'Not recorded'}
                </span>
                <span className="data-table-secondary">
                  {row.paymentMode ? `${humaniseToken(row.paymentMode)} mode` : 'Mode not recorded'}
                  {row.billingCycle ? ` · ${humaniseToken(row.billingCycle)}` : ''}
                </span>
              </>
            ),
          },
          {
            key: 'references',
            header: 'Gateway reference',
            render: (row) =>
              row.gatewayReference || row.providerReference ? (
                <>
                  {row.gatewayReference && (
                    <span className="data-table-primary mono">{row.gatewayReference}</span>
                  )}
                  {row.providerReference && (
                    <span className="data-table-secondary mono">provider {row.providerReference}</span>
                  )}
                </>
              ) : (
                <span className="data-table-secondary">None recorded</span>
              ),
          },
          {
            key: 'document',
            header: 'Document',
            render: (row) =>
              row.receiptNumber || row.invoiceNumber ? (
                <>
                  <span className="data-table-primary mono">{row.receiptNumber ?? row.invoiceNumber}</span>
                  <span className="data-table-secondary">
                    {row.receiptNumber && row.invoiceNumber
                      ? `receipt · invoice ${row.invoiceNumber}`
                      : row.receiptNumber
                        ? 'receipt'
                        : 'invoice'}
                  </span>
                </>
              ) : (
                <span className="data-table-secondary">Not issued</span>
              ),
          },
          {
            key: 'date',
            header: 'Date',
            render: (row) => formatDateTime(row.createdAt),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.reference}
        caption="Subscription payment transactions"
        stacked
        loading={loading}
        onRowClick={(row) => setDetailReference(row.reference)}
        empty={
          <StateBlock
            compact
            variant="empty"
            title={filtersActive ? 'No attempt matches these filters' : 'No transactions yet'}
            body={
              filtersActive
                ? 'The filters run in the database before the row limit, so an empty result means no attempt matches them at all rather than that a match is further down. Widen the date range or clear a filter.'
                : 'Checkout attempts appear here once a customer starts a payment.'
            }
          />
        }
      />

      <p className="form-hint">Select a row to open everything recorded for that attempt.</p>

      <CommercialTransactionDetailDialog
        reference={detailReference}
        onClose={() => setDetailReference(null)}
      />
    </div>
  );
}

/**
 * One attempt, in the order an operator reads a payment: what was charged and for what,
 * then what happened to it, then the evidence it settled on, then the documents it
 * produced, then what it did to access, and finally whether it can be refunded.
 *
 * Every absence is named rather than left blank, because "no invoice" and "the invoice
 * did not load" are different facts and only one of them is a problem to act on.
 */
function CommercialTransactionDetailDialog({
  reference,
  onClose,
}: {
  reference: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CommercialTransactionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reference) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await PlatformAdminService.getCommercialTransaction(reference));
    } catch (cause) {
      setDetail(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    void load();
  }, [load]);

  const money = (minor: number | null | undefined, currency: string) =>
    minor === null || minor === undefined ? '—' : formatMoney(minor / 100, currency);

  const amountSummary = detail
    ? (() => {
        if (detail.amountMinor === null) return 'No amount recorded';
        const total = formatMoney(detail.amountMinor / 100, detail.currency);
        if (detail.setupFeeAmountMinor !== null && detail.setupFeeAmountMinor > 0) {
          const fee = money(detail.setupFeeAmountMinor, detail.currency);
          const recurring = money(detail.recurringAmountMinor, detail.currency);
          return `${total} — ${recurring} recurring plus a one-off ${fee} setup fee`;
        }
        return total;
      })()
    : '';

  const planLine = detail
    ? detail.plan
      ? `${detail.plan.displayName ?? 'Unnamed plan'} — version ${detail.plan.version ?? 'not recorded'}`
      : detail.legacyPlanName
        ? `${detail.legacyPlanName} — legacy plan row, no immutable version`
        : 'No plan recorded'
    : '';

  const billedCycle = detail ? (detail.plan?.billingCycle ?? detail.billingCycle) : null;

  const timelineEntries: TimelineEntry[] = (detail?.timeline ?? []).map((entry, index) => ({
    id: `${entry.kind}-${entry.at}-${index}`,
    title: entry.label,
    meta: `${formatDateTime(entry.at)} · ${entry.source}`,
    text: entry.detail ?? undefined,
    tone:
      entry.kind === 'failed' || entry.kind === 'abandoned'
        ? 'danger'
        : entry.kind === 'verified' || entry.kind === 'paid'
          ? 'success'
          : 'neutral',
  }));

  const effect = detail?.subscriptionEffect ?? null;
  const periodLine =
    effect && effect.currentPeriodStart && effect.currentPeriodEnd
      ? `${formatDate(effect.currentPeriodStart)} – ${formatDate(effect.currentPeriodEnd)}`
      : null;

  return (
    <Dialog
      open={reference !== null}
      onClose={onClose}
      wide
      title={reference ? `Transaction ${reference}` : 'Transaction'}
      description="Everything recorded for this attempt: the settlement, the evidence it was verified against, the documents it produced and what it did to access."
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading && (
        <div className="skeleton-inline" role="status" aria-label="Loading the transaction">
          <span className="skeleton skeleton-text" />
          <span className="skeleton skeleton-text" />
          <span className="skeleton skeleton-text is-short" />
        </div>
      )}

      {!loading && error && (
        <StateBlock
          variant="error"
          title="Could not read this transaction"
          body={error}
          actions={
            <Button variant="outline" className="btn-sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      )}

      {!loading && !error && detail && (
        <>
          <p className="plat-section-sub">The payment</p>
          <DefList
            rows={[
              {
                term: 'Status',
                value: (
                  <>
                    <StatusBadge status={detail.status} />{' '}
                    {detail.isTestData && <Badge tone="warning">Test</Badge>}
                  </>
                ),
              },
              { term: 'Amount', value: amountSummary, muted: detail.amountMinor === null },
              {
                term: 'Charged for',
                value: (
                  <>
                    <span>{detail.product?.name ?? 'Not attributed to a catalogue product'}</span>
                    <p className="data-table-secondary">{planLine}</p>
                    <p className="data-table-secondary">
                      {billedCycle ? `${humaniseToken(billedCycle)} billing cycle` : 'Billing cycle not recorded'}
                    </p>
                  </>
                ),
              },
              {
                term: 'Business',
                value: detail.business ? (
                  <>
                    <span>{detail.business.name}</span>
                    <p className="data-table-secondary">
                      {detail.business.billingEmail ?? 'No billing email recorded'}
                      {detail.business.isSandbox ? ' · sandbox business' : ''}
                      {detail.business.billingStatus ? ` · billing ${detail.business.billingStatus}` : ''}
                    </p>
                  </>
                ) : (
                  <span className="is-locked">Not recorded</span>
                ),
              },
              {
                term: 'Environment',
                value: detail.environment ? (
                  humaniseToken(detail.environment)
                ) : (
                  <span className="is-locked">Not recorded on this attempt</span>
                ),
              },
              {
                term: 'Payment mode',
                value: detail.paymentMode ? (
                  humaniseToken(detail.paymentMode)
                ) : (
                  <span className="is-locked">Not recorded on this attempt</span>
                ),
              },
              { term: 'Created', value: formatDateTime(detail.createdAt) },
              {
                term: 'Paid',
                value: detail.paidAt ? formatDateTime(detail.paidAt) : <span className="is-locked">Not paid</span>,
              },
              {
                term: 'Failure reason',
                value: detail.failureReason ?? <span className="is-locked">None recorded</span>,
                muted: detail.failureReason === null,
              },
            ]}
          />

          <p className="plat-section-sub">Timeline</p>
          <p className="form-hint">
            Each entry names the stored table and column it came from, so a recorded event is distinguishable from a
            value derived for this view. An event that never happened is absent rather than blank.
          </p>
          <Timeline items={timelineEntries} />

          <p className="plat-section-sub">Gateway and verification</p>
          <DefList
            rows={[
              {
                term: 'Gateway reference',
                value: detail.gatewayReference ? (
                  <span className="mono">{detail.gatewayReference}</span>
                ) : (
                  <span className="is-locked">None recorded</span>
                ),
                muted: detail.gatewayReference === null,
              },
              {
                term: 'Provider reference',
                value: detail.providerReference ? (
                  <span className="mono">{detail.providerReference}</span>
                ) : (
                  <span className="is-locked">None recorded</span>
                ),
                muted: detail.providerReference === null,
              },
              {
                term: 'Settlement verified',
                value: detail.verifiedAt ? (
                  formatDateTime(detail.verifiedAt)
                ) : (
                  <span className="is-locked">Not verified</span>
                ),
                muted: detail.verifiedAt === null,
              },
              {
                term: 'Settled by',
                value: detail.settledBy ? (
                  humaniseToken(detail.settledBy)
                ) : (
                  <span className="is-locked">No settlement path recorded</span>
                ),
                muted: detail.settledBy === null,
              },
            ]}
          />
          <Disclosure summary="Raw verification data from the gateway">
            {detail.verificationData ? (
              <pre className="code-panel">{JSON.stringify(detail.verificationData, null, 2)}</pre>
            ) : (
              <StateBlock
                variant="unavailable"
                title="Not recorded"
                body="No verification payload is stored against this attempt, so there is no evidence to show. That is a fact about the attempt, not a failed read."
              />
            )}
          </Disclosure>

          <p className="plat-section-sub">Invoice and receipt</p>
          {detail.invoice ? (
            <>
              <DefList
                rows={[
                  { term: 'Invoice', value: <span className="mono">{detail.invoice.number}</span> },
                  { term: 'Invoice status', value: <StatusBadge status={detail.invoice.status} /> },
                  { term: 'Subtotal', value: money(detail.invoice.subtotalMinor, detail.invoice.currency) },
                  { term: 'Total', value: money(detail.invoice.totalMinor, detail.invoice.currency) },
                  {
                    term: 'Billing email',
                    value: detail.invoice.billingEmail ?? <span className="is-locked">None recorded</span>,
                    muted: detail.invoice.billingEmail === null,
                  },
                  {
                    term: 'Issued',
                    value: detail.invoice.issuedAt ? (
                      formatDateTime(detail.invoice.issuedAt)
                    ) : (
                      <span className="is-locked">No issue date recorded</span>
                    ),
                    muted: detail.invoice.issuedAt === null,
                  },
                  {
                    term: 'Invoice paid',
                    value: detail.invoice.paidAt ? (
                      formatDateTime(detail.invoice.paidAt)
                    ) : (
                      <span className="is-locked">Not marked paid</span>
                    ),
                    muted: detail.invoice.paidAt === null,
                  },
                ]}
              />
              <DataTable
                columns={[
                  {
                    key: 'line',
                    header: 'Line',
                    label: '',
                    render: (line) => (
                      <>
                        <span className="data-table-primary">{line.description ?? humaniseToken(line.type)}</span>
                        <span className="data-table-secondary">{humaniseToken(line.type)}</span>
                      </>
                    ),
                  },
                  {
                    key: 'amount',
                    header: 'Amount',
                    numeric: true,
                    render: (line) =>
                      money(line.totalAmountMinor ?? line.unitAmountMinor, detail.invoice?.currency ?? detail.currency),
                  },
                ]}
                rows={detail.invoice.lines}
                rowKey={(line, index) => `${line.type}-${index}`}
                caption={`Lines on invoice ${detail.invoice.number}`}
                stacked
                empty={<span className="data-table-secondary">No invoice lines recorded.</span>}
              />
            </>
          ) : (
            <StateBlock
              variant="unavailable"
              title="No invoice recorded"
              body="An invoice is written when a payment settles, so a pending, failed or abandoned attempt has none. Nothing here is a placeholder for one."
            />
          )}

          {detail.receipt ? (
            <DefList
              rows={[
                { term: 'Receipt', value: <span className="mono">{detail.receipt.number}</span> },
                { term: 'Receipt amount', value: money(detail.receipt.amountMinor, detail.receipt.currency) },
                { term: 'Receipt mode', value: humaniseToken(detail.receipt.paymentMode) },
                {
                  term: 'Receipt reference',
                  value: detail.receipt.providerReference ? (
                    <span className="mono">{detail.receipt.providerReference}</span>
                  ) : (
                    <span className="is-locked">None recorded</span>
                  ),
                  muted: detail.receipt.providerReference === null,
                },
                {
                  term: 'Receipt paid',
                  value: detail.receipt.paidAt ? (
                    formatDateTime(detail.receipt.paidAt)
                  ) : (
                    <span className="is-locked">Not marked paid</span>
                  ),
                  muted: detail.receipt.paidAt === null,
                },
              ]}
            />
          ) : (
            <StateBlock
              variant="unavailable"
              title="No receipt recorded"
              body="A receipt is written alongside the invoice when a payment settles, so an unsettled attempt has none."
            />
          )}

          <p className="plat-section-sub">Subscription effect</p>
          {effect ? (
            <DefList
              rows={[
                { term: 'Subscription', value: <StatusBadge status={effect.status} /> },
                {
                  term: 'Current period',
                  value: periodLine ?? <span className="is-locked">Period bounds not recorded</span>,
                  muted: periodLine === null,
                },
                {
                  term: 'Cancels at period end',
                  value: effect.cancelAtPeriodEnd
                    ? 'Yes — access ends at the end of the period'
                    : 'No',
                  muted: effect.cancelAtPeriodEnd === null,
                },
                {
                  term: 'Entitlement',
                  value: effect.entitlementStatus ? (
                    <StatusBadge status={effect.entitlementStatus} />
                  ) : (
                    <span className="is-locked">No entitlement for this product</span>
                  ),
                  muted: effect.entitlementStatus === null,
                },
                {
                  term: 'Access activated',
                  value: effect.entitlementActivatedAt ? (
                    formatDateTime(effect.entitlementActivatedAt)
                  ) : (
                    <span className="is-locked">Not recorded</span>
                  ),
                  muted: effect.entitlementActivatedAt === null,
                },
                {
                  term: 'Access expires',
                  value: effect.entitlementExpiresAt ? (
                    `${formatDateTime(effect.entitlementExpiresAt)} · ${formatRelative(effect.entitlementExpiresAt)}`
                  ) : (
                    <span className="is-locked">No expiry recorded</span>
                  ),
                  muted: effect.entitlementExpiresAt === null,
                },
                {
                  term: 'Entitlement plan version',
                  value: effect.entitlementPlanVersionId ? (
                    <span className="mono">{effect.entitlementPlanVersionId}</span>
                  ) : (
                    <span className="is-locked">Not recorded</span>
                  ),
                  muted: effect.entitlementPlanVersionId === null,
                },
              ]}
            />
          ) : (
            <StateBlock
              variant="unavailable"
              title="No subscription or entitlement recorded"
              body="This attempt did not settle into a subscription for the business, so there is no period, entitlement or expiry to report. One is created by settlement, not by opening checkout."
            />
          )}

          <p className="plat-section-sub">Refunds</p>
          {detail.refund && detail.refund.state === 'not_implemented' ? (
            <StateBlock
              variant="unavailable"
              title="Refunds have no authorised flow in this system"
              body={detail.refund.reason}
            />
          ) : (
            <StateBlock
              variant="unavailable"
              title="Refund state not reported"
              body="The endpoint reported no refund state for this attempt, so nothing here claims one either way."
            />
          )}
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------- screen

export default function BillingArea() {
  const { can, settings } = usePlatform();
  const [searchParams, setSearchParams] = useSearchParams();

  // Panel permissions, resolved once. The server re-checks every one of them, so
  // a stale list here can only show a state the server then refuses.
  const mayView = can(PERMISSIONS.view);
  const mayReadEntitlements = can(PERMISSIONS.entitlements);
  const mayManagePayments = can(PERMISSIONS.payments);
  const mayViewPaymentRecords = can('platform:view_payments');
  const mayManagePlans = can(PERMISSIONS.plans);
  const areaReachable = AREA.permissions.some((permission) => can(permission)) || mayView;

  // A section is offered only when the account holds one of its permissions, and
  // reaching it by URL shows the refusal instead of the panel.
  const availableSections = SECTIONS.filter((candidate) =>
    candidate.permissions.some((permission) => can(permission)),
  );
  const availableIds = new Set(availableSections.map((candidate) => candidate.id));
  const section = resolveSection(searchParams.get('section'), searchParams);
  const definition = SECTIONS.find((candidate) => candidate.id === section)!;
  const sectionAllowed = availableIds.has(section);

  const inbound = resolveInboundFilter(searchParams.get('filter') ?? '');
  const productFilter = searchParams.get('product') ?? '';
  const planFilter = searchParams.get('plan') ?? '';
  const search = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? inbound.status;
  const expiryWindow = searchParams.has('status') ? null : inbound.window;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [searchDraft, setSearchDraft] = useState(search);
  const [preset, setPreset] = useState<ReportDateRangePreset>('last30');
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<ProductPlan | null>(null);
  const [publishingPlan, setPublishingPlan] = useState<ProductPlan | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<ProductBusiness | null>(null);
  const [agreedByOrg, setAgreedByOrg] = useState<Record<string, AgreedSnapshot>>({});
  const [compare, setCompare] = useState<CompareState | null>(null);

  const catalogue = useCatalogue(mayView, productFilter, refreshToken);
  const entitlements = useEntitlements(mayReadEntitlements, productFilter, search, statusFilter, page, refreshToken);
  // Read only while the Overview is open: it is a second pass over the same
  // directory, and no other section uses it.
  const watchlist = useEntitlementWatchlist(mayReadEntitlements && section === 'overview', refreshToken);
  const overview = useBillingOverview(mayView && section === 'overview', refreshToken);
  const revenue = useRevenue(mayView, preset, refreshToken);
  const adjustments = useAdjustments(mayManagePayments, refreshToken);

  const { plans, products } = catalogue;
  const visiblePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  // Pricing history belongs to one plan, so it is read when a plan is opened (and
  // re-read after a save) rather than fetched for the whole catalogue.
  const loadRevisions = useCallback(async (planId: string) => {
    setRevisionsLoading(true);
    setRevisionsError(null);
    try {
      setRevisions(await PlatformAdminService.listPlanRevisions(planId, 50));
    } catch (cause) {
      setRevisions([]);
      setRevisionsError(messageOf(cause));
    } finally {
      setRevisionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPlanId) {
      setRevisions([]);
      setRevisionsError(null);
      return;
    }
    void loadRevisions(selectedPlanId);
  }, [selectedPlanId, loadRevisions, refreshToken]);

  /**
   * Moves to a section, applying the filters that view is behind.
   *
   * An empty value clears the key, so a metric can both set what it wants and
   * drop what would otherwise contradict it.
   */
  function openSection(id: SectionId, filters: Record<string, string> = {}) {
    const next = new URLSearchParams(searchParams);
    next.set('section', id);
    for (const [key, value] of Object.entries(filters)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete('page');
    setSearchParams(next, { replace: true });
  }

  /** Applies a URL filter and returns to page one, since offsets shift under it. */
  function setFilter(key: string, value: string) {
    const next = updateListFilter(searchParams, key, value);
    // Choosing a status replaces the inbound window with an explicit filter.
    if (key === 'status') next.delete('filter');
    setSearchParams(next, { replace: true });
  }

  function refreshAll() {
    setRefreshToken((current) => current + 1);
  }

  /** Reads the agreed deal for one business, on demand. */
  async function inspectAgreedPrice(row: ProductBusiness) {
    setCompare({ row, loading: true, error: null });
    try {
      const detail = await PlatformAdminService.getBusiness(row.orgId);
      const snapshot = pickAgreed(detail.products, row.productKey);
      if (!snapshot) {
        setCompare({
          row,
          loading: false,
          error: `${row.name} holds no ${row.productKey} entitlement row, so there is no agreed price to show.`,
        });
        return;
      }
      setAgreedByOrg((current) => ({ ...current, [row.orgId]: snapshot }));
      setCompare({ row, loading: false, error: null });
    } catch (cause) {
      setCompare({ row, loading: false, error: messageOf(cause) });
    }
  }

  // The date windows are applied here because the directory endpoint filters on
  // status only; the narrowing is stated in the UI rather than implied.
  const visibleRows = useMemo(() => {
    let rows = entitlements.rows;
    if (planFilter) {
      const wanted = planFilter.trim().toLowerCase();
      rows = rows.filter(
        (row) =>
          (row.planKey ?? '').toLowerCase() === wanted || (row.planName ?? '').toLowerCase() === wanted,
      );
    }
    if (expiryWindow === null) return rows;
    const now = Date.now();
    return rows.filter((row) => {
      const days = daysUntil(expiryWindow === 'trials' ? row.trialEndsAt : row.expiresAt, now);
      return days !== null && days >= 0 && days <= 30;
    });
  }, [entitlements.rows, expiryWindow, planFilter]);

  const cataloguedPlans = plans.filter((plan) => isCustomerVisible(plan));
  const publishedStampMissing = plans.some((plan) => plan.publishedAt === undefined);
  const subscriberTotal = plans.reduce((total, plan) => total + plan.subscriberCount, 0);
  const declaredFreeMonths = asNumber(
    settings.find((setting) => setting.key === 'billing.annual_months_free')?.value,
  );
  const offerMonths = useMemo(() => {
    const computed = plans
      .map((plan) => annualOffer(plan))
      .filter((offer): offer is AnnualOffer => offer !== null)
      .map((offer) => Math.round(offer.months * 10) / 10);
    if (computed.length === 0) return null;
    const distinct = Array.from(new Set(computed));
    return distinct.length === 1 ? distinct[0] : null;
  }, [plans]);

  const revisionEntries = useMemo<TimelineEntry[]>(() => {
    if (!visiblePlan) return [];
    return revisions.map((revision) => ({
      id: revision.id,
      title: `${humaniseToken(revision.changeType)}${revision.note ? ` — ${revision.note}` : ' — no note recorded'}`,
      meta: `${revision.changedByEmail ?? 'Unknown operator'} · ${formatDateTime(revision.createdAt)} · ${formatRelative(revision.createdAt)}`,
      text: describeRevision(revision, visiblePlan),
      tone:
        revision.changeType === 'retired'
          ? 'danger'
          : revision.changeType === 'published'
            ? 'success'
            : revision.changeType === 'created'
              ? 'accent'
              : 'neutral',
    }));
  }, [revisions, visiblePlan]);

  const adjustmentEntries = useMemo<TimelineEntry[]>(() => {
    return adjustments.rows.map((adjustment) => {
      const before = adjustment.previousValues;
      const after = adjustment.newValues;
      let diff = 'Entitlement created by this adjustment.';
      if (!before || before.existed !== false) {
        const parts: string[] = [];
        const statusBefore = asText(before?.status);
        const statusAfter = asText(after?.status);
        if (statusBefore !== statusAfter) {
          parts.push(`status ${humaniseToken(statusBefore)} → ${humaniseToken(statusAfter)}`);
        }
        const planBefore = asText(before?.plan_key);
        const planAfter = asText(after?.plan_key);
        if (planBefore !== planAfter) parts.push(`plan ${planBefore ?? 'none'} → ${planAfter ?? 'none'}`);
        const expiryBefore = asText(before?.expires_at);
        const expiryAfter = asText(after?.expires_at);
        if (expiryBefore !== expiryAfter) {
          parts.push(`expires ${formatDate(expiryBefore)} → ${formatDate(expiryAfter)}`);
        }
        const seatsBefore = asNumber(before?.agreed_user_limit);
        const seatsAfter = asNumber(after?.agreed_user_limit);
        if (seatsBefore !== seatsAfter) {
          parts.push(`seats ${formatSeatLimit(seatsBefore)} → ${formatSeatLimit(seatsAfter)}`);
        }
        const priceBefore = asNumber(before?.agreed_monthly_price);
        const priceAfter = asNumber(after?.agreed_monthly_price);
        if (priceBefore !== priceAfter) {
          parts.push(`agreed monthly ${priceLabel(priceBefore, 'NGN')} → ${priceLabel(priceAfter, 'NGN')}`);
        }
        diff = parts.length > 0 ? parts.join(' · ') : 'No recorded field changed.';
      }
      const risky = ['cancel', 'suspend', 'downgrade', 'shorten_expiry'].includes(adjustment.adjustmentType);
      return {
        id: adjustment.id,
        title: `${humaniseToken(adjustment.adjustmentType)} — ${adjustment.orgName ?? 'Unknown business'}`,
        meta: (
          <>
            {adjustment.performedByEmail ?? 'Unknown operator'} · {formatDateTime(adjustment.createdAt)}{' '}
            {adjustment.isSandbox && <Badge tone="workspace">sandbox</Badge>}
          </>
        ),
        text: (
          <>
            Reason: {adjustment.reason}
            <br />
            {diff}
          </>
        ),
        tone: (risky ? 'danger' : 'accent') as TimelineEntry['tone'],
      };
    });
  }, [adjustments.rows]);

  const revenueMeters = useMemo<MeterItem[]>(() => {
    return revenue.byPlan
      .filter((row) => row.revenue > 0)
      .map((row) => ({
        label: row.planName,
        value: row.revenue,
        display: formatMoney(row.revenue),
        detail: `${formatNumber(row.transactionCount)} txn`,
      }));
  }, [revenue.byPlan]);

  const breakdownTotal = useMemo(
    () => revenue.byPlan.reduce((total, row) => total + row.revenue, 0),
    [revenue.byPlan],
  );

  const watch = useMemo(() => {
    const now = Date.now();
    let trials = 0;
    let expired = 0;
    let soonestTrial: string | null = null;
    for (const row of watchlist.rows) {
      const trialDays = daysUntil(row.trialEndsAt, now);
      if (row.entitlementStatus === 'trialing' && trialDays !== null && trialDays >= 0 && trialDays <= 30) {
        trials += 1;
        if (!soonestTrial || (row.trialEndsAt ?? '') < soonestTrial) soonestTrial = row.trialEndsAt;
      }
      const expiryDays = daysUntil(row.expiresAt, now);
      if (expiryDays !== null && expiryDays < 0) expired += 1;
    }
    return { trials, expired, soonestTrial };
  }, [watchlist.rows]);

  const periodLabel = REPORT_DATE_RANGE_PRESETS.find((option) => option.value === preset)?.label ?? 'Selected period';

  const planColumns = useMemo<DataTableColumn<ProductPlan>[]>(
    () => [
      {
        key: 'plan',
        header: 'Plan',
        label: '',
        sortValue: (plan) => plan.name.toLowerCase(),
        render: (plan) => (
          <div>
            <span className="data-table-primary">{plan.name}</span> <span className="mono">{plan.key}</span>
            <div className="chip-row">
              {plan.isDefault && <Badge tone="brand">default</Badge>}
              <Badge tone={isCustomerVisible(plan) ? 'success' : 'neutral'}>
                {isCustomerVisible(plan) ? 'on sale' : 'not on sale'}
              </Badge>
            </div>
          </div>
        ),
      },
      {
        key: 'monthly',
        header: 'Monthly',
        numeric: true,
        sortValue: (plan) => plan.monthlyPrice ?? -1,
        render: (plan) =>
          plan.monthlyPrice === null ? (
            <div>
              <span className="data-table-primary">{priceLabel(plan.monthlyPrice, plan.currency)}</span>
              <p className="data-table-secondary">negotiated</p>
            </div>
          ) : (
            <span className="data-table-primary">{priceLabel(plan.monthlyPrice, plan.currency)}</span>
          ),
      },
      {
        key: 'annual',
        header: 'Annual',
        numeric: true,
        sortValue: (plan) => plan.annualPrice ?? -1,
        render: (plan) =>
          plan.annualPrice === null ? (
            <div>
              <span className="data-table-primary">{priceLabel(plan.annualPrice, plan.currency)}</span>
              <p className="data-table-secondary">negotiated</p>
            </div>
          ) : (
            <span className="data-table-primary">{priceLabel(plan.annualPrice, plan.currency)}</span>
          ),
      },
      {
        key: 'offer',
        header: 'Annual offer (computed)',
        render: (plan) => {
          const offer = annualOffer(plan);
          if (!offer) {
            return (
              <span className="data-table-secondary">
                {plan.monthlyPrice === null || plan.annualPrice === null ? 'Not priced' : 'No monthly price'}
              </span>
            );
          }
          if (offer.amount < 0) {
            return (
              <div>
                <Badge tone="warning">Annual costs more</Badge>
                <p className="data-table-secondary">
                  {formatMoney(Math.abs(offer.amount), plan.currency)} more than 12 months
                </p>
              </div>
            );
          }
          return (
            <div>
              <span className="data-table-primary">{formatMoney(offer.amount, plan.currency)} saved</span>
              <p className="data-table-secondary">{monthsFreeLabel(offer.months)} free</p>
            </div>
          );
        },
      },
      {
        key: 'seats',
        header: 'Seat limit',
        sortValue: (plan) => plan.userLimit ?? 0,
        render: (plan) =>
          plan.userLimit === null ? (
            <div>
              <span className="data-table-primary">{formatSeatLimit(plan.userLimit)}</span>
              <p className="data-table-secondary">agreed per deal</p>
            </div>
          ) : (
            <span className="data-table-primary">{formatSeatLimit(plan.userLimit)}</span>
          ),
      },
      {
        key: 'subscribers',
        header: 'Subscribers',
        numeric: true,
        sortValue: (plan) => plan.subscriberCount,
        render: (plan) => (
          <div>
            <span className="data-table-primary">{formatNumber(plan.subscriberCount)}</span>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortValue: (plan) => plan.status,
        render: (plan) => <StatusBadge status={plan.status} />,
      },
      {
        key: 'actions',
        header: 'Detail',
        render: (plan) => (
          <div className="data-table-cell-actions">
            <Button
              variant="ghost"
              className="btn-sm"
              aria-label={`Open ${plan.name} plan details`}
              onClick={() => setSelectedPlanId(plan.id)}
            >
              {plan.id === selectedPlanId ? 'Close' : 'Open'}
            </Button>
          </div>
        ),
      },
    ],
    [selectedPlanId],
  );

  const entitlementColumns = useMemo<DataTableColumn<ProductBusiness>[]>(
    () => [
      {
        key: 'business',
        header: 'Business',
        label: '',
        sortValue: (row) => row.name.toLowerCase(),
        render: (row) => (
          <div>
            <Link className="data-table-primary" to={`/platform/businesses/${row.orgId}`}>
              {row.name}
            </Link>{' '}
            {row.isSandbox && <Badge tone="workspace">sandbox</Badge>}
            <p className="data-table-secondary">{row.ownerEmail ?? 'No owner email'}</p>
          </div>
        ),
      },
      {
        key: 'plan',
        header: 'Plan',
        sortValue: (row) => row.planName ?? '',
        render: (row) => {
          const listPlan = mayView ? findListPlan(plans, row) : null;
          return (
            <div>
              <span className="data-table-primary">{row.planName ?? 'No plan'}</span>
              <p className="data-table-secondary">
                {row.productName} <span className="mono">{row.planKey ?? '—'}</span>
              </p>
              <p className="data-table-secondary">
                {!mayView
                  ? 'Billing cycle not readable with this account'
                  : listPlan
                    ? `${humaniseToken(listPlan.billingCycle)} billing`
                    : 'Plan not in the catalogue'}
              </p>
            </div>
          );
        },
      },
      {
        key: 'access',
        header: 'Entitlement',
        sortValue: (row) => row.entitlementStatus,
        render: (row) => (
          <div>
            <StatusBadge status={row.entitlementStatus} />
            <p className="data-table-secondary">Billing: {humaniseToken(row.billingStatus)}</p>
          </div>
        ),
      },
      {
        key: 'seats',
        header: 'Seats used',
        numeric: true,
        sortValue: (row) => row.seatUsed,
        render: (row) => {
          const limit = row.agreedUserLimit;
          const over = limit !== null && limit > -1 && row.seatUsed > limit;
          return (
            <div>
              <span className="data-table-primary">{formatNumber(row.seatUsed)}</span>
              <p className="data-table-secondary">of {formatSeatLimit(limit)}</p>
              {over && <Badge tone="warning">over the agreed limit</Badge>}
            </div>
          );
        },
      },
      {
        key: 'expiry',
        header: 'Renews / expires',
        sortValue: (row) => row.expiresAt ?? '',
        render: (row) => {
          if (row.expiresAt === null) {
            return <span className="data-table-secondary">No expiry set</span>;
          }
          const days = daysUntil(row.expiresAt);
          return (
            <div>
              <span className="data-table-primary">{formatDate(row.expiresAt)}</span>
              <p className="data-table-secondary">
                {days !== null && days < 0 ? `Passed ${formatRelative(row.expiresAt)}` : formatRelative(row.expiresAt)}
              </p>
            </div>
          );
        },
      },
      {
        key: 'listPrice',
        header: 'List price',
        render: (row) => {
          // Without platform:view the catalogue was never read, so "not in the
          // catalogue" would be a false absence rather than a real one.
          if (!mayView) return <span className="data-table-secondary">Catalogue not readable with this account</span>;
          const plan = findListPlan(plans, row);
          if (!plan) return <span className="data-table-secondary">Plan not in the catalogue</span>;
          return (
            <div>
              <span className="data-table-primary">{priceLabel(plan.monthlyPrice, plan.currency)}/mo</span>
              <p className="data-table-secondary">{priceLabel(plan.annualPrice, plan.currency)}/yr</p>
            </div>
          );
        },
      },
      {
        key: 'agreedPrice',
        header: 'Agreed price',
        render: (row) => {
          const agreed = agreedByOrg[row.orgId];
          if (!agreed) {
            return (
              <Button variant="ghost" className="btn-sm" onClick={() => void inspectAgreedPrice(row)}>
                Check
              </Button>
            );
          }
          const listPlan = mayView ? findListPlan(plans, row) : null;
          const differs =
            listPlan !== null &&
            ((listPlan.monthlyPrice ?? null) !== agreed.monthlyPrice ||
              (listPlan.annualPrice ?? null) !== agreed.annualPrice);
          return (
            <div>
              <span className="data-table-primary">{priceLabel(agreed.monthlyPrice, agreed.currency ?? 'NGN')}/mo</span>
              <p className="data-table-secondary">{priceLabel(agreed.annualPrice, agreed.currency ?? 'NGN')}/yr</p>
              {listPlan && (
                <Badge tone={differs ? 'warning' : 'neutral'}>{differs ? 'bespoke deal' : 'matches list'}</Badge>
              )}
            </div>
          );
        },
      },
      {
        key: 'trial',
        header: 'Trial ends',
        sortValue: (row) => row.trialEndsAt ?? '',
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.trialEndsAt ? formatDate(row.trialEndsAt) : 'No trial'}</span>
            {row.trialEndsAt && <p className="data-table-secondary">{formatRelative(row.trialEndsAt)}</p>}
          </div>
        ),
      },
      {
        key: 'actions',
        header: 'Change',
        render: (row) =>
          mayManagePayments ? (
            <div className="data-table-cell-actions">
              <Button variant="outline" className="btn-sm" onClick={() => setAdjustTarget(row)}>
                Subscription
              </Button>
            </div>
          ) : (
            <span className="is-locked">platform:manage_payments required</span>
          ),
      },
    ],
    // The columns read the catalogue (for list prices and the billing cycle) and
    // the agreed-price cache.
    [agreedByOrg, plans, mayManagePayments, mayView],
  );

  if (!areaReachable) {
    return (
      <>
        <PlatformPageHead area={AREA} />
        <PermissionDenied
          what="subscriptions and billing"
          permission="platform:manage_plans, platform:manage_payments or platform:view_payments"
        />
      </>
    );
  }

  const filtersActive = Boolean(search || statusFilter || productFilter || planFilter || expiryWindow);
  const compareSnapshot = compare ? agreedByOrg[compare.row.orgId] : undefined;
  const periodChips = (
    <div className="chip-row">
      {REPORT_DATE_RANGE_PRESETS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`chip${preset === option.value ? ' active' : ''}`}
          aria-pressed={preset === option.value}
          onClick={() => setPreset(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
  const productChips = (
    <div className="chip-row">
      <button
        type="button"
        className={`chip${productFilter === '' ? ' active' : ''}`}
        aria-pressed={productFilter === ''}
        onClick={() => setFilter('product', '')}
      >
        All products
      </button>
      {products.map((product) => (
        <button
          key={product.key}
          type="button"
          className={`chip${productFilter === product.key ? ' active' : ''}`}
          aria-pressed={productFilter === product.key}
          onClick={() => setFilter('product', product.key)}
        >
          {product.name}
        </button>
      ))}
    </div>
  );

  /*
   * The queue. Every entry is something an operator can act on today, in the
   * order that costs the most if it is left: money that did not arrive, access
   * already past due, then access about to lapse.
   */
  const attention: AttentionItem[] = [];
  const failedCount = revenue.summary?.failedCount ?? 0;
  if (failedCount > 0) {
    attention.push({
      id: 'failed-payments',
      tone: 'danger',
      title: `${formatNumber(failedCount)} failed payment${failedCount === 1 ? '' : 's'}`,
      meta: `${periodLabel}. ${formatNumber(revenue.summary?.successfulCount ?? null)} succeeded in the same period.`,
      action: (
        <Button variant="outline" className="btn-sm" onClick={() => openSection('payments')}>
          Review
        </Button>
      ),
    });
  }
  const pastDueCount = overview.data?.pastDueSubscriptions ?? 0;
  if (pastDueCount > 0) {
    attention.push({
      id: 'past-due',
      tone: 'danger',
      title: `${formatNumber(pastDueCount)} subscription${pastDueCount === 1 ? '' : 's'} past due`,
      meta: 'Existing access continues; the seat check refuses new staff while it is not active.',
      action: (
        <Button
          variant="outline"
          className="btn-sm"
          onClick={() => openSection('subscriptions', { status: 'past_due', filter: '' })}
        >
          Review
        </Button>
      ),
    });
  }
  if (watch.trials > 0) {
    attention.push({
      id: 'trials-ending',
      tone: 'warning',
      title: `${formatNumber(watch.trials)} trial${watch.trials === 1 ? '' : 's'} ending within 30 days`,
      meta: watch.soonestTrial ? `Soonest ${formatRelative(watch.soonestTrial)}.` : 'Convert or extend.',
      action: (
        <Button
          variant="outline"
          className="btn-sm"
          onClick={() => openSection('subscriptions', { filter: 'trials', status: '' })}
        >
          Review
        </Button>
      ),
    });
  }
  const expiringCount = overview.data?.expiringWithin30d ?? 0;
  if (expiringCount > 0) {
    attention.push({
      id: 'expiring',
      tone: 'warning',
      title: `${formatNumber(expiringCount)} expiring within 30 days`,
      meta: 'A renewal is an extend_expiry adjustment; nothing renews these automatically.',
      action: (
        <Button
          variant="outline"
          className="btn-sm"
          onClick={() => openSection('subscriptions', { filter: 'expiring', status: '' })}
        >
          Review
        </Button>
      ),
    });
  }
  if (watch.expired > 0) {
    attention.push({
      id: 'expired',
      tone: 'danger',
      title: `${formatNumber(watch.expired)} past their expiry date`,
      meta: 'Nothing sweeps these, so they keep working until an adjustment moves them.',
      action: (
        <Button
          variant="outline"
          className="btn-sm"
          onClick={() => openSection('subscriptions', { filter: 'expired', status: '' })}
        >
          Review
        </Button>
      ),
    });
  }

  const metrics: Metric[] = [
    {
      id: 'active',
      label: 'Active subscriptions',
      value: overview.loading ? '—' : formatNumber(overview.data?.activeSubscriptions ?? null),
      foot: 'Entitlements with status active',
      onClick: () => openSection('subscriptions', { filter: 'active', status: '' }),
    },
    {
      id: 'trialing',
      label: 'On trial',
      value: overview.loading ? '—' : formatNumber(overview.data?.trialingSubscriptions ?? null),
      foot: 'Free trials with access',
      onClick: () => openSection('subscriptions', { filter: 'trialing', status: '' }),
    },
    {
      id: 'trials-ending',
      label: 'Trials ending in 30 days',
      value: !mayReadEntitlements
        ? 'Not readable'
        : watchlist.loading
          ? '—'
          : watchlist.error
            ? 'Not read'
            : formatNumber(watch.trials),
      foot: !mayReadEntitlements
        ? 'Needs platform:manage_businesses'
        : watchlist.error
          ? `Read failed: ${watchlist.error}`
          : `Computed over the newest ${formatNumber(WATCHLIST_LIMIT)} entitlements`,
      tone: watch.trials > 0 ? 'warning' : 'muted',
      onClick: () => openSection('subscriptions', { filter: 'trials', status: '' }),
    },
    {
      id: 'renewals',
      label: 'Renewals in 30 days',
      value: overview.loading ? '—' : formatNumber(overview.data?.expiringWithin30d ?? null),
      foot: 'Entitlements expiring inside 30 days',
      onClick: () => openSection('subscriptions', { filter: 'expiring', status: '' }),
    },
    {
      id: 'failed',
      label: 'Failed payments',
      value: revenue.loading ? '—' : formatNumber(revenue.summary?.failedCount ?? null),
      foot: periodLabel,
      tone: failedCount > 0 ? 'danger' : 'muted',
      onClick: () => openSection('payments'),
    },
    {
      id: 'revenue',
      label: 'Revenue',
      value: revenue.loading ? '—' : formatMoneyCompact(revenue.summary?.totalRevenue ?? null),
      foot: `${periodLabel} · sandbox excluded`,
      onClick: () => openSection('payments'),
    },
  ];

  const paymentsInPeriod = revenue.summary?.transactionCount ?? null;

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description="Manage plans, subscriptions and payments."
        actions={<RefreshButton onClick={refreshAll} loading={catalogue.loading || entitlements.loading} />}
      />

      {/* ── Section navigation ────────────────────────────────────── */}
      <SegmentedControl
        label="Billing sections"
        value={section}
        options={availableSections.filter((option) => ['overview', 'plans', 'subscriptions', 'payments'].includes(option.id)).map((option) => ({ value: option.id, label: option.label }))}
        onChange={openSection}
      />

      <Disclosure summary="More billing tools">
        <div className="btn-row">
          {availableIds.has('activation') && <Link className="btn btn-ghost btn-sm" to="/platform/activation">Activation keys</Link>}
          {availableIds.has('settings') && <Link className="btn btn-ghost btn-sm" to="/platform/settings">Billing settings</Link>}
          {availableIds.has('audit') && <Link className="btn btn-ghost btn-sm" to="/platform/audit">Audit trail</Link>}
        </div>
      </Disclosure>

      {!sectionAllowed ? (
        <PermissionDenied
          what={`${definition.label} in subscriptions and billing`}
          permission={definition.permissions.join(' or ')}
        />
      ) : section === 'overview' ? (
        <>
          {/* ── Overview: needs attention ─────────────────────────── */}
          <section className="card" aria-labelledby="billing-overview-attention">
            <SectionHead
              id="billing-overview-attention"
              title="Needs attention"
              sub={`${periodLabel} · sandbox payments excluded`}
              actions={
                attention.length > 0 ? <span className="badge badge-warning">{attention.length}</span> : undefined
              }
            />

            {overview.error && (
              <p className="form-hint">
                Some overview figures could not be loaded: {overview.error}
              </p>
            )}

            {overview.loading || watchlist.loading || revenue.loading ? (
              <LoadingLines />
            ) : (overview.error || watchlist.error || revenue.error) && attention.length === 0 ? (
              <SectionFailure message={overview.error ?? watchlist.error ?? revenue.error!} onRetry={refreshAll} />
            ) : attention.length > 0 ? (
              <>
                <AttentionList items={attention} />
              </>
            ) : (
              <>
                <HealthyStrip>
                  Nothing needs attention. No failed payments in the selected period, nothing past due, and no
                  subscription expiring in the next 30 days.
                </HealthyStrip>
              </>
            )}
          </section>

          {/* ── Overview: counts, each a route to the list behind it ── */}
          <section className="card" aria-labelledby="billing-overview-metrics">
            <SectionHead
              id="billing-overview-metrics"
              title="Billing summary"
            />
            <MetricStrip metrics={metrics} />
            {mayReadEntitlements && watchlist.rows.length >= WATCHLIST_LIMIT && (
              <p className="form-hint">
                Trial and expiry windows are computed from the newest {formatNumber(WATCHLIST_LIMIT)} entitlements, so
                those two counts can under-report. The other counts are totals.
              </p>
            )}


          </section>
        </>
      ) : section === 'plans' ? (
        <>
          {/* ── Plans: catalogue ──────────────────────────────────── */}
          <section className="card" aria-labelledby="billing-catalogue">
            <SectionHead
              id="billing-catalogue"
              title="Plan catalogue"
              sub="List prices quoted to new subscriptions. A published change reaches new customers only."
              actions={productChips}
            />

            <KpiGrid>
              <KpiCard
                label="Customer-visible tiers"
                value={catalogue.loading ? '—' : formatNumber(cataloguedPlans.length)}
                foot={
                  publishedStampMissing
                    ? 'Computed as active and public: list_product_plans does not return published_at here'
                    : `${formatNumber(plans.length)} rows, including drafts, retired and future-dated`
                }
              />
              <KpiCard
                label="Entitlements on priced plans"
                value={catalogue.loading ? '—' : formatNumber(subscriberTotal)}
              />
              <KpiCard
                label="Annual terms"
                value={
                  catalogue.loading
                    ? '—'
                    : offerMonths === null
                      ? 'Not uniform'
                      : `${monthsFreeLabel(offerMonths)} free`
                }
                foot={`billing.annual_months_free = ${
                  declaredFreeMonths === null ? 'not set' : formatNumber(declaredFreeMonths)
                }`}
                tone={
                  declaredFreeMonths !== null && offerMonths !== null && declaredFreeMonths !== offerMonths
                    ? 'warning'
                    : 'default'
                }
              />
            </KpiGrid>

            {!mayView ? (
              <StateBlock
                variant="denied"
                title="The plan catalogue needs platform:view"
                body="list_product_plans and list_plan_revisions are gated on platform:view, so no price is shown rather than a blank one."
              />
            ) : catalogue.error ? (
              <SectionFailure message={catalogue.error} onRetry={catalogue.reload} />
            ) : (
              <DataTable
                columns={planColumns}
                rows={plans}
                rowKey={(plan) => plan.id}
                stacked
                loading={catalogue.loading}
                caption="Product plans and list prices"
                empty={
                  <StateBlock
                    variant="empty"
                    title={
                      productFilter
                        ? `No plans exist for ${
                            products.find((product) => product.key === productFilter)?.name ?? productFilter
                          }`
                        : 'No plans exist yet'
                    }
                    body="Plans appear here once they are created."
                  />
                }
              />
            )}

            <Disclosure summary="What makes a plan customer-visible">
              <p>
                A plan is on sale only when it is active, publicly offered, published and past its effective date. That
                is the test list_published_plans applies, and it is the only place the product defines it — the public
                pricing page, the customer Billing page and checkout all read that one function, so they cannot
                disagree with each other or with this table. A plan with no effective date fails the test, which is why
                an unpublished row cannot leak out through the date.
              </p>
              <p>
                Editing never changes any of the four: published_at and effective_from are absent from
                upsert_product_plan's update list, and a new plan starts with them NULL. Publishing is the only write
                that sets them, and it forces status to active while leaving is_public as you set it.
              </p>
            </Disclosure>
          </section>

          {/* ── Plans: detail, impact, history ────────────────────── */}
          <Dialog open={Boolean(visiblePlan) && !editingPlan && !publishingPlan} onClose={() => setSelectedPlanId(null)} title={visiblePlan?.name ?? 'Plan details'}>

            {!visiblePlan ? (
              <StateBlock variant="empty" title="No plan selected" body="Choose Open on a plan above." />
            ) : (
              <>
                <DefList
                  rows={[
                    { term: 'Plan', value: `${visiblePlan.name} (${visiblePlan.key})` },
                    { term: 'Product', value: `${visiblePlan.productName} (${visiblePlan.productKey})` },
                    { term: 'Monthly price', value: priceLabel(visiblePlan.monthlyPrice, visiblePlan.currency) },
                    { term: 'Annual price', value: priceLabel(visiblePlan.annualPrice, visiblePlan.currency) },
                    {
                      term: 'Annual offer',
                      value: (() => {
                        const offer = annualOffer(visiblePlan);
                        if (!offer) return <span className="is-locked">Not priced — nothing to compare</span>;
                        if (offer.amount < 0) {
                          return `${formatMoney(Math.abs(offer.amount), visiblePlan.currency)} more than 12 monthly payments`;
                        }
                        return `${formatMoney(offer.amount, visiblePlan.currency)} saved (${monthsFreeLabel(offer.months)} free)`;
                      })(),
                    },
                    { term: 'Seat limit', value: formatSeatLimit(visiblePlan.userLimit) },
                    {
                      term: 'Store limit',
                      value: storeLimitLabel(visiblePlan.storeLimit),
                    },
                    {
                      term: 'Setup fee',
                      value:
                        visiblePlan.setupFee === null
                          ? 'None'
                          : formatMoney(visiblePlan.setupFee, visiblePlan.currency),
                    },
                    {
                      term: 'Trial',
                      value:
                        visiblePlan.trialDays === null
                          ? 'Not returned by list_product_plans'
                          : trialDaysLabel(visiblePlan.trialDays),
                    },
                    { term: 'Billing cycle', value: humaniseToken(visiblePlan.billingCycle) },
                    { term: 'Status', value: <StatusBadge status={visiblePlan.status} /> },
                    { term: 'Published', ...publicationLabel(visiblePlan) },
                    { term: 'Default plan', value: visiblePlan.isDefault ? 'Yes — new businesses start here' : 'No' },
                    { term: 'Publicly offered', value: visiblePlan.isPublic ? 'Yes' : 'No' },
                    {
                      term: 'Subscribers',
                      value: `${formatNumber(visiblePlan.subscriberCount)} entitlement${
                        visiblePlan.subscriberCount === 1 ? '' : 's'
                      } with status active, trialing or pending`,
                    },
                    {
                      term: 'Description',
                      value: visiblePlan.description ?? <span className="is-locked">No description recorded</span>,
                    },
                    {
                      term: 'Onboarding note',
                      value: visiblePlan.onboardingNote ?? (
                        <span className="is-locked">No onboarding note recorded</span>
                      ),
                    },
                    {
                      term: 'Feature list',
                      value:
                        visiblePlan.features.length > 0 ? (
                          <div className="chip-row">
                            {visiblePlan.features.map((feature) => (
                              <Badge key={feature.key} tone={feature.upcoming ? 'outline' : 'neutral'}>
                                {feature.label}
                                {feature.upcoming ? ' (upcoming)' : ''}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="is-locked">No features recorded for this plan</span>
                        ),
                    },
                    {
                      term: 'Last updated',
                      value: visiblePlan.updatedAt
                        ? `${formatDateTime(visiblePlan.updatedAt)} · ${formatRelative(visiblePlan.updatedAt)}`
                        : 'Never updated since it was created',
                    },
                  ]}
                />

                <p className="form-hint">
                  The setup fee is charged. A checkout is quoted as the published version&rsquo;s recurring price plus
                  that version&rsquo;s setup fee, and settlement records the fee as its own invoice line. It applies
                  once per product: a business with a successful payment for this product is quoted the recurring price
                  alone. Because checkout quotes the immutable version rather than this row, an edit here reaches
                  customers only through a new published version. Trial length is a plan attribute nothing applies:
                  a trial is granted from the platform setting{' '}
                  <span className="mono">billing.default_trial_days</span>, and{' '}
                  <span className="mono">product_plan_versions.trial_days</span> is constrained to 0, so a per-plan
                  trial cannot exist.
                </p>

                <div className="btn-row">
                  {mayManagePlans ? (
                    <>
                      <Button onClick={() => setEditingPlan(visiblePlan)}>Edit plan</Button>
                      <Button variant="outline" onClick={() => setPublishingPlan(visiblePlan)}>
                        Publish…
                      </Button>
                    </>
                  ) : (
                    <span className="is-locked">Read-only. Changing a plan needs platform:manage_plans.</span>
                  )}
                </div>
                <p className="form-hint">
                  Editing saves the row and journals a revision; it never publishes. Publishing stamps the dates and
                  forces the status to active, so a plan also has to be publicly offered before customers see it.
                </p>

                <p className="plat-section-sub">Who a published change affects</p>
                <DefList
                  rows={[
                    {
                      term: 'New customers',
                      value: `Pay ${priceLabel(visiblePlan.monthlyPrice, visiblePlan.currency)}/month or ${priceLabel(
                        visiblePlan.annualPrice,
                        visiblePlan.currency,
                      )}/year, ${formatSeatLimit(visiblePlan.userLimit)} seats, from the effective date.`,
                    },
                    {
                      term: 'Existing subscribers',
                      value: `Not repriced. The agreed monthly price, annual price and seat limit were snapshotted on organization_products at activation, and a plan edit never rewrites them — ${formatNumber(
                        visiblePlan.subscriberCount,
                      )} entitlement${visiblePlan.subscriberCount === 1 ? '' : 's'} hold this plan.`,
                    },
                    {
                      term: 'Named subscribers',
                      value: (
                        <span className="is-locked">
                          Not listed: nothing records which subscriptions a price change would touch, so any list here
                          would be invented.
                        </span>
                      ),
                      muted: true,
                    },
                  ]}
                />

                <p className="plat-section-sub">Change history</p>
                <SectionState
                  loading={revisionsLoading}
                  error={revisionsError}
                  empty={!revisionsLoading && !revisionsError && revisionEntries.length === 0}
                  emptyTitle="No revisions recorded for this plan"
                  emptyBody="product_plan_revisions is written by upsert_product_plan and publish_product_plan, so a plan priced by a data migration has no rows here."
                  onRetry={() => void loadRevisions(visiblePlan.id)}
                >
                  <Timeline items={revisionEntries} />
                </SectionState>
              </>
            )}
          </Dialog>
        </>
      ) : section === 'subscriptions' ? (
        <>
          {/* ── Subscriptions: the directory ──────────────────────── */}
          <section className="card" aria-labelledby="billing-entitlements">
            <SectionHead
              id="billing-entitlements"
              title="Subscriptions"
              sub="One row per business per product. Open a business for its plan, seats, payments and adjustment history."
              actions={productChips}
            />

            {!mayReadEntitlements ? (
              <StateBlock
                variant="denied"
                title="The subscription directory needs platform:manage_businesses"
                body="list_product_businesses and get_platform_business are gated on that key, so this panel states the requirement instead of showing an empty table."
              />
            ) : (
              <>
                <form
                  className="toolbar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setFilter('q', searchDraft.trim());
                  }}
                >
                  <div className="toolbar-grow">
                    <label className="form-label" htmlFor="billing-search">
                      Search businesses
                    </label>
                    <SearchInput aria-label="Search businesses"
                      id="billing-search"


                      value={searchDraft}
                      placeholder="Name, owner email or slug"
                      onChange={(event) => setSearchDraft(event.target.value)}
                    />
                  </div>

                  <div className="plat-field">
                    <label className="form-label" htmlFor="billing-status">
                      Entitlement status
                    </label>
                    <select
                      id="billing-status"
                      className="select-input"
                      value={statusFilter}
                      onChange={(event) => setFilter('status', event.target.value)}
                    >
                      <option value="">Any status</option>
                      {ENTITLEMENT_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {humaniseToken(value)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="plat-field">
                    <label className="form-label" htmlFor="billing-plan">
                      Plan
                    </label>
                    <select
                      id="billing-plan"
                      className="select-input"
                      value={planFilter}
                      onChange={(event) => setFilter('plan', event.target.value)}
                      disabled={plans.length === 0}
                    >
                      <option value="">Any plan</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.key}>
                          {plan.productName} — {plan.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button type="submit" className="btn btn-neutral btn-sm">
                    <span className="btn-label">Search</span>
                  </button>

                  {filtersActive && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setSearchDraft('');
                        // The section is navigation, not a filter: clearing the
                        // filters leaves the operator where they were. This
                        // control only exists inside a named section.
                        const next = new URLSearchParams();
                        next.set('section', section);
                        setSearchParams(next, { replace: true });
                      }}
                    >
                      <span className="btn-label">Clear filters</span>
                    </button>
                  )}
                </form>

                {expiryWindow !== null ? (
                  <p className="form-hint">
                    Showing {expiryWindow === 'trials' ? 'trials' : 'entitlements'} inside the next 30 days. The window is
                    applied in this browser because the endpoint filters on status only, so a page can hold fewer rows
                    than its page size.
                  </p>
                ) : (
                  (searchParams.get('filter') ?? '') !== '' && (
                    <p className="form-hint">
                      The dashboard link asked for <span className="mono">{searchParams.get('filter')}</span>, translated
                      to {statusFilter ? `${humaniseToken(statusFilter)} entitlements` : 'no filter'}.
                    </p>
                  )
                )}
                {planFilter !== '' && (
                  <p className="form-hint">
                    The plan filter is applied in this browser, so a page can show fewer rows than the page size.
                  </p>
                )}
                {plans.length === 0 && !catalogue.loading && (
                  <p className="form-hint">
                    The plan list could not be read (it needs platform:view), so only the status filter is available.
                  </p>
                )}

                {entitlements.error ? (
                  <SectionFailure message={entitlements.error} onRetry={entitlements.reload} />
                ) : (
                  <>
                    <DataTable
                      columns={entitlementColumns}
                      rows={visibleRows}
                      rowKey={(row) => `${row.orgId}:${row.productKey}`}
                      stacked
                      loading={entitlements.loading}
                      caption="Businesses, their plan and their agreed price"
                      empty={
                        <StateBlock
                          variant="empty"
                          title={filtersActive ? 'No businesses match these filters' : 'No entitlements yet'}
                          body={
                            filtersActive
                              ? 'Clear the filters or widen the search.'
                              : 'Entitlements appear as businesses subscribe or redeem an activation key.'
                          }
                        />
                      }
                    />
                    <Pagination
                      page={page}
                      pageSize={PAGE_SIZE}
                      total={null}
                      noun="entitlements"
                      hasNext={entitlements.rows.length === PAGE_SIZE}
                      onPageChange={(next) => setFilter('page', String(next))}
                    />
                  </>
                )}

                <p className="form-hint">
                  Check reads the agreed price for one business, from get_platform_business. The renewal date is the
                  entitlement's expiry; a renewal is the extend_expiry adjustment below.
                </p>
              </>
            )}
          </section>

          {/* ── Subscriptions: authorised changes ─────────────────── */}
          <section className="card" aria-labelledby="billing-changes">
            <SectionHead
              id="billing-changes"
              title="Subscription changes"
              sub="Every plan change, extension, suspension, cancellation and reactivation goes through record_subscription_adjustment."
            />

            {!mayManagePayments ? (
              <StateBlock
                variant="denied"
                title="Recording a change needs platform:manage_payments"
                body="record_subscription_adjustment and list_subscription_adjustments are gated on that key, so the history cannot be read and the control is not offered. A platform owner can grant it from Users & roles."
              />
            ) : (
              <>
                <SectionState
                  loading={adjustments.loading}
                  error={adjustments.error}
                  empty={!adjustments.loading && !adjustments.error && adjustmentEntries.length === 0}
                  emptyTitle="No subscription changes recorded yet"
                  emptyBody="Adjustments appear here with their before and after values."
                  onRetry={adjustments.reload}
                >
                  <Timeline items={adjustmentEntries} />
                </SectionState>

                <p className="form-hint">
                  Most recent 100 platform-wide; no total is returned. A reason of at least 5 characters is required for
                  every adjustment, and each one is copied to the business's support timeline and the audit trail.
                </p>
              </>
            )}
          </section>
        </>
      ) : section === 'payments' ? (
        <section className="card" aria-labelledby="billing-payments">
          <SectionHead
            id="billing-payments"
            title="Payments and invoices"
            sub={`Subscription transactions, ${periodLabel.toLowerCase()}. Sandbox transactions excluded.`}
            actions={periodChips}
          />

          <p className="form-hint">Test transactions are marked and excluded from production revenue.</p>

          {!mayView ? (
            <StateBlock
              variant="denied"
              title="Revenue reporting needs platform:view"
              body="get_platform_revenue_summary and get_platform_revenue_by_plan are gated on that key, so no figure is shown."
            />
          ) : revenue.error ? (
            <SectionFailure message={revenue.error} onRetry={revenue.reload} />
          ) : (
            <>
              {inbound.paymentsUnavailable && <p className="form-hint">Arrived from the failed-payments link: the transaction table below opens filtered to failed attempts. The period totals cover the full selected range.</p>}

              <KpiGrid>
                <KpiCard
                  label="Revenue in period"
                  value={revenue.loading ? '—' : formatMoney(revenue.summary?.totalRevenue ?? null)}
                  foot={`${formatNumber(revenue.summary?.successfulCount ?? null)} successful payments`}
                />
                <KpiCard
                  label="Failed payments"
                  value={revenue.loading ? '—' : formatNumber(revenue.summary?.failedCount ?? null)}
                  tone={failedCount > 0 ? 'warning' : 'default'}
                  foot="From subscription_transactions"
                />
                <KpiCard
                  label="Attempts in period"
                  value={revenue.loading ? '—' : formatNumber(paymentsInPeriod)}
                  foot="Sandbox excluded"
                />
                <KpiCard
                  label="Attributed to a plan"
                  value={revenue.loading ? '—' : formatMoney(breakdownTotal)}
                  foot="From the bars below"
                />
              </KpiGrid>

              <SectionHead title="Recent transactions" sub="The newest 100 attempts matching the filters, across the platform." />
              <CommercialTransactionsPanel
                permitted={mayViewPaymentRecords}
                refreshToken={refreshToken}
                initialStatus={inbound.paymentsUnavailable ? 'failed' : 'all'}
              />

              <div className="section-head">
                <div className="section-head-text">
                  <h3 className="section-title">Revenue by plan</h3>
                  <p className="section-sub">
                    Period total: {revenue.loading ? '—' : formatMoney(revenue.summary?.totalRevenue ?? null)}
                  </p>
                </div>
              </div>
              {revenue.loading ? <LoadingLines /> : revenueMeters.length > 0 ? (
                <MeterList items={revenueMeters} />
              ) : (
                <StateBlock
                  variant="empty"
                  title="No revenue recorded in this period"
                  body="No subscription payment succeeded in the selected range. Try a longer period."
                />
              )}

              <Disclosure summary="How the revenue figures are grouped">
                <p>
                  Sandbox transactions are excluded. Grouping is by the legacy subscription_plans table, not by the plan
                  catalogue in Plans &amp; pricing, so a name can differ and a payment with no legacy plan appears in no
                  bar.
                </p>
              </Disclosure>

              <Disclosure summary="Payment record notes">
                <p>Pending means checkout began; only a verified settlement activates access. Invoice and receipt numbers appear in the transaction table when issued.</p>
                <p>
                  The table shows the newest 100 attempts that match its filters, not the newest 100 attempts of which
                  some are then hidden: the filters run in the database before the row limit, so an empty result means
                  no attempt matches at all. Revenue totals use the selected period and exclude sandbox transactions.
                </p>
              </Disclosure>
            </>
          )}
        </section>
      ) : (
        <Navigate replace to={section === 'activation' ? '/platform/activation' : section === 'settings' ? '/platform/settings' : '/platform/audit'} />
      )}

      <PlanEditDialog
        plan={editingPlan}
        siblingPlans={plans.filter((plan) => plan.productKey === editingPlan?.productKey)}
        onClose={() => setEditingPlan(null)}
        onSaved={() => {
          if (editingPlan) setSelectedPlanId(editingPlan.id);
          refreshAll();
        }}
      />

      <PublishPlanDialog
        plan={publishingPlan}
        onClose={() => setPublishingPlan(null)}
        onPublished={() => {
          if (publishingPlan) setSelectedPlanId(publishingPlan.id);
          refreshAll();
        }}
      />

      <SubscriptionChangeDialog
        target={adjustTarget}
        plans={plans}
        onClose={() => setAdjustTarget(null)}
        onRecorded={refreshAll}
      />

      <Dialog
        open={compare !== null}
        onClose={() => setCompare(null)}
        title={compare ? `Agreed deal — ${compare.row.name}` : 'Agreed deal'}
        description="Snapshotted at activation; never rewritten by a catalogue edit."
      >
        {compare?.loading && (
          <div className="skeleton-inline" role="status" aria-label="Loading the agreed deal">
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text is-short" />
          </div>
        )}

        {compare && !compare.loading && compare.error && (
          <StateBlock variant="error" title="Could not read the agreed deal" body={compare.error} />
        )}

        {compare && !compare.loading && !compare.error && compareSnapshot && (
          <>
            {(() => {
              const listPlan = mayView ? findListPlan(plans, compare.row) : null;
              const differs =
                listPlan !== null &&
                ((listPlan.monthlyPrice ?? null) !== compareSnapshot.monthlyPrice ||
                  (listPlan.annualPrice ?? null) !== compareSnapshot.annualPrice);
              return (
                <div className={differs ? 'callout callout-warning' : 'callout callout-info'}>
                  <div>
                    <p className="callout-title">
                      {!mayView
                        ? 'The catalogue is not readable with this account, so list and agreed cannot be compared'
                        : listPlan === null
                          ? 'The plan on this entitlement is not in the catalogue, so the two prices cannot be compared'
                          : differs
                            ? 'This customer is on a bespoke deal'
                            : 'This customer is on the published price'}
                    </p>
                    <p className="callout-text">
                      Where the two differ, the agreed figure is the deal in force; the catalogue figure applies to new
                      subscriptions only.
                    </p>
                  </div>
                </div>
              );
            })()}

            <DefList
              rows={[
                {
                  term: 'List price',
                  value: (() => {
                    if (!mayView) return 'Catalogue not readable — plan prices unknown to this account';
                    const listPlan = findListPlan(plans, compare.row);
                    if (listPlan === null) return 'Not in the catalogue';
                    return `${priceLabel(listPlan.monthlyPrice, listPlan.currency)}/mo · ${priceLabel(
                      listPlan.annualPrice,
                      listPlan.currency,
                    )}/yr`;
                  })(),
                  muted: !mayView || findListPlan(plans, compare.row) === null,
                },
                {
                  term: 'Agreed monthly',
                  value: priceLabel(compareSnapshot.monthlyPrice, compareSnapshot.currency ?? 'NGN'),
                  muted: compareSnapshot.monthlyPrice === null,
                },
                {
                  term: 'Agreed annual',
                  value: priceLabel(compareSnapshot.annualPrice, compareSnapshot.currency ?? 'NGN'),
                  muted: compareSnapshot.annualPrice === null,
                },
                { term: 'Agreed seat limit', value: formatSeatLimit(compareSnapshot.userLimit) },
                {
                  term: 'Entitlement source',
                  value: compareSnapshot.source ? <StatusBadge status={compareSnapshot.source} /> : 'Not recorded',
                  muted: compareSnapshot.source === null,
                },
                {
                  term: 'Plan on the entitlement',
                  value: compareSnapshot.planKey ?? 'No plan recorded',
                  muted: compareSnapshot.planKey === null,
                },
              ]}
            />
          </>
        )}

        <p className="form-hint">
          Read from get_platform_business. &ldquo;Custom&rdquo; means NULL is recorded, not a zero.
        </p>
      </Dialog>
    </>
  );
}
