import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PlatformAdminService,
  type ActivationKeyRow,
  type PlatformProduct,
  type ProductBusiness,
  type ProductPlan,
} from '../../../services/platformAdmin.service';
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
import { FormField } from '../../../components/ui/FormField';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useToast } from '../../../components/ui/Toast';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { daysUntil, formatDate, formatNumber, formatRelative, formatSeatLimit, humaniseToken } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'activation')!;

const MANAGE_PERMISSION = 'platform:manage_activation';

/** activation_keys.status — the four states the table can hold. */
const KEY_STATUSES = ['issued', 'redeemed', 'expired', 'revoked'] as const;

const LIMIT_OPTIONS = [25, 50, 100, 200] as const;

/**
 * The verbs redeem_activation_key raises, quoted word for word.
 *
 * They are the customer's errors rather than this screen's — the console issues
 * and revokes, it never redeems — but they are listed here because "the key does
 * not work" is the support call this screen exists to answer, and paraphrasing
 * them would hide the one detail that identifies the cause. Source:
 * 20260926000071_platform_activation_support_functions.sql, lines 144-194.
 */
const REDEMPTION_FAILURES: { message: string; means: string }[] = [
  {
    message: 'That activation key is not valid',
    means: 'No key row matches the code. The code was mistyped, or belongs to a different environment.',
  },
  {
    message: 'That activation key has already been used',
    means: 'The key was redeemed. Redemption is one-shot; a renewal needs a new key or an extend_expiry adjustment.',
  },
  {
    message: 'That activation key is no longer usable',
    means: 'The key is revoked or expired. Revoking is the usual cause when a refund or a chargeback happened.',
  },
  {
    message: 'That activation key is not active yet',
    means: 'valid_from is in the future. Issuing always stamps valid_from with now(), so this points at a key written outside this screen.',
  },
  {
    message: 'That activation key has expired',
    means: 'valid_until has passed. Nothing sweeps lapsed keys, so the row still reads Issued in the table above until someone redeems it.',
  },
  {
    message: 'That activation key was issued for a different business',
    means: 'The key is bound to another organisation. An unbound key has no such restriction; a bound one cannot be redirected.',
  },
  {
    message: 'A sandbox key can only activate a sandbox business, and a live key only a live business',
    means: 'The key and the redeeming business disagree about sandbox. Issue the key from the matching environment.',
  },
  {
    message: 'Only the business owner can redeem an activation key',
    means: 'A staff member tried to redeem. The owner of the business must enter the code.',
  },
  {
    message: 'Your account belongs to more than one business. Select a store before redeeming an activation key',
    means: 'The redeeming account is not tied to exactly one business, so the platform cannot tell who is activating.',
  },
  {
    message: 'No business is linked to your account',
    means: 'The account has no organisation. Signup did not finish, or the owner was removed.',
  },
];

/**
 * Capabilities with no backend behind them.
 *
 * Each is verified against the migrations rather than assumed, and each is stated
 * in the interface so nothing here looks like a control that was merely hidden.
 */
const NOT_BUILT: { title: string; detail: string }[] = [
  {
    title: 'No key re-display',
    detail:
      'A key is masked the moment it leaves the issuing call. list_activation_keys builds ••••-••••-XXXX from right(key_code, 4) and never returns the code itself (20260926000071_platform_activation_support_functions.sql, lines 346-347), so a lost key can only be replaced with a new one.',
  },
  {
    title: 'No validity extension',
    detail:
      'activation_key_events allows a validity_extended event type (20260926000064_platform_activation_keys_schema.sql, line 62) but no function writes one, and nothing updates valid_until after issuance.',
  },
  {
    title: 'No expiry sweep',
    detail:
      'No function sets an activation key to expired. A key whose valid_until has passed keeps the status Issued until a customer tries to redeem it and is refused — the table marks those rows rather than pretending they are live.',
  },
  {
    title: 'No per-key event history endpoint',
    detail:
      'activation_key_events records issuance, redemption and revocation, but no function returns those rows to any screen, so the table can show the current state and not the trail that produced it.',
  },
  {
    title: 'No bulk issue',
    detail:
      'issue_activation_key issues exactly one key per call. Producing a batch for a reseller means one call per key from outside this console.',
  },
  {
    title: 'No approval workflow',
    detail:
      'Anyone holding platform:manage_activation issues a key directly; the key becomes redeemable immediately and nothing reviews or countersigns it. The audit row is written after the fact, not before.',
  },
];

// ------------------------------------------------------------------ helpers

/**
 * The real server message, whatever shape it arrives in.
 *
 * Supabase returns PostgrestError objects, which are plain objects rather than
 * Error instances, so `cause instanceof Error` silently replaces the server's own
 * wording with a generic sentence. This screen exists to tell an operator why a
 * key was refused, so the exact words matter. (Duplicated from BillingArea rather
 * than extracted, because shared files are out of scope for this change.)
 */
function messageOf(cause: unknown): string {
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  if (cause && typeof cause === 'object' && 'message' in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return 'The request failed without a message from the server.';
}

function isPermissionDenied(message: string): boolean {
  return /permission denied/i.test(message);
}

interface KeyFilters {
  productKey: string;
  status: string;
  limit: number;
}

function useActivationKeys(permitted: boolean, filters: KeyFilters, refreshToken: number) {
  const [rows, setRows] = useState<ActivationKeyRow[]>([]);
  const [loading, setLoading] = useState(permitted);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setLoading(true);
    setError(null);
    try {
      setRows(
        await PlatformAdminService.listActivationKeys({
          productKey: filters.productKey || undefined,
          status: filters.status || undefined,
          limit: filters.limit,
        }),
      );
    } catch (cause) {
      setRows([]);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [permitted, filters.productKey, filters.status, filters.limit, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, reload: load };
}

/**
 * Products and plans for the issuing form.
 *
 * Neither list is required to issue a key — the plan is optional by design — so a
 * refused read narrows the form and says so instead of blocking it.
 */
function useIssueOptions(permitted: boolean) {
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [plans, setPlans] = useState<ProductPlan[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!permitted) return;
    setError(null);
    const [productResult, planResult] = await Promise.allSettled([
      PlatformAdminService.listProducts(),
      PlatformAdminService.listPlans(),
    ]);
    setProducts(productResult.status === 'fulfilled' ? productResult.value : []);
    setPlans(planResult.status === 'fulfilled' ? planResult.value : []);
    if (productResult.status === 'rejected' && planResult.status === 'rejected') {
      setError(messageOf(productResult.reason));
    }
  }, [permitted]);

  useEffect(() => {
    void load();
  }, [load]);

  return { products, plans, error, reload: load };
}

interface IssueFormState {
  productKey: string;
  planKey: string;
  validDays: string;
  paymentReference: string;
  isSandbox: boolean;
}

/**
 * Issue a key, with the server's own validation restated before the call.
 *
 * The conditions and wording come from issue_activation_key:
 * 20260926000071_platform_activation_support_functions.sql, lines 32-78, which
 * 20260927000089_platform_owner_hardening.sql re-created with the same checks.
 */
function validateIssue(
  form: IssueFormState,
  bound: ProductBusiness | null,
): string | null {
  if (!form.productKey) return 'A product key is required to issue an activation key';
  const days = Number(form.validDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return 'Validity must be between 1 and 3650 days';
  if (bound && form.isSandbox !== bound.isSandbox) {
    return 'A sandbox key can only be bound to a sandbox business, and a live key only to a live business';
  }
  return null;
}

interface IssueDialogProps {
  open: boolean;
  onClose: () => void;
  onIssued: () => void;
  products: PlatformProduct[];
  plans: ProductPlan[];
  optionsError: string | null;
  /** Sandbox records are developer-mode only, exactly like every other sandbox surface. */
  developerMode: boolean;
}

function IssueKeyDialog({
  open,
  onClose,
  onIssued,
  products,
  plans,
  optionsError,
  developerMode,
}: IssueDialogProps) {
  const toast = useToast();
  const [form, setForm] = useState<IssueFormState>({
    productKey: '',
    planKey: '',
    validDays: '365',
    paymentReference: '',
    isSandbox: false,
  });
  const [bound, setBound] = useState<ProductBusiness | null>(null);
  const [businessQuery, setBusinessQuery] = useState('');
  const [businessResults, setBusinessResults] = useState<ProductBusiness[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ id: string; keyCode: string } | null>(null);

  // Every opening starts clean: a partially filled form left over from the
  // previous key is how the wrong business gets bound.
  useEffect(() => {
    if (!open) return;
    setForm({ productKey: '', planKey: '', validDays: '365', paymentReference: '', isSandbox: false });
    setBound(null);
    setBusinessQuery('');
    setBusinessResults([]);
    setSearchError(null);
    setFormError(null);
    setBusy(false);
    setIssued(null);
  }, [open]);

  if (!open) return null;

  const productPlans = plans.filter((plan) => plan.productKey === form.productKey);
  // list_platform_products reports plan_count per product, which distinguishes
  // "this product deliberately has no plans" from "the plan list could not be
  // read" — two different situations that need two different sentences.
  const selectedProduct = products.find((product) => product.key === form.productKey);
  const productHasNoPlans = selectedProduct !== undefined && selectedProduct.planCount === 0;

  async function search() {
    const query = businessQuery.trim();
    setSearching(true);
    setSearchError(null);
    try {
      // list_product_businesses is gated on platform:manage_businesses, which an
      // activation operator may not hold; that is stated rather than hidden, and
      // an unbound key is still a complete, issuable key.
      setBusinessResults(await PlatformAdminService.listBusinesses({ search: query || undefined, limit: 8 }));
    } catch (cause) {
      setBusinessResults([]);
      setSearchError(messageOf(cause));
    } finally {
      setSearching(false);
    }
  }

  async function issue() {
    const invalid = validateIssue(form, bound);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setFormError(null);
    setBusy(true);
    const toastId = toast.loading('Issuing activation key…');
    try {
      const result = await PlatformAdminService.issueActivationKey({
        productKey: form.productKey,
        planKey: form.planKey || null,
        orgId: bound ? bound.orgId : null,
        validDays: Number(form.validDays),
        paymentReference: form.paymentReference.trim() || null,
        isSandbox: form.isSandbox,
      });
      setIssued(result);
      toast.update(toastId, {
        variant: 'success',
        message: 'Activation key issued',
        description: 'Copy the code now: the list only ever shows its last four characters.',
      });
      onIssued();
    } catch (cause) {
      const message = messageOf(cause);
      setFormError(message);
      toast.update(toastId, { variant: 'error', message: 'The key was not issued', description: message });
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Activation key issued"
        description="This is the only moment the full code exists in this interface."
        footer={
          <Button onClick={onClose}>Done</Button>
        }
      >
        <div className="callout callout-warning">
          <div>
            <p className="callout-title">Copy this code now</p>
            <p className="callout-text">
              The key list masks every code as ••••-••••-XXXX and no endpoint returns the rest of it, so this value cannot
              be recovered here afterwards. If it is lost, revoke the key and issue another one.
            </p>
          </div>
        </div>

        <pre className="code-panel">{issued.keyCode}</pre>

        <DefList
          rows={[
            { term: 'Product', value: form.productKey },
            { term: 'Plan', value: form.planKey || 'No plan — the entitlement will have no plan' },
            { term: 'Bound to', value: bound ? bound.name : 'Unbound — any business may redeem it once' },
            {
              term: 'Valid for',
              value: `${form.validDays} day${Number(form.validDays) === 1 ? '' : 's'} from now, and that expiry becomes the entitlement's expiry`,
            },
            {
              term: 'Seat limit carried by the key',
              value: (() => {
                const plan = plans.find(
                  (candidate) => candidate.productKey === form.productKey && candidate.key === form.planKey,
                );
                if (!form.planKey) return 'Custom — no plan was chosen, so no seat limit was captured';
                return plan ? formatSeatLimit(plan.userLimit) : 'Not readable — the plan could not be loaded';
              })(),
            },
            {
              term: 'Payment reference',
              value: form.paymentReference.trim() || 'None supplied',
            },
            { term: 'Sandbox', value: form.isSandbox ? 'Yes — sandbox businesses only' : 'No — live businesses only' },
          ]}
        />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Issue an activation key"
      description="For offline or manually approved purchases. The key becomes redeemable the moment it is issued."
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void issue()} loading={busy}>
            Issue key
          </Button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor="issue-product">
          Product
        </label>
        <select
          id="issue-product"
          className="select-input"
          value={form.productKey}
          onChange={(event) => setForm({ ...form, productKey: event.target.value, planKey: '' })}
          disabled={busy}
        >
          <option value="">Choose a product…</option>
          {products.map((product) => (
            <option key={product.key} value={product.key}>
              {product.name} ({product.key})
            </option>
          ))}
        </select>
        {products.length === 0 && (
          <p className="form-hint">
            {optionsError
              ? `The product list could not be read: ${optionsError}`
              : 'No products were returned, so a key cannot be issued from here.'}
          </p>
        )}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="issue-plan">
          Plan (optional)
        </label>
        <select
          id="issue-plan"
          className="select-input"
          value={form.planKey}
          onChange={(event) => setForm({ ...form, planKey: event.target.value })}
          disabled={busy || !form.productKey}
        >
          <option value="">No plan</option>
          {productPlans.map((plan) => (
            <option key={plan.id} value={plan.key}>
              {plan.name} — {formatSeatLimit(plan.userLimit)}
            </option>
          ))}
        </select>
        <p className="form-hint">
          {productHasNoPlans
            ? 'This product has no plans: TrackOja Works was seeded as a product row deliberately without prices or limits, so a key for it carries no plan.'
            : form.planKey
              ? 'The plan supplies the seat limit and the prices the entitlement will snapshot at redemption.'
              : form.productKey && plans.length === 0
                ? 'No plans could be read, so this key will carry no plan: redemption would create an entitlement with no plan, a custom seat limit and no agreed prices.'
                : 'With no plan, redemption creates an entitlement with no plan, a custom seat limit and no agreed prices — the key grants access without a priced deal.'}
        </p>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="issue-validity">
          Validity in days
        </label>
        <input
          id="issue-validity"
          className="form-input"
          type="number"
          min={1}
          max={3650}
          value={form.validDays}
          onChange={(event) => setForm({ ...form, validDays: event.target.value })}
          disabled={busy}
        />
        <p className="form-hint">
          Between 1 and 3650. The key becomes valid now and its expiry is copied onto the entitlement at redemption, so
          the validity you choose here is the length of the access it grants.
        </p>
      </div>

      <div className="callout callout-info">
        <div>
          <p className="callout-title">Bound or unbound</p>
          <p className="callout-text">
            A bound key names one business at issue time and only that business can redeem it. An unbound key carries no
            organisation: the first business to redeem it wins, is written onto the key permanently, and the key closes
            at the same moment. Bind when the sale is already attributed; leave it unbound for printed vouchers and
            resellers. Binding needs platform:manage_businesses to search the directory — without that key, issue the key
            unbound.
          </p>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="issue-business-search">
          Bind to a business (optional)
        </label>
        <div className="toolbar">
          <div className="toolbar-grow">
            <input
              id="issue-business-search"
              className="form-input"
              type="search"
              value={businessQuery}
              placeholder="Search by name, owner email or slug"
              onChange={(event) => setBusinessQuery(event.target.value)}
              disabled={busy}
            />
          </div>
          <Button variant="outline" onClick={() => void search()} loading={searching} disabled={busy}>
            Search
          </Button>
        </div>

        {searchError && (
          <p className="form-error" role="alert">
            {searchError}
          </p>
        )}

        {businessResults.length > 0 && (
          <ul className="list">
            {businessResults.map((business) => (
              <li className="list-item" key={business.orgId}>
                <div>
                  <p className="list-item-title">
                    {business.name} {business.isSandbox && <Badge tone="workspace">sandbox</Badge>}
                  </p>
                  <p className="list-item-subtitle">
                    {business.ownerEmail ?? 'No owner email'} · {business.planName ?? 'No plan'} ·{' '}
                    {formatSeatLimit(business.agreedUserLimit)} seats
                  </p>
                </div>
                <div className="list-item-meta">
                  <Button
                    variant="ghost"
                    className="btn-sm"
                    onClick={() => {
                      setBound(business);
                      setBusinessResults([]);
                      setBusinessQuery('');
                    }}
                    disabled={busy}
                  >
                    Bind
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {bound ? (
          <p className="form-hint">
            Bound to <strong>{bound.name}</strong> ({bound.isSandbox ? 'sandbox' : 'live'}).{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBound(null)} disabled={busy}>
              <span className="btn-label">Clear binding</span>
            </button>
          </p>
        ) : (
          <p className="form-hint">Unbound: any business may redeem this key once.</p>
        )}

        {bound && form.isSandbox !== bound.isSandbox && (
          <p className="form-error" role="alert">
            A sandbox key can only be bound to a sandbox business, and a live key only to a live business.
          </p>
        )}
      </div>

      <FormField
        id="issue-payment-reference"
        label="Payment reference (optional)"
        value={form.paymentReference}
        onChange={(value) => setForm({ ...form, paymentReference: value })}
        placeholder="Bank transfer reference, receipt number"
        disabled={busy}
      />
      <p className="form-hint">
        The reference is written onto the key row. It is not returned by list_activation_keys, which has no
        payment_reference column, so it cannot be read back from this screen afterwards — record it wherever the money is
        reconciled as well.
      </p>

      <label className="plat-check" htmlFor="issue-sandbox">
        <input
          id="issue-sandbox"
          type="checkbox"
          checked={form.isSandbox}
          onChange={(event) => setForm({ ...form, isSandbox: event.target.checked })}
          disabled={busy || !developerMode}
        />
        Sandbox key — test only, activates sandbox businesses and never counts as revenue
      </label>
      {!developerMode && (
        <p className="form-hint">
          Developer mode is not active for this account, so sandbox issuance is refused by the server: &ldquo;Developer
          mode is required to issue sandbox activation keys&rdquo;. The control stays visible and disabled rather than
          disappearing.
        </p>
      )}

      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------- screen

export default function ActivationArea() {
  const { can, access, environment } = usePlatform();
  const toast = useToast();

  const allowed = can(MANAGE_PERMISSION);
  const developerMode = access?.developerMode ?? false;

  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [limit, setLimit] = useState<number>(LIMIT_OPTIONS[1]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [issueOpen, setIssueOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ActivationKeyRow | null>(null);

  const keys = useActivationKeys(allowed, { productKey: productFilter, status: statusFilter, limit }, refreshToken);
  const options = useIssueOptions(allowed);

  // A key list can name products the product endpoint did not return, so the
  // filter offers the union: a chip that cannot be clicked is worse than a chip
  // built from the rows already on screen.
  const productChips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const product of options.products) seen.set(product.key, product.name);
    for (const key of keys.rows) {
      if (!seen.has(key.productKey)) seen.set(key.productKey, key.productName);
    }
    return Array.from(seen.entries()).map(([key, name]) => ({ key, name }));
  }, [options.products, keys.rows]);

  const load = useCallback(() => {
    setRefreshToken((current) => current + 1);
  }, []);

  async function revoke(key: ActivationKeyRow, reason: string) {
    if (reason.trim().length < 5) {
      // revoke_activation_key only insists on a reason when the key was already
      // redeemed, but every revocation here is a decision someone has to be able
      // to explain later, so this interface always asks for one.
      throw new Error('Give a reason of at least 5 characters so the revocation can be explained later.');
    }
    const toastId = toast.loading(`Revoking ${key.keyCodeMasked}…`);
    try {
      await PlatformAdminService.revokeActivationKey(key.id, reason.trim());
      toast.update(toastId, {
        variant: 'success',
        message: 'Activation key revoked',
        description: 'The key can no longer be redeemed. Any entitlement it already granted is untouched.',
      });
      load();
    } catch (cause) {
      const message = messageOf(cause);
      toast.update(toastId, { variant: 'error', message: 'The key was not revoked', description: message });
      // Rethrown so the confirmation stays open showing the server's own words.
      throw new Error(message);
    }
  }

  const columns = useMemo<DataTableColumn<ActivationKeyRow>[]>(
    () => [
      {
        key: 'code',
        header: 'Key',
        label: '',
        render: (key) => (
          <div>
            <span className="secret-mask">{key.keyCodeMasked}</span>
            <p className="data-table-secondary">Only the last group is stored in this column's payload</p>
          </div>
        ),
      },
      {
        key: 'product',
        header: 'Product',
        sortValue: (key) => key.productName,
        render: (key) => (
          <div>
            <span className="data-table-primary">{key.productName}</span>
            <p className="data-table-secondary mono">{key.productKey}</p>
          </div>
        ),
      },
      {
        key: 'plan',
        header: 'Plan',
        sortValue: (key) => key.planName ?? '',
        render: (key) =>
          key.planName ? (
            <span className="data-table-primary">{key.planName}</span>
          ) : (
            <span className="data-table-secondary">Any plan — none captured</span>
          ),
      },
      {
        key: 'business',
        header: 'Bound business',
        sortValue: (key) => key.orgName ?? '',
        render: (key) =>
          key.orgName ? (
            <span className="data-table-primary">{key.orgName}</span>
          ) : (
            <span className="data-table-secondary">Unbound — redeemable once by any business</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        sortValue: (key) => key.status,
        render: (key) => {
          const lapsed = key.status === 'issued' && (daysUntil(key.validUntil) ?? 1) < 0;
          return (
            <div>
              <StatusBadge status={key.status} />
              {lapsed && (
                <>
                  {' '}
                  <Badge tone="warning">past its window</Badge>
                  <p className="data-table-secondary">
                    Nothing sweeps keys, so this row still reads Issued. A redemption would be refused with &ldquo;That
                    activation key has expired&rdquo;.
                  </p>
                </>
              )}
            </div>
          );
        },
      },
      {
        key: 'validity',
        header: 'Valid',
        sortValue: (key) => key.validUntil ?? '',
        render: (key) => {
          if (!key.validUntil) {
            return (
              <div>
                <span className="data-table-primary">No expiry</span>
                <p className="data-table-secondary">From {formatDate(key.validFrom)}</p>
              </div>
            );
          }
          const days = daysUntil(key.validUntil);
          return (
            <div>
              <span className="data-table-primary">
                {formatDate(key.validFrom)} → {formatDate(key.validUntil)}
              </span>
              <p className="data-table-secondary">
                {days !== null && days < 0 ? `Ended ${formatRelative(key.validUntil)}` : `${days} days left`}
              </p>
            </div>
          );
        },
      },
      {
        key: 'seats',
        header: 'Seats',
        sortValue: (key) => key.userLimit ?? 0,
        render: (key) => formatSeatLimit(key.userLimit),
      },
      {
        key: 'redeemed',
        header: 'Redeemed',
        sortValue: (key) => key.redeemedAt ?? '',
        render: (key) =>
          key.redeemedAt ? (
            <div>
              <span className="data-table-primary">{formatDate(key.redeemedAt)}</span>
              <p className="data-table-secondary">{formatRelative(key.redeemedAt)}</p>
            </div>
          ) : (
            <span className="data-table-secondary">Not redeemed</span>
          ),
      },
      {
        key: 'sandbox',
        header: 'Environment',
        sortValue: (key) => (key.isSandbox ? 'sandbox' : 'live'),
        render: (key) => <Badge tone={key.isSandbox ? 'workspace' : 'neutral'}>{key.isSandbox ? 'sandbox' : 'live'}</Badge>,
      },
      {
        key: 'issued',
        header: 'Issued',
        sortValue: (key) => key.createdAt,
        render: (key) => (
          <div>
            <span className="data-table-primary">{formatDate(key.createdAt)}</span>
            <p className="data-table-secondary">{formatRelative(key.createdAt)}</p>
          </div>
        ),
      },
      {
        key: 'actions',
        header: 'Revoke',
        render: (key) =>
          key.status === 'revoked' ? (
            <span className="is-locked">Already revoked</span>
          ) : (
            <div className="data-table-cell-actions">
              <Button variant="ghost" className="btn-sm" onClick={() => setRevokeTarget(key)}>
                Revoke
              </Button>
            </div>
          ),
      },
    ],
    [],
  );

  if (!allowed) {
    return (
      <>
        <PlatformPageHead area={AREA} />
        <PermissionDenied what="activation keys" permission={MANAGE_PERMISSION} />
      </>
    );
  }

  const lapsedCount = keys.rows.filter((key) => key.status === 'issued' && (daysUntil(key.validUntil) ?? 1) < 0).length;
  const sandboxCount = keys.rows.filter((key) => key.isSandbox).length;
  const filtersActive = Boolean(productFilter || statusFilter);

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description={`Issue, trace and revoke the keys that turn a payment into access. Signed in as ${
          access?.isSuperAdmin ? 'platform owner' : 'platform admin'
        } in ${environment.label.toLowerCase()}.`}
        actions={
          <>
            <RefreshButton onClick={load} loading={keys.loading} />
            <Button variant="outline" className="btn-sm" onClick={() => setIssueOpen(true)}>
              Issue a key
            </Button>
          </>
        }
      />

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot do yet" />

      {/* ── Keys ──────────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="activation-keys">
        <SectionHead
          id="activation-keys"
          title="Activation keys"
          sub="Newest first. Every code is masked in the response itself, not by the interface."
          actions={
            <div className="chip-row">
              <button
                type="button"
                className={`chip${productFilter === '' ? ' active' : ''}`}
                aria-pressed={productFilter === ''}
                onClick={() => setProductFilter('')}
              >
                All products
              </button>
              {productChips.map((product) => (
                <button
                  key={product.key}
                  type="button"
                  className={`chip${productFilter === product.key ? ' active' : ''}`}
                  aria-pressed={productFilter === product.key}
                  onClick={() => setProductFilter(product.key)}
                >
                  {product.name}
                </button>
              ))}
            </div>
          }
        />

        <div className="callout callout-info">
          <div>
            <p className="callout-title">Why every code reads ••••-••••-XXXX</p>
            <p className="callout-text">
              The masking happens on the server, not in this screen: list_activation_keys composes
              &lsquo;••••-••••-&rsquo; with right(key_code, 4), so a listing can never yield a usable key
              (20260926000071_platform_activation_support_functions.sql, lines 346-347). The full code is returned once,
              by the issuing call, and never again. A masked column here is the feature working, not a broken interface.
            </p>
          </div>
        </div>

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">Two columns of activation_keys are not readable from here</p>
            <p className="callout-text">
              payment_reference is written when a key is issued but is not in list_activation_keys&rsquo; column list, so
              it cannot be shown in the table — the value this screen collects is stored and then unreadable.
              bound_email and subscription_transaction_id are worse: issue_activation_key never sets them, and no other
              function does either, so they are not shown as empty columns but left out entirely
              (20260926000064_platform_activation_keys_schema.sql, lines 18 and 26;
              20260926000071_platform_activation_support_functions.sql, lines 85-98).
            </p>
          </div>
        </div>

        <div className="toolbar">
          <div className="plat-field">
            <label className="form-label" htmlFor="activation-status">
              Status
            </label>
            <select
              id="activation-status"
              className="select-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">Any status</option>
              {KEY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {humaniseToken(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="activation-limit">
              Rows
            </label>
            <select
              id="activation-limit"
              className="select-input"
              value={String(limit)}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {formatNumber(option)} newest
                </option>
              ))}
            </select>
          </div>

          {filtersActive && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setProductFilter('');
                setStatusFilter('');
              }}
            >
              <span className="btn-label">Clear filters</span>
            </button>
          )}
        </div>

        <DefList
          rows={[
            { term: 'Keys on this page', value: formatNumber(keys.rows.length) },
            {
              term: 'Past their validity window',
              value: lapsedCount > 0 ? `${formatNumber(lapsedCount)} still marked Issued` : 'None on this page',
              muted: lapsedCount === 0,
            },
            {
              term: 'Sandbox keys on this page',
              value: sandboxCount > 0 ? formatNumber(sandboxCount) : 'None on this page',
              muted: sandboxCount === 0,
            },
          ]}
        />

        {keys.error ? (
          isPermissionDenied(keys.error) ? (
            <StateBlock
              variant="denied"
              title="The server refused the key list"
              body={keys.error}
            />
          ) : (
            <StateBlock
              variant="error"
              title="Could not load activation keys"
              body={keys.error}
              actions={
                <button type="button" className="btn btn-outline btn-sm" onClick={keys.reload}>
                  <span className="btn-label">Try again</span>
                </button>
              }
            />
          )
        ) : (
          <DataTable
            columns={columns}
            rows={keys.rows}
            rowKey={(key) => key.id}
            stacked
            loading={keys.loading}
            caption="Activation keys"
            empty={
              <StateBlock
                variant="empty"
                title={filtersActive ? 'No keys match these filters' : 'No activation keys yet'}
                body={
                  filtersActive
                    ? 'Clear the filters to see every key. The endpoint filters on product and status only.'
                    : 'Keys appear here as they are issued. Nothing issues one automatically.'
                }
              />
            }
          />
        )}

        <p className="form-hint">
          list_activation_keys takes a limit but no offset and returns no total, so the newest {formatNumber(limit)} rows
          are shown and no page count can be offered honestly. Raise the row count or filter instead of paging.
        </p>
      </section>

      {/* ── How a key becomes access ──────────────────────────────── */}
      <section className="card" aria-labelledby="activation-model">
        <SectionHead
          id="activation-model"
          title="How activation interacts with subscription status"
          sub="organization_products is the entitlement. A key is only a way of writing one."
        />
        <ul className="list">
          <li className="list-item">
            <div>
              <p className="list-item-title">1. The entitlement is the access, not the key</p>
              <p className="list-item-subtitle">
                organization_products holds one row per business per product, and that row is what grants access and
                what the seat-limit trigger reads (20260926000063_platform_products_schema.sql, lines 113-152). Allowing
                a key does not by itself put a customer on a plan.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">2. Redemption upserts that row</p>
              <p className="list-item-subtitle">
                redeem_activation_key inserts or updates the entitlement with source = &lsquo;activation_key&rsquo; and
                status = &lsquo;active&rsquo;, snapshotting agreed_monthly_price and agreed_annual_price from the plan and
                agreed_user_limit from the key (20260926000071_platform_activation_support_functions.sql, lines 204-228).
                A business that already held the product has its existing deal overwritten rather than stacked.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">3. The key&rsquo;s expiry becomes the entitlement&rsquo;s expiry</p>
              <p className="list-item-subtitle">
                expires_at is set from the key&rsquo;s valid_until, so the validity chosen when issuing is the length of
                the access granted. Extending access afterwards means recording an extend_expiry adjustment on the
                entitlement — not editing the key, which nothing can do.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">4. The seat limit travels with the key</p>
              <p className="list-item-subtitle">
                The key captured the plan&rsquo;s seat limit when it was issued — &ldquo;Seat limit captured when the key
                was issued, so a later plan edit cannot widen it&rdquo;
                (20260926000064_platform_activation_keys_schema.sql, lines 49-50) — and redemption copies that figure onto
                the entitlement.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">5. An unbound key is bound by whoever redeems it</p>
              <p className="list-item-subtitle">
                Redemption writes the redeeming business onto the key and closes it to &lsquo;redeemed&rsquo; in the same
                transaction, so the first business to use it wins and the key cannot be redirected afterwards.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">6. Only the owner of a single business can redeem</p>
              <p className="list-item-subtitle">
                The function requires the signed-in user to own the business and to belong to exactly one business, and
                the key and the business must agree about sandbox. This screen issues keys; it never redeems them, so
                these conditions are the customer&rsquo;s to meet.
              </p>
            </div>
          </li>
        </ul>
      </section>

      {/* ── Failure states ────────────────────────────────────────── */}
      <section className="card" aria-labelledby="activation-failures">
        <SectionHead
          id="activation-failures"
          title="When a redemption fails"
          sub="The exact sentences a customer sees, so a support call can be answered from this page."
        />
        <ul className="list">
          {REDEMPTION_FAILURES.map((failure) => (
            <li className="list-item" key={failure.message}>
              <div>
                <p className="list-item-title">&ldquo;{failure.message}&rdquo;</p>
                <p className="list-item-subtitle">{failure.means}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="form-hint">
          These are raised by redeem_activation_key on the customer&rsquo;s side. The issue form above refuses the same
          conditions in the same words before it calls the server, so a key this screen accepts should not fail on a
          detail the operator could have seen.
        </p>
      </section>

      {/* ── Not built yet ─────────────────────────────────────────── */}
      <section className="card" aria-labelledby="activation-not-built">
        <SectionHead
          id="activation-not-built"
          title="Not built yet"
          sub="Capabilities with no backend behind them. Nothing on this page stands in for them."
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
        <p className="form-hint">
          Every action on this page is gated on <span className="mono">{MANAGE_PERMISSION}</span> in the database, so
          hiding a control is convenience rather than the control. The audit trail records issuance and revocation with
          the key&rsquo;s last four characters only — the full code is never copied into it.
        </p>
      </section>

      <IssueKeyDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        onIssued={load}
        products={options.products}
        plans={options.plans}
        optionsError={options.error}
        developerMode={developerMode}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={(reason) => (revokeTarget ? revoke(revokeTarget, reason) : Promise.resolve())}
        title={revokeTarget ? `Revoke ${revokeTarget.keyCodeMasked}?` : 'Revoke this key?'}
        confirmLabel="Revoke key"
        danger
        requireReason
        reasonLabel="Reason"
        reasonHint="At least 5 characters. The server only demands a reason for a key that was already redeemed, but this interface asks every time because a revocation has to be explainable later."
        consequence={
          revokeTarget
            ? `${
                revokeTarget.keyCodeMasked
              } will be marked revoked and stamped with the time, and can no longer be redeemed. Revoking does not remove the entitlement the key already granted: it only updates the key row, so a business that already redeemed it keeps its plan, its agreed prices and its seat limit. ${
                revokeTarget.status === 'redeemed' && revokeTarget.orgName
                  ? `${revokeTarget.orgName} has already redeemed this key, so its access is unaffected — record an extend_expiry, cancel or seat change against that business if the access is what needs to change.`
                  : 'This key has not been redeemed, so nothing downstream changes.'
              }`
            : ''
        }
      />
    </>
  );
}
