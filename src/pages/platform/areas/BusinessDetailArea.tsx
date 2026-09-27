import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PlatformAdminService, type BusinessDetail } from '../../../services/platformAdmin.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PermissionDenied, PlatformPageHead, RefreshButton } from '../../../components/platform/PlatformPageHead';
import { DefList, type DefRow } from '../../../components/ui/DefList';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Badge } from '../../../components/ui/Badge';
import { StateBlock } from '../../../components/ui/StateBlock';
import { Timeline, type TimelineEntry } from '../../../components/ui/Timeline';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Dialog, ConfirmDialog } from '../../../components/ui/Dialog';
import { FormField } from '../../../components/ui/FormField';
import { Button } from '../../../components/ui/Button';
import { PageLoader } from '../../../components/ui/PageLoader';
import { useToast } from '../../../components/ui/Toast';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { CATEGORY_CONFIGS } from '../../../config/businessModules';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatRelative, formatSeatLimit } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'businesses')!;

/** The detail endpoint returns JSON blobs, so every field is read defensively. */
function str(row: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(row: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = row?.[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function bool(row: Record<string, unknown> | null | undefined, key: string): boolean {
  return row?.[key] === true;
}

function categoryLabel(category: string | null): string {
  if (!category) return '—';
  const config = CATEGORY_CONFIGS[category as keyof typeof CATEGORY_CONFIGS];
  return config?.label ?? category.replace(/_/g, ' ');
}

export default function BusinessDetailArea() {
  const { orgId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = usePlatform();

  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustType, setAdjustType] = useState('extend_expiry');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustExpiry, setAdjustExpiry] = useState('');
  const [adjustSeats, setAdjustSeats] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [noteType, setNoteType] = useState('note');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [impersonateOpen, setImpersonateOpen] = useState(false);

  const allowed = can('platform:manage_businesses');

  const load = useCallback(async () => {
    if (!allowed || !orgId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await PlatformAdminService.getBusiness(orgId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this business.');
    } finally {
      setLoading(false);
    }
  }, [allowed, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const organization = detail?.organization ?? null;
  const name = str(organization, 'name') ?? 'Business';
  const entitlements = detail?.products ?? [];
  const primary = entitlements[0];

  async function submitAdjustment() {
    if (adjustReason.trim().length < 5) {
      setAdjustError('The server requires a reason of at least 5 characters for every subscription change.');
      return;
    }
    setAdjustBusy(true);
    setAdjustError(null);
    try {
      await PlatformAdminService.recordAdjustment({
        orgId,
        adjustmentType: adjustType,
        productKey: str(primary, 'product_key') ?? undefined,
        newExpiresAt: adjustExpiry ? new Date(adjustExpiry).toISOString() : undefined,
        newUserLimit: adjustSeats === '' ? undefined : Number(adjustSeats),
        reason: adjustReason.trim(),
      });
      toast.success('Subscription change recorded');
      setAdjustOpen(false);
      setAdjustReason('');
      setAdjustExpiry('');
      setAdjustSeats('');
      await load();
    } catch (cause) {
      setAdjustError(cause instanceof Error ? cause.message : 'The change was refused.');
    } finally {
      setAdjustBusy(false);
    }
  }

  async function submitNote() {
    if (noteBody.trim().length === 0) {
      setNoteError('Write something before saving.');
      return;
    }
    setNoteBusy(true);
    setNoteError(null);
    try {
      await PlatformAdminService.addSupportNote({ orgId, body: noteBody.trim(), noteType });
      toast.success('Support note added');
      setNoteOpen(false);
      setNoteBody('');
      await load();
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : 'The note was refused.');
    } finally {
      setNoteBusy(false);
    }
  }

  async function startImpersonation() {
    try {
      await PlatformAdminService.startImpersonation(orgId, `Reviewing ${name} from the platform console`, 15);
      toast.success('Read-only support session started');
      setImpersonateOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not start the session');
    }
  }

  if (!allowed) {
    return (
      <>
        <PlatformPageHead area={AREA} current="Business" />
        <PermissionDenied what="this business" permission="platform:manage_businesses" />
      </>
    );
  }

  if (loading && !detail) return <PageLoader />;

  if (error) {
    return (
      <>
        <PlatformPageHead area={AREA} parent={{ label: AREA.label, to: '/platform/businesses' }} current="Business" />
        <StateBlock
          variant="error"
          title="Could not load this business"
          body={error}
          actions={
            <>
              <Button variant="outline" onClick={load}>Try again</Button>
              <Button variant="ghost" onClick={() => navigate('/platform/businesses')}>
                Back to directory
              </Button>
            </>
          }
        />
      </>
    );
  }

  const seatUsed = detail?.seatUsed ?? 0;
  const seatLimit = num(primary, 'agreed_user_limit');
  const seatsAtLimit = seatLimit !== null && seatLimit > 0 && seatUsed >= seatLimit;

  const identityRows: DefRow[] = [
    { term: 'Business name', value: name },
    { term: 'Slug', value: <span className="mono">{str(organization, 'slug') ?? '—'}</span> },
    { term: 'Business type', value: categoryLabel(str(organization, 'business_category')) },
    { term: 'Owner', value: str(organization, 'owner_email') ?? 'Not recorded' },
    { term: 'Billing email', value: str(organization, 'billing_email') ?? 'Not set' },
    { term: 'Billing status', value: <StatusBadge status={str(organization, 'billing_status')} /> },
    { term: 'Timezone', value: str(organization, 'timezone') ?? 'Not set' },
    { term: 'Created', value: `${formatDate(str(organization, 'created_at'))} (${formatRelative(str(organization, 'created_at'))})` },
    { term: 'Sandbox', value: bool(organization, 'is_sandbox') ? <Badge tone="workspace">sandbox</Badge> : 'No' },
  ];

  const subscriptionRows: DefRow[] = primary
    ? [
        { term: 'Product', value: str(primary, 'product_name') ?? str(primary, 'product_key') ?? '—' },
        { term: 'Plan', value: str(primary, 'plan_name') ?? 'No plan assigned' },
        { term: 'Access status', value: <StatusBadge status={str(primary, 'status')} /> },
        { term: 'Source', value: <StatusBadge status={str(primary, 'source')} /> },
        {
          term: 'Agreed monthly price',
          value: num(primary, 'agreed_monthly_price') === null ? 'Not agreed' : formatMoney(num(primary, 'agreed_monthly_price')),
          muted: num(primary, 'agreed_monthly_price') === null,
        },
        {
          term: 'Agreed annual price',
          value: num(primary, 'agreed_annual_price') === null ? 'Not agreed' : formatMoney(num(primary, 'agreed_annual_price')),
          muted: num(primary, 'agreed_annual_price') === null,
        },
        {
          term: 'Seat allowance',
          value: `${formatSeatLimit(seatLimit)} · ${formatNumber(seatUsed)} in use`,
        },
        {
          term: 'Expires',
          value: str(primary, 'expires_at')
            ? `${formatDate(str(primary, 'expires_at'))} (${formatRelative(str(primary, 'expires_at'))})`
            : 'No expiry set',
          muted: !str(primary, 'expires_at'),
        },
        {
          term: 'Trial ends',
          value: str(primary, 'trial_ends_at') ? formatDate(str(primary, 'trial_ends_at')) : 'Not on trial',
          muted: !str(primary, 'trial_ends_at'),
        },
        {
          term: 'Activated',
          value: str(primary, 'activated_at') ? formatDateTime(str(primary, 'activated_at')) : 'Never activated',
          muted: !str(primary, 'activated_at'),
        },
      ]
    : [];

  const staffColumns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'email',
      header: 'Staff',
      label: '',
      render: (row) => (
        <div>
          <span className="data-table-primary">{str(row, 'email') ?? str(row, 'user_email') ?? 'Unknown'}</span>
          <p className="data-table-secondary">{str(row, 'role') ?? 'No role'}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={str(row, 'status')} /> },
    {
      key: 'joined',
      header: 'Joined',
      render: (row) => formatDate(str(row, 'joined_at') ?? str(row, 'created_at')),
    },
  ];

  const paymentColumns: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      render: (row) => formatMoney(num(row, 'amount')),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={str(row, 'status')} /> },
    { key: 'reference', header: 'Reference', render: (row) => <span className="mono">{str(row, 'reference') ?? '—'}</span> },
    { key: 'created', header: 'Recorded', render: (row) => formatDateTime(str(row, 'created_at')) },
  ];

  const noteEntries: TimelineEntry[] = (detail?.supportNotes ?? []).map((note, index) => ({
    id: str(note, 'id') ?? `note-${index}`,
    title: str(note, 'admin_email') ?? 'Support',
    meta: `${(str(note, 'note_type') ?? 'note').replace(/_/g, ' ')} · ${formatDateTime(str(note, 'created_at'))}`,
    text: str(note, 'body') ?? '',
  }));

  const adjustmentEntries: TimelineEntry[] = (detail?.adjustments ?? []).map((adjustment, index) => ({
    id: str(adjustment, 'id') ?? `adjustment-${index}`,
    title: (str(adjustment, 'adjustment_type') ?? 'change').replace(/_/g, ' '),
    meta: `${str(adjustment, 'performed_by_email') ?? 'Platform'} · ${formatDateTime(str(adjustment, 'created_at'))}`,
    text: str(adjustment, 'reason') ?? '',
    tone: str(adjustment, 'adjustment_type') === 'cancel' || str(adjustment, 'adjustment_type') === 'suspend' ? 'danger' : 'accent',
  }));

  return (
    <>
      <PlatformPageHead
        area={AREA}
        parent={{ label: AREA.label, to: '/platform/businesses' }}
        current={name}
        description={str(organization, 'description') ?? undefined}
        actions={
          <>
            <RefreshButton onClick={load} loading={loading} />
            {can('platform:impersonate') && (
              <Button variant="outline" onClick={() => setImpersonateOpen(true)}>
                Read-only session
              </Button>
            )}
          </>
        }
      />

      {/* No create/edit/suspend endpoint exists, so the consequential actions an
          operator would expect here cannot be offered. Saying so is the honest
          alternative to a disabled button with no explanation. */}
      <AreaCoverage
        title="Actions this page cannot offer yet"
        gaps={[
          'No endpoint exists to edit a business, transfer ownership, suspend or reinstate it, or delete it.',
          'Platform staff management — adding, removing or re-roling members — is not implemented server-side.',
          'Suspension is therefore only reachable through a subscription change, which affects access but leaves the recorded billing status untouched.',
        ]}
      />

      <section className="card">
        <SectionHead
          title="Business"
          sub="Identity and billing"
          actions={
            can('platform:manage_payments') && (
              <Button variant="outline" className="btn-sm" onClick={() => setAdjustOpen(true)}>
                Change subscription
              </Button>
            )
          }
        />
        <DefList rows={identityRows} />
      </section>

      <section className="card">
        <SectionHead
          title="Access & entitlement"
          sub="What grants access. The seat limit is enforced against it."
        />
        {subscriptionRows.length > 0 ? (
          <>
            <DefList rows={subscriptionRows} />
            {seatsAtLimit && (
              <div className="callout callout-warning">
                <div>
                  <p className="callout-title">Seat allowance is full</p>
                  <p className="callout-text">
                    {formatNumber(seatUsed)} of {formatSeatLimit(seatLimit)} in use. Adding staff will be refused.
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <StateBlock
            variant="empty"
            title="No access recorded"
            body="Record a manual activation to grant access."
          />
        )}

        {entitlements.length > 1 && (
          <div>
            <SectionHead title="Other products" />
            <DataTable
              columns={[
                { key: 'product', header: 'Product', render: (row) => str(row, 'product_name') ?? '—' },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={str(row, 'status')} /> },
                { key: 'plan', header: 'Plan', render: (row) => str(row, 'plan_name') ?? '—' },
                { key: 'expires', header: 'Expires', render: (row) => formatDate(str(row, 'expires_at')) },
              ]}
              rows={entitlements.slice(1)}
              rowKey={(row, index) => str(row, 'id') ?? `entitlement-${index}`}
              stacked
              caption="Additional product entitlements"
            />
          </div>
        )}
      </section>

      <section className="card">
        <SectionHead title="Stores" />
        <DataTable
          columns={[
            { key: 'name', header: 'Store', label: '', render: (row) => str(row, 'name') ?? 'Unnamed store' },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={str(row, 'status')} /> },
            { key: 'created', header: 'Created', render: (row) => formatDate(str(row, 'created_at')) },
          ]}
          rows={detail?.stores ?? []}
          rowKey={(row, index) => str(row, 'id') ?? `store-${index}`}
          stacked
          caption="Stores"
          empty={<p className="data-table-secondary">No stores recorded for this business.</p>}
        />
      </section>

      <section className="card">
        <SectionHead
          title={`Staff (${formatNumber(seatUsed)} seats used)`}
          sub="Across this business's stores"
        />
        <DataTable
          columns={staffColumns}
          rows={detail?.staff ?? []}
          rowKey={(row, index) => str(row, 'user_id') ?? str(row, 'id') ?? `staff-${index}`}
          stacked
          caption="Staff accounts"
          empty={<p className="data-table-secondary">No staff records. The business owner is not listed as staff.</p>}
        />
      </section>

      <section className="card">
        <SectionHead title="Payments" sub="Most recent first" />
        <DataTable
          columns={paymentColumns}
          rows={detail?.payments ?? []}
          rowKey={(row, index) => str(row, 'id') ?? `payment-${index}`}
          stacked
          caption="Subscription payments"
          empty={<p className="data-table-secondary">No payments recorded.</p>}
        />
      </section>

      <section className="card">
        <SectionHead
          title="Support history"
          sub="Append-only. A correction is another note."
          actions={
            can('platform:support') && (
              <Button variant="outline" className="btn-sm" onClick={() => setNoteOpen(true)}>
                Add note
              </Button>
            )
          }
        />
        <Timeline items={noteEntries} />
      </section>

      <section className="card">
        <SectionHead
          title="Subscription changes"
          sub="Manual changes, with the reason given"
          actions={
            can('platform:manage_payments') && (
              <Button variant="ghost" className="btn-sm" onClick={() => setAdjustOpen(true)}>
                Record a change
              </Button>
            )
          }
        />
        <Timeline items={adjustmentEntries} />
      </section>

      {/* ── Change subscription ─────────────────────────────────── */}
      <Dialog
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Change this subscription"
        description="Recorded against your account with the reason you give."
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjustBusy}>
              Cancel
            </Button>
            <Button loading={adjustBusy} onClick={submitAdjustment}>
              Record change
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label" htmlFor="adjust-type">Change</label>
          <select
            id="adjust-type"
            className="select-input"
            value={adjustType}
            onChange={(event) => setAdjustType(event.target.value)}
            disabled={adjustBusy}
          >
            <option value="extend_expiry">Extend access (renewal)</option>
            <option value="shorten_expiry">Shorten access</option>
            <option value="suspend">Suspend access</option>
            <option value="reinstate">Reinstate access</option>
            <option value="cancel">Cancel subscription</option>
            <option value="reactivate">Reactivate expired subscription</option>
            <option value="seat_change">Change seat allowance</option>
            <option value="manual_price">Record a manual price</option>
          </select>
        </div>

        {(adjustType === 'extend_expiry' ||
          adjustType === 'shorten_expiry' ||
          adjustType === 'reactivate' ||
          adjustType === 'manual_activation') && (
          <FormField
            id="adjust-expiry"
            label="New expiry date"
            type="date"
            value={adjustExpiry}
            onChange={setAdjustExpiry}
            hint="The server requires a later date than the current expiry when reactivating."
            disabled={adjustBusy}
          />
        )}

        {(adjustType === 'seat_change' || adjustType === 'manual_price') && (
          <FormField
            id="adjust-seats"
            label="Seat allowance"
            value={adjustSeats}
            onChange={setAdjustSeats}
            placeholder="Enter -1 for unlimited, or a positive number"
            hint="Use -1 for unlimited. The seat trigger enforces this against staff additions."
            disabled={adjustBusy}
          />
        )}

        <FormField
          id="adjust-reason"
          label="Reason (required)"
          value={adjustReason}
          onChange={setAdjustReason}
          placeholder="Why is this changing?"
          error={adjustError ?? undefined}
          disabled={adjustBusy}
        />

        <div className="callout callout-info">
          <div>
            <p className="callout-text">
              Changes the <strong>entitlement</strong>. Leaves billing status and the agreed price alone.
            </p>
          </div>
        </div>
      </Dialog>

      {/* ── Support note ────────────────────────────────────────── */}
      <Dialog
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add a support note"
        description="Visible to platform staff only."
        footer={
          <>
            <Button variant="outline" onClick={() => setNoteOpen(false)} disabled={noteBusy}>
              Cancel
            </Button>
            <Button loading={noteBusy} onClick={submitNote}>
              Save note
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label" htmlFor="note-type">Note type</label>
          <select
            id="note-type"
            className="select-input"
            value={noteType}
            onChange={(event) => setNoteType(event.target.value)}
            disabled={noteBusy}
          >
            <option value="note">General note</option>
            <option value="contact">Customer contact</option>
            <option value="support_action">Support action</option>
            <option value="suspension">Suspension</option>
            <option value="reinstatement">Reinstatement</option>
            <option value="pricing_change">Pricing change</option>
            <option value="manual_activation">Manual activation</option>
            <option value="developer_test">Developer test</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="note-body">Note</label>
          <textarea
            id="note-body"
            className="form-input"
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            disabled={noteBusy}
            aria-invalid={noteError ? true : undefined}
          />
          {noteError && <p className="form-error" role="alert">{noteError}</p>}
        </div>
      </Dialog>

      {/* ── Impersonation ───────────────────────────────────────── */}
      <ConfirmDialog
        open={impersonateOpen}
        onClose={() => setImpersonateOpen(false)}
        onConfirm={startImpersonation}
        title="Start a read-only session"
        confirmLabel="Start session"
        requireReason={false}
        consequence={
          <>
            You will see this business exactly as its owner does for 15 minutes. Read-only impersonation is currently a
            convention rather than a server guarantee: the guard trigger that should block writes during a session is
            attached to no table. Do not rely on it to prevent changes while you are inside.
          </>
        }
      />
    </>
  );
}
