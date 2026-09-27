import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PlatformAdminService,
  type PlanRevision,
  type PlatformProduct,
  type ProductBusiness,
  type ProductPlan,
  type SubscriptionAdjustment,
} from '../../../services/platformAdmin.service';
import { PlatformService } from '../../../services/platform.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import {
  AreaCoverage,
  PermissionDenied,
  PlatformPageHead,
  RefreshButton,
} from '../../../components/platform/PlatformPageHead';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog, Dialog } from '../../../components/ui/Dialog';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList } from '../../../components/ui/DefList';
import { Disclosure } from '../../../components/ui/Disclosure';
import { FormField } from '../../../components/ui/FormField';
import { KpiCard, KpiGrid } from '../../../components/ui/KpiCard';
import { MeterList, type MeterItem } from '../../../components/ui/MeterList';
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
  formatNumber,
  formatRelative,
  formatSeatLimit,
  humaniseToken,
} from '../../../utils/format';
import type { PlatformRevenueByPlan, PlatformRevenueSummary } from '../../../types';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'billing')!;

const PAGE_SIZE = 25;

/** Entitlement statuses the directory endpoint can filter on (organization_products.status). */
const ENTITLEMENT_STATUSES = ['active', 'pending', 'past_due', 'suspended', 'expired', 'cancelled'] as const;

/** Permission key each panel needs. The server re-checks every one of them. */
const PERMISSIONS = {
  /** Reads the catalogue, the pricing history and revenue. */
  view: 'platform:view',
  /** Serves the entitlement directory and one business's agreed deal. */
  entitlements: 'platform:manage_businesses',
  /** Records and lists subscription adjustments. */
  payments: 'platform:manage_payments',
  /** Writes a plan. */
  plans: 'platform:manage_plans',
} as const;

/**
 * Capabilities this screen has no backend for.
 *
 * Each is a named, verifiable absence rather than a placeholder: the console
 * states what is missing instead of drawing a figure that looks healthy.
 */
const NOT_BUILT: { title: string; detail: string }[] = [
  {
    title: 'Invoices and receipts',
    detail: 'No invoice or receipt table exists.',
  },
  {
    title: 'Proration on plan changes',
    detail: 'Plan changes are not prorated: nothing is refunded or charged.',
  },
  {
    title: 'Grace period and dunning',
    detail: 'No grace window, no retry schedule, no failure-to-cancel path.',
  },
  {
    title: 'Renewal automation',
    detail: 'Nothing renews an entitlement; renewal is a manual extend_expiry adjustment.',
  },
  {
    title: 'Expiry sweep',
    detail: 'Nothing marks a lapsed entitlement expired; it keeps working.',
  },
  {
    title: 'Platform-wide transaction list',
    detail: 'No endpoint lists individual subscription transactions.',
  },
];

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

/** The server takes TIMESTAMPTZ; the form collects a date. */
function toTimestamp(dateOnly: string): string | null {
  if (!dateOnly) return null;
  // Local midnight, then to ISO: the date stored is the date the operator typed,
  // read back in their own timezone, rather than a UTC-midnight day.
  const parsed = new Date(`${dateOnly}T00:00:00`);
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
 * Maps the ?filter= values the Overview links with onto real server filters.
 *
 * Three of them cannot be served as written: "trialing" is stored as `pending`,
 * "expiring" is a window rather than a status, and "failed" would need a
 * transaction list that does not exist. Each is translated or stated, never
 * silently dropped.
 */
function resolveInboundFilter(filter: string): {
  status: string;
  window: 'expiring' | null;
  paymentsUnavailable: boolean;
} {
  switch (filter) {
    case 'active':
    case 'pending':
    case 'past_due':
    case 'suspended':
    case 'expired':
    case 'cancelled':
      return { status: filter, window: null, paymentsUnavailable: false };
    case 'trialing':
      return { status: 'pending', window: null, paymentsUnavailable: false };
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

// ------------------------------------------------------------ plan revisions

interface RevisionField {
  key: string;
  label: string;
  format: (value: unknown, currency: string) => string;
}

const REVISION_FIELDS: RevisionField[] = [
  { key: 'monthly_price', label: 'Monthly', format: (value, currency) => priceFromJson(value, currency) },
  { key: 'annual_price', label: 'Annual', format: (value, currency) => priceFromJson(value, currency) },
  { key: 'user_limit', label: 'Seats', format: (value) => seatLabelFromJson(value) },
  { key: 'status', label: 'Status', format: (value) => humaniseToken(asText(value)) },
  { key: 'billing_cycle', label: 'Billing cycle', format: (value) => humaniseToken(asText(value)) },
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
function describePlanChanges(plan: ProductPlan, draft: PlanDraft): string[] {
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
  const seats = parseNumberField(draft.userLimit);
  if (seats !== plan.userLimit) {
    changes.push(`Seat limit ${formatSeatLimit(plan.userLimit)} → ${formatSeatLimit(seats)}`);
  }
  if (draft.status !== plan.status) {
    changes.push(`Status ${humaniseToken(plan.status)} → ${humaniseToken(draft.status)}`);
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
  const changes = describePlanChanges(storedPlan, activeDraft);
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
        userLimit: parseNumberField(activeDraft.userLimit),
        features: JSON.parse(activeDraft.featuresJson) as { key: string; label: string; upcoming?: boolean }[],
        onboardingNote: nullIfBlank(activeDraft.onboardingNote),
        status: activeDraft.status,
        isDefault: activeDraft.isDefault,
        isPublic: activeDraft.isPublic,
        sortOrder: storedPlan.sortOrder,
        note: reason.trim(),
      });
      toast.update(toastId, {
        variant: 'success',
        message: `${storedPlan.name} saved`,
        description: 'Journalled in product_plan_revisions. Existing subscribers keep their agreed prices.',
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
    `${formatNumber(storedPlan.subscriberCount)} subscriber${storedPlan.subscriberCount === 1 ? '' : 's'} hold this plan (status active or pending). None is repriced: agreed prices are snapshotted at activation.`,
    activeDraft.isDefault && otherDefault
      ? `Making this the default also clears the flag on ${otherDefault.name}.`
      : '',
    'No billing cycle is sent, and the function defaults a missing cycle to monthly, so an annual or custom plan resets to monthly; the revision journal records the new value.',
    'A price change re-quotes new subscriptions only: nothing charges or credits an existing subscriber.',
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
            <p className="form-hint">Retired keeps the row for existing subscribers but blocks new signups.</p>
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
        title={`Publish changes to ${plan.name}?`}
        confirmLabel="Save price change"
        requireReason
        reasonLabel="Change note"
        reasonHint="At least 5 characters. Written to product_plan_revisions.note and the audit trail."
        consequence={consequence}
      />
    </>
  );
}

// --------------------------------------------------- subscription adjustment

interface AdjustmentIntent {
  value: 'upgrade' | 'downgrade' | 'extend_expiry' | 'cancel' | 'reactivate' | 'seat_change';
  label: string;
  requiresPlan: boolean;
  requiresExpiry: boolean;
  requiresSeats: boolean;
  /** The server's own requirement for this adjustment type. */
  requirement: string;
  consequence: string;
}

/**
 * The six adjustment types this screen performs, each with the condition the
 * function actually enforces.
 *
 * record_subscription_adjustment accepts more (suspend, shorten_expiry,
 * manual_price, manual_activation); they are left out of this form rather than
 * half-built. The conditions below are quoted from
 * 20260926000071_platform_activation_support_functions.sql, lines 613-636, which
 * 20260927000089_platform_owner_hardening.sql re-created unchanged.
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
    value: 'reactivate',
    label: 'Reactivate',
    requiresPlan: false,
    requiresExpiry: false,
    requiresSeats: false,
    requirement:
      'A plan key and a seat limit are optional; an entitlement that has already expired also needs a new expiry date.',
    consequence:
      'The entitlement returns to active and any cancellation is cleared. A plan or seat limit supplied here also rewrites the agreed deal.',
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
                cancellation and seat changes still work.
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
        danger={intent.value === 'cancel' || intent.value === 'downgrade'}
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

// ------------------------------------------------------------------- screen

export default function BillingArea() {
  const { can, settings } = usePlatform();
  const [searchParams, setSearchParams] = useSearchParams();

  // Panel permissions, resolved once. The server re-checks every one of them, so
  // a stale list here can only show a state the server then refuses.
  const mayView = can(PERMISSIONS.view);
  const mayReadEntitlements = can(PERMISSIONS.entitlements);
  const mayManagePayments = can(PERMISSIONS.payments);
  const mayManagePlans = can(PERMISSIONS.plans);
  const areaReachable = AREA.permissions.some((permission) => can(permission)) || mayView;

  const inbound = resolveInboundFilter(searchParams.get('filter') ?? '');
  const productFilter = searchParams.get('product') ?? '';
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
  const [adjustTarget, setAdjustTarget] = useState<ProductBusiness | null>(null);
  const [agreedByOrg, setAgreedByOrg] = useState<Record<string, AgreedSnapshot>>({});
  const [compare, setCompare] = useState<CompareState | null>(null);

  const catalogue = useCatalogue(mayView, productFilter, refreshToken);
  const entitlements = useEntitlements(mayReadEntitlements, productFilter, search, statusFilter, page, refreshToken);
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

  /** Applies a URL filter and returns to page one, since offsets shift under it. */
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
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

  // The expiry window is applied here because the directory endpoint filters on
  // status only; the narrowing is stated in the UI rather than implied.
  const visibleRows = useMemo(() => {
    if (expiryWindow !== 'expiring') return entitlements.rows;
    const now = Date.now();
    return entitlements.rows.filter((row) => {
      const days = daysUntil(row.expiresAt, now);
      return days !== null && days >= 0 && days <= 30;
    });
  }, [entitlements.rows, expiryWindow]);

  const cataloguedPlans = plans.filter((plan) => plan.isPublic && plan.status === 'active');
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
      tone: revision.changeType === 'retired' ? 'danger' : revision.changeType === 'created' ? 'accent' : 'neutral',
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
              <Badge tone={plan.isPublic ? 'success' : 'neutral'}>{plan.isPublic ? 'public' : 'not public'}</Badge>
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
                {plan.monthlyPrice === null || plan.annualPrice === null
                  ? 'Not priced'
                  : 'No monthly price'}
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
              onClick={() => setSelectedPlanId(plan.id === selectedPlanId ? null : plan.id)}
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
            <span className="data-table-primary">{row.name}</span>{' '}
            {row.isSandbox && <Badge tone="workspace">sandbox</Badge>}
            <p className="data-table-secondary">{row.ownerEmail ?? 'No owner email'}</p>
          </div>
        ),
      },
      {
        key: 'plan',
        header: 'Plan',
        sortValue: (row) => row.planName ?? '',
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.planName ?? 'No plan'}</span>
            <p className="data-table-secondary">
              {row.productName} <span className="mono">{row.planKey ?? '—'}</span>
            </p>
          </div>
        ),
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
        header: 'Expires',
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
    // The columns read the catalogue (for list prices) and the agreed-price cache.
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

  const filtersActive = Boolean(search || statusFilter || productFilter || expiryWindow);
  const compareSnapshot = compare ? agreedByOrg[compare.row.orgId] : undefined;

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description="Reads are permission-scoped: a panel this account cannot read says so."
        actions={<RefreshButton onClick={refreshAll} loading={catalogue.loading || entitlements.loading} />}
      />

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot show yet" />

      {/* ── Plan catalogue ────────────────────────────────────────── */}
      <section className="card" aria-labelledby="billing-catalogue">
        <SectionHead
          id="billing-catalogue"
          title="Plan catalogue and pricing"
          sub="List prices quoted to new subscriptions."
          actions={
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
          }
        />

        <KpiGrid>
          <KpiCard
            label="Published tiers"
            value={catalogue.loading ? '—' : formatNumber(cataloguedPlans.length)}
            foot={`${formatNumber(plans.length)} rows, including drafts and retired`}
          />
          <KpiCard
            label="Entitlements on priced plans"
            value={catalogue.loading ? '—' : formatNumber(subscriberTotal)}
          />
          <KpiCard
            label="Annual terms"
            value={catalogue.loading ? '—' : offerMonths === null ? 'Not uniform' : `${monthsFreeLabel(offerMonths)} free`}
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
                body={
                  productFilter === 'trackoja_works'
                    ? 'TrackOja Works was seeded as a product row only: no plans, prices, features or limits were invented for it.'
                    : 'Plans appear here once they are created.'
                }
              />
            }
          />
        )}
      </section>

      {/* ── Selected plan: stored values, edit, history ───────────── */}
      <section className="card" aria-labelledby="billing-plan-detail">
        <SectionHead
          id="billing-plan-detail"
          title="Plan detail and pricing history"
        />

        {!visiblePlan ? (
          <StateBlock
            variant="empty"
            title="No plan selected"
            body="Choose Open on a plan above."
          />
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
                { term: 'Status', value: <StatusBadge status={visiblePlan.status} /> },
                { term: 'Default plan', value: visiblePlan.isDefault ? 'Yes — new businesses start here' : 'No' },
                { term: 'Publicly offered', value: visiblePlan.isPublic ? 'Yes' : 'No' },
                {
                  term: 'Subscribers',
                  value: `${formatNumber(visiblePlan.subscriberCount)} entitlement${
                    visiblePlan.subscriberCount === 1 ? '' : 's'
                  } with status active or pending`,
                },
                {
                  term: 'Description',
                  value: visiblePlan.description ?? <span className="is-locked">No description recorded</span>,
                },
                {
                  term: 'Onboarding note',
                  value: visiblePlan.onboardingNote ?? <span className="is-locked">No onboarding note recorded</span>,
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

            <div className="btn-row">
              {mayManagePlans ? (
                <Button onClick={() => setEditingPlan(visiblePlan)}>Edit plan</Button>
              ) : (
                <span className="is-locked">Read-only. Changing a plan needs platform:manage_plans.</span>
              )}
            </div>

            <p className="form-hint">
              Existing subscribers are not repriced by a plan edit: their agreed prices are snapshotted at activation.
            </p>

            <p className="plat-section-sub">Change history (effective dates and before/after values)</p>
            <SectionState
              loading={revisionsLoading}
              error={revisionsError}
              empty={!revisionsLoading && !revisionsError && revisionEntries.length === 0}
              emptyTitle="No revisions recorded for this plan"
              emptyBody="product_plan_revisions is written by upsert_product_plan, so a plan priced by a data migration has no rows here."
              onRetry={() => void loadRevisions(visiblePlan.id)}
            >
              <Timeline items={revisionEntries} />
            </SectionState>
          </>
        )}
      </section>

      {/* ── Entitlements: who is on what ──────────────────────────── */}
      <section className="card" aria-labelledby="billing-entitlements">
        <SectionHead
          id="billing-entitlements"
          title="Who is on what"
          sub="One row per business per product."
        />

        {!mayReadEntitlements ? (
          <StateBlock
            variant="denied"
            title="The entitlement directory needs platform:manage_businesses"
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
                <input
                  id="billing-search"
                  className="form-input"
                  type="search"
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

              <button type="submit" className="btn btn-neutral btn-sm">
                <span className="btn-label">Search</span>
              </button>

              {filtersActive && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSearchDraft('');
                    setSearchParams(new URLSearchParams(), { replace: true });
                  }}
                >
                  <span className="btn-label">Clear filters</span>
                </button>
              )}
            </form>

            {expiryWindow === 'expiring' ? (
              <p className="form-hint">
                Showing entitlements expiring within 30 days. The window is applied in this browser because the endpoint
                filters on status only, so a page can hold fewer rows than its page size.
              </p>
            ) : (
              (searchParams.get('filter') ?? '') !== '' && (
                <p className="form-hint">
                  The dashboard link asked for <span className="mono">{searchParams.get('filter')}</span>, translated to{' '}
                  {statusFilter ? `${humaniseToken(statusFilter)} entitlements` : 'no filter'}.
                </p>
              )
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
              Check reads the agreed price for one business.
            </p>
          </>
        )}
      </section>

      {/* ── Subscription changes ──────────────────────────────────── */}
      <section className="card" aria-labelledby="billing-changes">
        <SectionHead
          id="billing-changes"
          title="Subscription changes"
          sub="Written to subscription_adjustments; nothing here re-prices a customer."
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

            <p className="form-hint">Most recent 100 platform-wide; no total is returned.</p>
          </>
        )}
      </section>

      {/* ── Payment status ────────────────────────────────────────── */}
      <section className="card" aria-labelledby="billing-payments">
        <SectionHead
          id="billing-payments"
          title="Payment status"
          sub="Subscription payments in the selected period; sandbox transactions excluded."
          actions={
            <div className="toolbar-group">
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
          }
        />

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
            {inbound.paymentsUnavailable && (
              <div className="callout callout-warning">
                <div>
                  <p className="callout-title">Failed payments cannot be listed</p>
                  <p className="callout-text">
                    The dashboard link asked for failed payments. Only the aggregate totals below exist, so no list of
                    individual failures can be shown: the count is real, the rows behind it are not reachable here.
                  </p>
                </div>
              </div>
            )}

            <KpiGrid>
              <KpiCard
                label="Revenue in period"
                value={revenue.loading ? '—' : formatMoney(revenue.summary?.totalRevenue ?? null)}
                foot={`${formatNumber(revenue.summary?.successfulCount ?? null)} successful payments`}
              />
              <KpiCard
                label="Failed payments"
                value={revenue.loading ? '—' : formatNumber(revenue.summary?.failedCount ?? null)}
                tone={(revenue.summary?.failedCount ?? 0) > 0 ? 'warning' : 'default'}
                foot="From subscription_transactions"
              />
              <KpiCard
                label="Attempts in period"
                value={revenue.loading ? '—' : formatNumber(revenue.summary?.transactionCount ?? null)}
                foot="Sandbox excluded"
              />
              <KpiCard
                label="Attributed to a plan"
                value={revenue.loading ? '—' : formatMoney(breakdownTotal)}
                foot="From the bars below"
              />
            </KpiGrid>

            <div className="section-head">
              <div className="section-head-text">
                <h3 className="section-title">Revenue by plan</h3>
                <p className="section-sub">
                  Period total: {revenue.loading ? '—' : formatMoney(revenue.summary?.totalRevenue ?? null)}
                </p>
              </div>
            </div>
            {revenueMeters.length > 0 ? (
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
                Sandbox transactions are excluded. Grouping is by the legacy subscription_plans table, not the plan
                ladder above, so a name can differ and a payment with no legacy plan appears in no bar.
              </p>
            </Disclosure>
          </>
        )}
      </section>

      {/* ── Not built yet ─────────────────────────────────────────── */}
      <section className="card" aria-labelledby="billing-not-built">
        <SectionHead
          id="billing-not-built"
          title="Not built yet"
        />
        <ul className="list">
          {NOT_BUILT.map((item) => (
            <li className="list-item" key={item.title}>
              <div>
                <p className="list-item-title">
                  {item.title} <StatusBadge status="not_configured" />
                </p>
                <p className="list-item-subtitle">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="plat-section-sub">Permissions</p>
        <DefList
          rows={[
            { term: 'Catalogue, pricing and revenue', value: <span className="mono">{PERMISSIONS.view}</span> },
            {
              term: 'Entitlements and agreed prices',
              value: <span className="mono">{PERMISSIONS.entitlements}</span>,
            },
            {
              term: 'Subscription changes',
              value: <span className="mono">{PERMISSIONS.payments}</span>,
            },
            { term: 'Saving a plan', value: <span className="mono">{PERMISSIONS.plans}</span> },
          ]}
        />
        <p className="form-hint">
          The server re-checks every call; hiding a control is never the control.
        </p>
      </section>

      <PlanEditDialog
        plan={editingPlan}
        siblingPlans={plans.filter((plan) => plan.productKey === editingPlan?.productKey)}
        onClose={() => setEditingPlan(null)}
        onSaved={() => {
          if (editingPlan) setSelectedPlanId(editingPlan.id);
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
