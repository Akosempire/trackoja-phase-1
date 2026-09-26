import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import PlatformDashboardPage from './PlatformDashboardPage';
import {
  PlatformAdminService,
  type ActivationKeyRow,
  type BusinessDetail,
  type MyPlatformAccess,
  type NotificationTemplate,
  type PlatformAdminAccount,
  type PlatformOverviewV2,
  type PlatformProduct,
  type PlatformSetting,
  type PlatformUserRow,
  type PlanRevision,
  type ProductBusiness,
  type ProductPlan,
  type SandboxBusiness,
  type SubscriptionAdjustment,
  type SupportNote,
} from '../../services/platformAdmin.service';

// ---------------------------------------------------------------- helpers

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatMoney(value: number | null | undefined, currency = 'NGN'): string {
  if (value === null || value === undefined) return 'Custom';
  const symbol = currency === 'NGN' ? '₦' : '';
  return `${symbol}${Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function limitLabel(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return 'Custom users';
  if (limit === -1) return 'Unlimited users';
  return `${limit} user${limit === 1 ? '' : 's'}`;
}

const STATUS_BADGES: Record<string, string> = {
  active: 'badge-success',
  pending: 'badge-warning',
  past_due: 'badge-warning',
  trialing: 'badge-warning',
  suspended: 'badge-danger',
  expired: 'badge-danger',
  cancelled: 'badge-danger',
  failed: 'badge-danger',
  success: 'badge-success',
  issued: 'badge-default',
  redeemed: 'badge-success',
  revoked: 'badge-danger',
  draft: 'badge-default',
  retired: 'badge-default',
  inactive: 'badge-default',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_BADGES[status] ?? 'badge-default'}`}>{status.replace(/_/g, ' ')}</span>;
}

function SectionState({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyText?: string;
}) {
  if (loading) return <PageLoader />;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (empty) return <div className="empty-state">{emptyText ?? 'Nothing here yet.'}</div>;
  return null;
}

// --------------------------------------------------------------- overview

export function OverviewSection() {
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [productKey, setProductKey] = useState('');
  const [overview, setOverview] = useState<PlatformOverviewV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    PlatformAdminService.listProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    PlatformAdminService.getOverview(productKey || undefined)
      .then(setOverview)
      .catch((err) => setError(err.message ?? 'Failed to load overview'))
      .finally(() => setLoading(false));
  }, [productKey]);

  return (
    <div className="plat-section">
      <div className="plat-toolbar">
        <label className="plat-field">
          <span className="form-label">Product</span>
          <select className="select-input" value={productKey} onChange={(e) => setProductKey(e.target.value)}>
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <SectionState loading={loading} error={error} />

      {!loading && overview && (
        <>
          <div className="plat-kpi-grid">
            <div className="plat-kpi-card">
              <p className="plat-kpi-value">{overview.totalBusinesses}</p>
              <p className="plat-kpi-label">Businesses</p>
            </div>
            <div className="plat-kpi-card">
              <p className="plat-kpi-value">{overview.activeSubscriptions}</p>
              <p className="plat-kpi-label">Active subscriptions</p>
            </div>
            <div className="plat-kpi-card">
              <p className="plat-kpi-value">{formatMoney(overview.revenue30d)}</p>
              <p className="plat-kpi-label">Revenue (30 days)</p>
            </div>
            <div className={`plat-kpi-card${overview.failedPayments30d > 0 ? ' plat-kpi-danger' : ''}`}>
              <p className="plat-kpi-value">{overview.failedPayments30d}</p>
              <p className="plat-kpi-label">Failed payments (30d)</p>
            </div>
            <div className="plat-kpi-card">
              <p className="plat-kpi-value">{overview.expiringWithin30d}</p>
              <p className="plat-kpi-label">Expiring in 30 days</p>
            </div>
          </div>

          <p className="plat-note">
            {overview.sandboxBusinesses} sandbox business{overview.sandboxBusinesses === 1 ? '' : 'es'} excluded
            from these figures. Trial, past-due, and recent activity detail is below.
          </p>
        </>
      )}

      {/* The original dashboard stays as the detailed view beneath the filters. */}
      <PlatformDashboardPage />
    </div>
  );
}

// --------------------------------------------------------------- products

export function ProductsSection() {
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<PlatformProduct | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    PlatformAdminService.listProducts()
      .then(setProducts)
      .catch((err) => setError(err.message ?? 'Failed to load products'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await PlatformAdminService.saveProduct({
        key: editing.key,
        name: editing.name,
        tagline: editing.tagline,
        description: editing.description,
        status: editing.status,
        visibility: editing.visibility,
        onboardingNote: editing.onboardingNote,
        accessSettings: editing.accessSettings,
        sortOrder: editing.sortOrder,
      });
      setEditing(null);
      load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="plat-section">
      <p className="plat-note">
        Each product owns its own plans, pricing, features, and access settings. TrackOja Works
        starts with none of these defined — nothing is copied from TrackOja.
      </p>

      <SectionState loading={loading} error={error} empty={products.length === 0} emptyText="No products configured." />

      {!loading && products.length > 0 && (
        <div className="card">
          <div className="list">
            {products.map((product) => (
              <div className="list-item" key={product.id}>
                <div>
                  <p className="list-item-title">
                    {product.name} <span className="plat-key">{product.key}</span>
                  </p>
                  <p className="list-item-subtitle">
                    {product.planCount} plan{product.planCount === 1 ? '' : 's'} ·{' '}
                    {product.businessCount} business{product.businessCount === 1 ? '' : 'es'} ·{' '}
                    {product.visibility}
                  </p>
                </div>
                <div className="list-item-meta">
                  <StatusBadge status={product.status} />
                  <Button variant="ghost" className="btn-sm" onClick={() => setEditing({ ...product })}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <div className="card plat-form">
          <p className="plat-section-title">Edit {editing.name}</p>
          <FormField id="prod-name" label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
          <FormField
            id="prod-tagline"
            label="Tagline"
            value={editing.tagline ?? ''}
            onChange={(v) => setEditing({ ...editing, tagline: v })}
          />
          <FormField
            id="prod-desc"
            label="Description"
            value={editing.description ?? ''}
            onChange={(v) => setEditing({ ...editing, description: v })}
          />
          <FormField
            id="prod-onboarding"
            label="Onboarding rules"
            value={editing.onboardingNote ?? ''}
            onChange={(v) => setEditing({ ...editing, onboardingNote: v })}
          />
          <div className="plat-form-row">
            <label className="plat-field">
              <span className="form-label">Status</span>
              <select
                className="select-input"
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value as PlatformProduct['status'] })}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="internal">internal</option>
              </select>
            </label>
            <label className="plat-field">
              <span className="form-label">Visibility</span>
              <select
                className="select-input"
                value={editing.visibility}
                onChange={(e) => setEditing({ ...editing, visibility: e.target.value as PlatformProduct['visibility'] })}
              >
                <option value="public">public</option>
                <option value="private">private</option>
                <option value="hidden">hidden</option>
              </select>
            </label>
          </div>
          <div className="btn-row">
            <Button onClick={handleSave} loading={saving}>
              Save product
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------- plans/pricing

export function PlansSection() {
  const [plans, setPlans] = useState<ProductPlan[]>([]);
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [productKey, setProductKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProductPlan | null>(null);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    PlatformAdminService.listPlans(productKey || undefined)
      .then(setPlans)
      .catch((err) => setError(err.message ?? 'Failed to load plans'))
      .finally(() => setLoading(false));
  }, [productKey]);

  useEffect(load, [load]);
  useEffect(() => {
    PlatformAdminService.listProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  const showHistory = async (plan: ProductPlan) => {
    setEditing({ ...plan });
    try {
      setRevisions(await PlatformAdminService.listPlanRevisions(plan.id, 20));
    } catch {
      setRevisions([]);
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await PlatformAdminService.savePlan({
        productKey: editing.productKey,
        planKey: editing.key,
        name: editing.name,
        description: editing.description,
        monthlyPrice: editing.monthlyPrice,
        annualPrice: editing.annualPrice,
        userLimit: editing.userLimit,
        features: editing.features,
        onboardingNote: editing.onboardingNote,
        status: editing.status,
        isDefault: editing.isDefault,
        isPublic: editing.isPublic,
        sortOrder: editing.sortOrder,
      });
      setEditing(null);
      setRevisions([]);
      load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="plat-section">
      <div className="plat-toolbar">
        <label className="plat-field">
          <span className="form-label">Product</span>
          <select className="select-input" value={productKey} onChange={(e) => setProductKey(e.target.value)}>
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="plat-note">
        Price edits apply to new subscriptions only. Existing customers keep the price agreed at
        activation, and every change is journalled.
      </p>

      <SectionState loading={loading} error={error} empty={plans.length === 0} emptyText="No plans for this product yet." />

      {!loading && plans.length > 0 && (
        <div className="card">
          <div className="list">
            {plans.map((plan) => (
              <div className="list-item" key={plan.id}>
                <div>
                  <p className="list-item-title">
                    {plan.name} <span className="plat-key">{plan.productKey}</span>
                  </p>
                  <p className="list-item-subtitle">
                    {formatMoney(plan.monthlyPrice, plan.currency)}/month ·{' '}
                    {formatMoney(plan.annualPrice, plan.currency)}/year · {limitLabel(plan.userLimit)} ·{' '}
                    {plan.subscriberCount} subscriber{plan.subscriberCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="list-item-meta">
                  <StatusBadge status={plan.status} />
                  <Button variant="ghost" className="btn-sm" onClick={() => showHistory(plan)}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <div className="card plat-form">
          <p className="plat-section-title">
            Edit {editing.name} <span className="plat-key">{editing.productKey}</span>
          </p>
          <FormField id="plan-name" label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
          <div className="plat-form-row">
            <FormField
              id="plan-monthly"
              label="Monthly price (blank = custom)"
              value={editing.monthlyPrice === null ? '' : String(editing.monthlyPrice)}
              onChange={(v) => setEditing({ ...editing, monthlyPrice: v.trim() === '' ? null : Number(v) })}
            />
            <FormField
              id="plan-annual"
              label="Annual price (blank = custom)"
              value={editing.annualPrice === null ? '' : String(editing.annualPrice)}
              onChange={(v) => setEditing({ ...editing, annualPrice: v.trim() === '' ? null : Number(v) })}
            />
          </div>
          <div className="plat-form-row">
            <FormField
              id="plan-seats"
              label="User limit (-1 unlimited, blank custom)"
              value={editing.userLimit === null ? '' : String(editing.userLimit)}
              onChange={(v) => setEditing({ ...editing, userLimit: v.trim() === '' ? null : Number(v) })}
            />
            <label className="plat-field">
              <span className="form-label">Status</span>
              <select
                className="select-input"
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value as ProductPlan['status'] })}
              >
                <option value="active">active</option>
                <option value="draft">draft</option>
                <option value="inactive">inactive</option>
                <option value="retired">retired</option>
              </select>
            </label>
          </div>
          <div className="btn-row">
            <Button onClick={handleSave} loading={saving}>
              Save plan
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setRevisions([]);
              }}
            >
              Cancel
            </Button>
          </div>

          {revisions.length > 0 && (
            <>
              <p className="plat-section-sub">Change history</p>
              <div className="list">
                {revisions.map((rev) => (
                  <div className="list-item" key={rev.id}>
                    <div>
                      <p className="list-item-title">{rev.changeType}</p>
                      <p className="list-item-subtitle">
                        {rev.changedByEmail ?? 'unknown'} · {formatDate(rev.createdAt)}
                      </p>
                    </div>
                    <div className="list-item-meta">
                      <span className="plat-key">
                        {rev.previousValues
                          ? `${formatMoney(Number((rev.previousValues as any).monthly_price ?? 0))} → ${formatMoney(
                              Number((rev.newValues as any)?.monthly_price ?? 0)
                            )}`
                          : 'created'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- businesses

export function BusinessesSection() {
  const [rows, setRows] = useState<ProductBusiness[]>([]);
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [productKey, setProductKey] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [detailName, setDetailName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    PlatformAdminService.listBusinesses({ productKey: productKey || undefined, search: search || undefined })
      .then(setRows)
      .catch((err) => setError(err.message ?? 'Failed to load businesses'))
      .finally(() => setLoading(false));
  }, [productKey, search]);

  useEffect(load, [load]);
  useEffect(() => {
    PlatformAdminService.listProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  const openDetail = async (row: ProductBusiness) => {
    setBusy(true);
    setDetailName(row.name);
    try {
      setDetail(await PlatformAdminService.getBusiness(row.orgId));
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load business');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plat-section">
      <div className="plat-toolbar">
        <label className="plat-field">
          <span className="form-label">Product</span>
          <select className="select-input" value={productKey} onChange={(e) => setProductKey(e.target.value)}>
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="plat-field plat-field-grow">
          <span className="form-label">Search</span>
          <input
            className="form-input"
            type="search"
            placeholder="Business name, owner email, or slug"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <SectionState loading={loading} error={error} empty={rows.length === 0} emptyText="No businesses match." />

      {!loading && rows.length > 0 && (
        <div className="card">
          <div className="list">
            {rows.map((row) => (
              <div className="list-item" key={`${row.orgId}-${row.productKey}`}>
                <div>
                  <p className="list-item-title">
                    {row.name}
                    {row.isSandbox && <span className="plat-sandbox">sandbox</span>}
                  </p>
                  <p className="list-item-subtitle">
                    {row.ownerEmail ?? 'no owner'} · {row.productName}
                    {row.planName ? ` · ${row.planName}` : ''} · seats {row.seatUsed}/
                    {row.agreedUserLimit === null ? '∞' : row.agreedUserLimit}
                  </p>
                  <p className="list-item-subtitle">
                    {row.storeCount} store{row.storeCount === 1 ? '' : 's'} · {row.businessCategory} ·
                    created {formatDate(row.createdAt)}
                  </p>
                </div>
                <div className="list-item-meta">
                  <StatusBadge status={row.entitlementStatus} />
                  <Button variant="ghost" className="btn-sm" onClick={() => openDetail(row)}>
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {busy && <PageLoader />}

      {detail && !busy && (
        <div className="card plat-detail">
          <div className="plat-detail-head">
            <p className="plat-section-title">{detailName}</p>
            <Button variant="outline" className="btn-sm" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>

          <p className="plat-section-sub">Subscribed products</p>
          <div className="list">
            {detail.products.map((p: any) => (
              <div className="list-item" key={String(p.product_key)}>
                <div>
                  <p className="list-item-title">{p.product_name}</p>
                  <p className="list-item-subtitle">
                    {p.plan_name ?? 'no plan'} · {limitLabel(p.agreed_user_limit)} · via {p.source} ·
                    expires {formatDate(p.expires_at)}
                  </p>
                </div>
                <div className="list-item-meta">
                  <StatusBadge status={String(p.status)} />
                </div>
              </div>
            ))}
          </div>

          <p className="plat-section-sub">Staff ({detail.seatUsed} seats used)</p>
          {detail.staff.length === 0 ? (
            <p className="plat-note">No staff records.</p>
          ) : (
            <div className="list">
              {detail.staff.map((s: any, index) => (
                <div className="list-item" key={`${s.email}-${index}`}>
                  <div>
                    <p className="list-item-title">{s.email ?? s.user_id ?? 'pending invite'}</p>
                    <p className="list-item-subtitle">
                      {s.role ?? 'no role'} · {s.store_name}
                    </p>
                  </div>
                  <div className="list-item-meta">
                    <StatusBadge status={String(s.status)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="plat-section-sub">Recent payments</p>
          {detail.payments.length === 0 ? (
            <p className="plat-note">No payments recorded.</p>
          ) : (
            <div className="list">
              {detail.payments.map((p: any) => (
                <div className="list-item" key={String(p.reference)}>
                  <div>
                    <p className="list-item-title">{formatMoney(Number(p.amount), String(p.currency))}</p>
                    <p className="list-item-subtitle">
                      {p.reference} · {formatDate(p.created_at)}
                    </p>
                  </div>
                  <div className="list-item-meta">
                    <StatusBadge status={String(p.status)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="plat-section-sub">Support history</p>
          {detail.supportNotes.length === 0 ? (
            <p className="plat-note">No support notes yet. Add one from the Support tab.</p>
          ) : (
            <div className="list">
              {detail.supportNotes.map((n: any) => (
                <div className="list-item" key={String(n.id)}>
                  <div>
                    <p className="list-item-title">{n.note_type}</p>
                    <p className="list-item-subtitle">{n.body}</p>
                  </div>
                  <div className="list-item-meta">
                    <span className="plat-key">{formatDate(n.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ users/roles

export function UsersSection({ access }: { access: MyPlatformAccess }) {
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [admins, setAdmins] = useState<PlatformAdminAccount[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      PlatformAdminService.listUsers({ search: search || undefined }),
      PlatformAdminService.listAdminAccounts(),
    ])
      .then(([u, a]) => {
        setUsers(u);
        setAdmins(a);
      })
      .catch((err) => setError(err.message ?? 'Failed to load users'))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(load, [load]);

  const togglePermission = async (userId: string, key: string, granted: boolean) => {
    setNotice(null);
    setError(null);
    try {
      await PlatformAdminService.setAdminPermission(userId, key, granted);
      setNotice(`Permission ${granted ? 'granted' : 'revoked'}: ${key}`);
      load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to change permission');
    }
  };

  return (
    <div className="plat-section">
      <div className="plat-toolbar">
        <label className="plat-field plat-field-grow">
          <span className="form-label">Search users</span>
          <input
            className="form-input"
            type="search"
            placeholder="Email or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <SectionState loading={loading} error={error} />
      {notice && <div className="alert alert-success">{notice}</div>}

      {!loading && (
        <>
          <p className="plat-section-sub">Business users and their product access</p>
          {users.length === 0 ? (
            <div className="empty-state">No users match.</div>
          ) : (
            <div className="card">
              <div className="list">
                {users.map((u) => (
                  <div className="list-item" key={u.userId}>
                    <div>
                      <p className="list-item-title">
                        {u.fullName ?? u.email}
                        {u.isPlatformAdmin && <span className="plat-key">platform</span>}
                        {u.developerMode && <span className="plat-sandbox">developer</span>}
                      </p>
                      <p className="list-item-subtitle">
                        {u.email} · {u.orgName ?? 'no business'} · {u.storeRole ?? 'no role'}
                      </p>
                      <p className="list-item-subtitle">
                        Products: {u.entitledProducts.length > 0 ? u.entitledProducts.join(', ') : 'none'} ·
                        seat limit {limitLabel(u.seatLimit)}
                      </p>
                    </div>
                    <div className="list-item-meta">
                      <span className="plat-key">
                        {u.lastLoginAt ? `seen ${formatDate(u.lastLoginAt)}` : 'never signed in'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="plat-section-sub">
            Platform admins {access.isSuperAdmin ? '(you can edit permissions)' : '(read-only)'}
          </p>
          <div className="card">
            <div className="list">
              {admins.map((admin) => (
                <div className="list-item" key={admin.userId}>
                  <div>
                    <p className="list-item-title">
                      {admin.email} <span className="plat-key">{admin.level}</span>
                    </p>
                    <p className="list-item-subtitle">
                      {admin.permissions.length} permission{admin.permissions.length === 1 ? '' : 's'}
                      {admin.developerMode ? ' · developer mode' : ''}
                    </p>
                  </div>
                  <div className="list-item-meta">
                    <StatusBadge status={admin.status} />
                  </div>
                </div>
              ))}
            </div>

            {access.isSuperAdmin && (
              <div className="plat-perm-grid">
                {admins
                  .filter((admin) => admin.level !== 'super_admin')
                  .map((admin) => (
                    <div className="plat-perm-block" key={admin.userId}>
                      <p className="plat-perm-email">{admin.email}</p>
                      {PLATFORM_PERMISSION_KEYS.map((key) => (
                        <label className="plat-check" key={key}>
                          <input
                            type="checkbox"
                            checked={admin.permissions.includes(key)}
                            onChange={(e) => togglePermission(admin.userId, key, e.target.checked)}
                          />
                          <span>{key}</span>
                        </label>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const PLATFORM_PERMISSION_KEYS = [
  'platform:view',
  'platform:manage_products',
  'platform:manage_businesses',
  'platform:manage_users',
  'platform:manage_plans',
  'platform:manage_payments',
  'platform:manage_activation',
  'platform:support',
  'platform:manage_settings',
  'platform:impersonate',
  'developer:access',
  'developer:manage',
];

// --------------------------------------------------------------- payments

export function PaymentsSection() {
  const [adjustments, setAdjustments] = useState<SubscriptionAdjustment[]>([]);
  const [businesses, setBusinesses] = useState<ProductBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ orgId: '', type: 'extend_expiry', reason: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([PlatformAdminService.listAdjustments(), PlatformAdminService.listBusinesses({ limit: 200 })])
      .then(([a, b]) => {
        setAdjustments(a);
        setBusinesses(b);
      })
      .catch((err) => setError(err.message ?? 'Failed to load payments'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await PlatformAdminService.recordAdjustment({
        orgId: form.orgId,
        adjustmentType: form.type,
        reason: form.reason,
      });
      setForm({ orgId: '', type: 'extend_expiry', reason: '' });
      load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to record adjustment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="plat-section">
      <p className="plat-note">
        Renewals, upgrades, downgrades, expiry changes, suspensions, and manual activations are
        recorded as adjustments with a mandatory reason, so every manual change is attributable.
      </p>

      <SectionState loading={loading} error={error} />

      {!loading && (
        <>
          <div className="card plat-form">
            <p className="plat-section-title">Record an adjustment</p>
            <div className="plat-form-row">
              <label className="plat-field plat-field-grow">
                <span className="form-label">Business</span>
                <select
                  className="select-input"
                  value={form.orgId}
                  onChange={(e) => setForm({ ...form, orgId: e.target.value })}
                >
                  <option value="">Select a business…</option>
                  {businesses.map((b) => (
                    <option key={b.orgId} value={b.orgId}>
                      {b.name} — {b.productName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="plat-field">
                <span className="form-label">Adjustment</span>
                <select
                  className="select-input"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  {[
                    'extend_expiry',
                    'shorten_expiry',
                    'change_plan',
                    'upgrade',
                    'downgrade',
                    'suspend',
                    'reinstate',
                    'cancel',
                    'reactivate',
                    'manual_activation',
                    'seat_change',
                  ].map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <FormField
              id="adj-reason"
              label="Reason (required, at least 5 characters)"
              value={form.reason}
              onChange={(v) => setForm({ ...form, reason: v })}
            />
            <Button onClick={submit} loading={saving} disabled={!form.orgId || form.reason.trim().length < 5}>
              Record adjustment
            </Button>
          </div>

          <p className="plat-section-sub">Recent adjustments</p>
          {adjustments.length === 0 ? (
            <div className="empty-state">No adjustments recorded.</div>
          ) : (
            <div className="card">
              <div className="list">
                {adjustments.map((a) => (
                  <div className="list-item" key={a.id}>
                    <div>
                      <p className="list-item-title">{a.adjustmentType.replace(/_/g, ' ')}</p>
                      <p className="list-item-subtitle">
                        {a.orgName ?? a.orgId} · {a.reason}
                      </p>
                    </div>
                    <div className="list-item-meta">
                      <span className="plat-key">
                        {a.performedByEmail ?? 'system'} · {formatDate(a.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- activation

export function ActivationSection() {
  const [keys, setKeys] = useState<ActivationKeyRow[]>([]);
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ productKey: '', planKey: '', validDays: '365' });

  const load = useCallback(() => {
    setLoading(true);
    PlatformAdminService.listActivationKeys()
      .then(setKeys)
      .catch((err) => setError(err.message ?? 'Failed to load activation keys'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    PlatformAdminService.listProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  const issue = async () => {
    setSaving(true);
    setError(null);
    setIssued(null);
    try {
      const result = await PlatformAdminService.issueActivationKey({
        productKey: form.productKey,
        planKey: form.planKey || null,
        validDays: Number(form.validDays) || 365,
      });
      setIssued(result.keyCode);
      load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to issue key');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (key: ActivationKeyRow) => {
    const reason = 'Revoked by platform admin';
    try {
      await PlatformAdminService.revokeActivationKey(key.id, reason);
      load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to revoke key');
    }
  };

  return (
    <div className="plat-section">
      <p className="plat-note">
        Keys are bound to a product, plan, and validity period, and each key activates exactly one
        business. Listing masks the code; a key is shown in full only once, when it is issued.
      </p>

      <SectionState loading={loading} error={error} />

      {!loading && (
        <>
          <div className="card plat-form">
            <p className="plat-section-title">Issue an activation key</p>
            <div className="plat-form-row">
              <label className="plat-field">
                <span className="form-label">Product</span>
                <select
                  className="select-input"
                  value={form.productKey}
                  onChange={(e) => setForm({ ...form, productKey: e.target.value, planKey: '' })}
                >
                  <option value="">Select a product…</option>
                  {products.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <FormField
                id="key-days"
                label="Valid for (days)"
                value={form.validDays}
                onChange={(v) => setForm({ ...form, validDays: v })}
              />
            </div>
            <FormField
              id="key-plan"
              label="Plan key (optional, e.g. standard)"
              value={form.planKey}
              onChange={(v) => setForm({ ...form, planKey: v })}
            />
            <Button onClick={issue} loading={saving} disabled={!form.productKey}>
              Issue key
            </Button>
            {issued && (
              <div className="alert alert-success">
                Key issued: <strong>{issued}</strong> — copy it now, it cannot be shown again.
              </div>
            )}
          </div>

          <p className="plat-section-sub">Issued keys</p>
          {keys.length === 0 ? (
            <div className="empty-state">No activation keys issued.</div>
          ) : (
            <div className="card">
              <div className="list">
                {keys.map((key) => (
                  <div className="list-item" key={key.id}>
                    <div>
                      <p className="list-item-title">
                        {key.keyCodeMasked} <span className="plat-key">{key.productKey}</span>
                        {key.isSandbox && <span className="plat-sandbox">sandbox</span>}
                      </p>
                      <p className="list-item-subtitle">
                        {key.planName ?? 'no plan'} · {limitLabel(key.userLimit)} ·{' '}
                        {key.orgName ?? 'unbound'} · valid to {formatDate(key.validUntil)}
                      </p>
                    </div>
                    <div className="list-item-meta">
                      <StatusBadge status={key.status} />
                      {key.status === 'issued' && (
                        <Button variant="danger" className="btn-sm" onClick={() => revoke(key)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- support

export function SupportSection() {
  const [businesses, setBusinesses] = useState<ProductBusiness[]>([]);
  const [orgId, setOrgId] = useState('');
  const [notes, setNotes] = useState<SupportNote[]>([]);
  const [body, setBody] = useState('');
  const [noteType, setNoteType] = useState('note');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjustments, setAdjustments] = useState<SubscriptionAdjustment[]>([]);

  useEffect(() => {
    PlatformAdminService.listBusinesses({ limit: 200 })
      .then(setBusinesses)
      .catch((err) => setError(err.message ?? 'Failed to load businesses'))
      .finally(() => setLoading(false));
    PlatformAdminService.listAdjustments(undefined, 50)
      .then(setAdjustments)
      .catch(() => setAdjustments([]));
  }, []);

  const loadNotes = useCallback((id: string) => {
    if (!id) {
      setNotes([]);
      return;
    }
    PlatformAdminService.listSupportNotes(id)
      .then(setNotes)
      .catch((err) => setError(err.message ?? 'Failed to load notes'));
  }, []);

  useEffect(() => loadNotes(orgId), [orgId, loadNotes]);

  const addNote = async () => {
    if (!orgId || body.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await PlatformAdminService.addSupportNote({ orgId, body, noteType });
      setBody('');
      loadNotes(orgId);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="plat-section">
      <SectionState loading={loading} error={error} />

      {!loading && (
        <>
          <div className="card plat-form">
            <p className="plat-section-title">Support note or admin action</p>
            <div className="plat-form-row">
              <label className="plat-field plat-field-grow">
                <span className="form-label">Business</span>
                <select className="select-input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  <option value="">Select a business…</option>
                  {businesses.map((b) => (
                    <option key={b.orgId} value={b.orgId}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="plat-field">
                <span className="form-label">Type</span>
                <select className="select-input" value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                  {['note', 'support_action', 'suspension', 'reinstatement', 'manual_activation', 'contact'].map(
                    (t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>
            <FormField id="note-body" label="Note" value={body} onChange={setBody} />
            <Button onClick={addNote} loading={saving} disabled={!orgId || body.trim().length === 0}>
              Add note
            </Button>
          </div>

          <p className="plat-section-sub">Notes for this business</p>
          {!orgId ? (
            <div className="empty-state">Choose a business to see its support history.</div>
          ) : notes.length === 0 ? (
            <div className="empty-state">No notes recorded yet.</div>
          ) : (
            <div className="card">
              <div className="list">
                {notes.map((note) => (
                  <div className="list-item" key={note.id}>
                    <div>
                      <p className="list-item-title">{note.noteType.replace(/_/g, ' ')}</p>
                      <p className="list-item-subtitle">{note.body}</p>
                    </div>
                    <div className="list-item-meta">
                      <span className="plat-key">
                        {note.adminEmail ?? 'system'} · {formatDate(note.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="plat-section-sub">Recent admin actions across the platform</p>
          {adjustments.length === 0 ? (
            <div className="empty-state">No admin actions recorded.</div>
          ) : (
            <div className="card">
              <div className="list">
                {adjustments.slice(0, 20).map((a) => (
                  <div className="list-item" key={a.id}>
                    <div>
                      <p className="list-item-title">{a.adjustmentType.replace(/_/g, ' ')}</p>
                      <p className="list-item-subtitle">
                        {a.orgName ?? a.orgId} · {a.reason}
                      </p>
                    </div>
                    <div className="list-item-meta">
                      <span className="plat-key">
                        {a.performedByEmail ?? 'system'} · {formatDate(a.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------- settings

export function SettingsSection() {
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([PlatformAdminService.listSettings(), PlatformAdminService.listNotificationTemplates()])
      .then(([s, t]) => {
        setSettings(s);
        setTemplates(t);
      })
      .catch((err) => setError(err.message ?? 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const save = async (setting: PlatformSetting) => {
    setError(null);
    setNotice(null);
    const raw = draft[setting.key];
    if (raw === undefined) return;
    // Preserve the stored JSON type instead of guessing from the text.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError(`"${setting.key}" must be valid JSON (for example true, 14, or "text").`);
      return;
    }
    try {
      await PlatformAdminService.setSetting(setting.key, parsed);
      setNotice(`Saved ${setting.key}`);
      setDraft((d) => {
        const next = { ...d };
        delete next[setting.key];
        return next;
      });
      load();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to save setting');
    }
  };

  return (
    <div className="plat-section">
      <p className="plat-note">
        Only non-secret configuration is stored here. Payment credentials and secret keys stay in
        server-side secret storage and are referenced by name.
      </p>

      <SectionState loading={loading} error={error} />
      {notice && <div className="alert alert-success">{notice}</div>}

      {!loading && (
        <>
          <p className="plat-section-sub">Platform settings</p>
          <div className="card">
            <div className="list">
              {settings.map((setting) => (
                <div className="list-item" key={setting.key}>
                  <div className="plat-setting-main">
                    <p className="list-item-title">{setting.key}</p>
                    <p className="list-item-subtitle">{setting.description ?? setting.category}</p>
                  </div>
                  <div className="plat-setting-edit">
                    <input
                      className="form-input"
                      value={draft[setting.key] ?? JSON.stringify(setting.value)}
                      onChange={(e) => setDraft({ ...draft, [setting.key]: e.target.value })}
                      aria-label={`Value for ${setting.key}`}
                    />
                    <Button className="btn-sm" onClick={() => save(setting)} disabled={draft[setting.key] === undefined}>
                      Save
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="plat-section-sub">Notification templates</p>
          {templates.length === 0 ? (
            <div className="empty-state">No notification templates defined.</div>
          ) : (
            <div className="card">
              <div className="list">
                {templates.map((template) => (
                  <div className="list-item" key={template.id}>
                    <div>
                      <p className="list-item-title">
                        {template.name} <span className="plat-key">{template.channel}</span>
                      </p>
                      <p className="list-item-subtitle">
                        {template.subject ?? '(no subject)'} · {template.key}
                      </p>
                    </div>
                    <div className="list-item-meta">
                      <StatusBadge status={template.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------- developer

export function DeveloperSection({ access }: { access: MyPlatformAccess }) {
  const [grants, setGrants] = useState<Awaited<ReturnType<typeof PlatformAdminService.listDeveloperGrants>>>([]);
  const [sandboxes, setSandboxes] = useState<SandboxBusiness[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [diagOrgId, setDiagOrgId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      PlatformAdminService.listDeveloperGrants().catch(() => []),
      PlatformAdminService.listSandboxBusinesses().catch(() => []),
    ])
      .then(([g, s]) => {
        setGrants(g);
        setSandboxes(s);
      })
      .catch((err) => setError(err.message ?? 'Failed to load developer data'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(`${label} done.`);
      load();
    } catch (err) {
      setError((err as Error).message ?? `${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plat-section">
      <div className="alert alert-error" role="note">
        Developer mode is for diagnosis and testing. It never bypasses payment verification,
        subscription enforcement, tenant isolation, or production permissions on a real customer
        account. Test overrides apply to sandbox records only.
      </div>

      <SectionState loading={loading} error={error} />
      {notice && <div className="alert alert-success">{notice}</div>}

      {!loading && (
        <>
          <div className="card">
            <p className="plat-section-title">Session</p>
            <p className="plat-note">
              Sandbox businesses: {sandboxes.length}
            </p>
            <div className="btn-row">
              <Button onClick={() => run('Start developer session', () => PlatformAdminService.startDeveloperSession())} loading={busy}>
                Start developer session
              </Button>
              <Button
                variant="outline"
                onClick={() => run('End developer session', () => PlatformAdminService.endDeveloperSession())}
                loading={busy}
              >
                End session
              </Button>
            </div>
          </div>

          <div className="card plat-form">
            <p className="plat-section-title">Create a sandbox business</p>
            <FormField
              id="sandbox-reason"
              label="Test business name"
              value={reason}
              onChange={setReason}
              placeholder="e.g. Sandbox Test Shop"
            />
            <Button
              onClick={() =>
                run('Create sandbox business', () =>
                  PlatformAdminService.createSandboxBusiness(reason.trim() || 'Sandbox Test Shop')
                )
              }
              loading={busy}
            >
              Create sandbox
            </Button>
            {sandboxes.length > 0 && (
              <div className="list">
                {sandboxes.map((s) => (
                  <div className="list-item" key={s.orgId}>
                    <div>
                      <p className="list-item-title">{s.name}</p>
                      <p className="list-item-subtitle">
                        {s.slug} · created {formatDate(s.createdAt)}
                      </p>
                    </div>
                    <div className="list-item-meta">
                      <span className="plat-sandbox">sandbox</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card plat-form">
            <p className="plat-section-title">Diagnostics (redacted)</p>
            <label className="plat-field">
              <span className="form-label">Business</span>
              <select className="select-input" value={diagOrgId} onChange={(e) => setDiagOrgId(e.target.value)}>
                <option value="">Select a business…</option>
                {sandboxes.map((s) => (
                  <option key={s.orgId} value={s.orgId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={!diagOrgId}
              loading={busy}
              onClick={() =>
                run('Load diagnostics', async () => {
                  setDiagnostics(await PlatformAdminService.getDiagnostics(diagOrgId));
                })
              }
            >
              Load diagnostics
            </Button>
            {diagnostics && <pre className="plat-diagnostics">{JSON.stringify(diagnostics, null, 2)}</pre>}
          </div>

          {access.isSuperAdmin && (
            <div className="card">
              <p className="plat-section-title">Developer mode grants (super admin)</p>
              <p className="plat-note">
                Grant developer mode to a platform admin only. Every grant and revocation is audited.
              </p>
              {grants.length === 0 ? (
                <div className="empty-state">No grants recorded.</div>
              ) : (
                <div className="list">
                  {grants.map((grant) => (
                    <div className="list-item" key={grant.userId}>
                      <div>
                        <p className="list-item-title">{grant.email}</p>
                        <p className="list-item-subtitle">
                          {grant.level} · granted by {grant.grantedByEmail ?? 'system'} · expires{' '}
                          {formatDate(grant.expiresAt)}
                        </p>
                        <p className="list-item-subtitle">{grant.reason ?? 'no reason recorded'}</p>
                      </div>
                      <div className="list-item-meta">
                        <StatusBadge status={grant.status} />
                        {grant.status === 'active' ? (
                          <Button
                            variant="danger"
                            className="btn-sm"
                            loading={busy}
                            onClick={() =>
                              run('Revoke developer mode', () =>
                                PlatformAdminService.revokeDeveloperMode(
                                  grant.userId,
                                  'Revoked from the developer admin area'
                                )
                              )
                            }
                          >
                            Revoke
                          </Button>
                        ) : (
                          <Button
                            className="btn-sm"
                            loading={busy}
                            onClick={() =>
                              run('Grant developer mode', () =>
                                PlatformAdminService.grantDeveloperMode(
                                  grant.userId,
                                  'Re-granted from the developer admin area',
                                  30
                                )
                              )
                            }
                          >
                            Grant
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
