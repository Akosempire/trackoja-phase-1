import { updateListFilter } from '../../../utils/list-filters';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PlatformAdminService,
  type PlatformAuditLog,
  type PlatformUserRow,
  type ProductBusiness,
} from '../../../services/platformAdmin.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import {
  AreaCoverage,
  PermissionDenied,
  PlatformPageHead,
  RefreshButton,
} from '../../../components/platform/PlatformPageHead';
import { EnvironmentBadge } from '../../../components/platform/EnvironmentBadge';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList, type DefRow } from '../../../components/ui/DefList';
import { Disclosure } from '../../../components/ui/Disclosure';
import { Dialog } from '../../../components/ui/Dialog';
import { Pagination } from '../../../components/ui/Pagination';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { formatDateTime, formatRelative, humaniseToken } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'audit')!;

const PAGE_SIZE = 25;

/** The status values audit_logs allows, from its CHECK constraint. */
const AUDIT_STATUSES = ['success', 'failed', 'attempted'] as const;

/**
 * Resource types audit_logs actually carries today.
 *
 * The endpoint matches resource_type exactly rather than as a substring, so a
 * free-text box here would mostly produce empty pages; these are the values the
 * platform functions write, read out of 069, 072 and 089.
 */
const RESOURCE_TYPES = [
  'platform_product',
  'product_plan',
  'platform_admin',
  'user',
  'organization',
  'activation_key',
  'support_note',
  'subscription_adjustment',
  'platform_setting',
  'notification_template',
] as const;

/**
 * Which platform actions are recorded, and which are not.
 *
 * Taken from the create_audit_log() call sites rather than from the brief: the
 * products, plans and permission functions write their rows directly in
 * 20260926000069_platform_products_functions.sql, the developer functions in
 * 20260926000072_platform_developer_mode_functions.sql, and the activation,
 * support, settings and template functions in
 * 20260927000089_platform_owner_hardening.sql. The list is behind a disclosure:
 * what an operator acts on is the gap below it, not the inventory.
 */
const AUDITED_ACTIONS = [
  'PRODUCT_SAVED — a product row was created or edited (upsert_platform_product)',
  'PLAN_CREATED, PLAN_UPDATED — a plan or price changed (upsert_product_plan)',
  'PLATFORM_PERMISSION_GRANTED, PLATFORM_PERMISSION_REVOKED — an admin’s permission changed (set_platform_admin_permission)',
  'DEVELOPER_MODE_GRANTED, DEVELOPER_MODE_REVOKED — developer access was given or withdrawn (grant_developer_mode, revoke_developer_mode)',
  'SANDBOX_BUSINESS_CREATED — a sandbox organisation was created (create_sandbox_business)',
  'IMPERSONATION_STARTED, IMPERSONATION_ENDED — a support session was opened or closed (start_impersonation, end_impersonation)',
  'ACTIVATION_KEY_ISSUED, ACTIVATION_KEY_REVOKED — migration 089; the key code is stored masked to its last four characters',
  'SUPPORT_NOTE_ADDED — migration 089; the note body is deliberately not copied into the audit row',
  'SUBSCRIPTION_ADJUSTED — migration 089, with the subscription snapshotted before the change',
  'PLATFORM_SETTING_UPDATED — migration 089, and the only place a setting’s previous value survives',
  'NOTIFICATION_TEMPLATE_SAVED — migration 089; the template body and subject are excluded',
];

const UNAUDITED_ACTIONS = [
  'Permission denials leave no record at all: require_platform_permission() raises and writes nothing.',
  'Nothing records reads, so this is a change log rather than an access log.',
  'Actions with no endpoint cannot be audited: business create, edit, suspend or delete, user suspension, and the integrations and feature-flag areas.',
  'Developer session start and end are not their own events — they are journalled in developer_sessions, which has no read endpoint here.',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when the failure looks like the endpoint itself is missing.
 *
 * The browser talks to PostgREST, which answers an unknown function with a schema
 * cache error rather than a permission error, and that is the one failure the
 * operator can actually act on: the hardening migration has not been applied.
 */
function looksUndeployed(message: string): boolean {
  return /schema cache|could not find the function|does not exist|404/i.test(message);
}

export default function AuditArea() {
  const { can, environment } = usePlatform();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters live in the URL so a failed-payment tile or a bookmark can open the
  // exact view, and so an operator can hand someone else what they are looking at.
  const actorId = searchParams.get('actor') ?? '';
  const orgId = searchParams.get('org') ?? '';
  const action = searchParams.get('action') ?? '';
  const resourceType = searchParams.get('resourceType') ?? '';
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [actionDraft, setActionDraft] = useState(action);
  const [actorDraft, setActorDraft] = useState('');
  const [orgDraft, setOrgDraft] = useState('');
  const [fromDraft, setFromDraft] = useState(from);
  const [toDraft, setToDraft] = useState(to);

  const [actorLabel, setActorLabel] = useState<string | null>(null);
  const [orgLabel, setOrgLabel] = useState<string | null>(null);
  const [actorMatches, setActorMatches] = useState<PlatformUserRow[]>([]);
  const [orgMatches, setOrgMatches] = useState<ProductBusiness[]>([]);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const [entries, setEntries] = useState<PlatformAuditLog[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformAuditLog | null>(null);

  // The endpoint accepts either permission: platform:support is the documented
  // fallback inside list_platform_audit_logs() itself.
  const allowed = can('platform:view_audit') || can('platform:support');
  const canResolveUsers = can('platform:manage_users');
  const canResolveBusinesses = can('platform:manage_businesses');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const result = await PlatformAdminService.listAuditLogs({
        actorId: actorId || undefined,
        orgId: orgId || undefined,
        action: action || undefined,
        resourceType: resourceType || undefined,
        status: status || undefined,
        // A date input gives a calendar day, and the endpoint compares timestamps,
        // so the range is widened to the whole day rather than silently dropping it.
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (cause) {
      setEntries([]);
      setTotal(null);
      setError(cause instanceof Error ? cause.message : 'Could not load the audit trail.');
    } finally {
      setLoading(false);
    }
  }, [allowed, actorId, orgId, action, resourceType, status, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function setFilter(key: string, value: string) {
    const next = updateListFilter(searchParams, key, value);
    setSearchParams(next, { replace: true });
  }

  /**
   * Resolves the actor box to a user id.
   *
   * list_platform_audit_logs filters on actor_id — a UUID — so an email has to be
   * resolved first, and the only endpoint that can do it requires
   * platform:manage_users. When that permission is absent the operator is told to
   * paste the id instead of being left with a field that quietly does nothing.
   */
  async function resolveActor(raw: string): Promise<string | null> {
    const value = raw.trim();
    if (!value) return null;
    if (UUID_PATTERN.test(value)) {
      setActorLabel(null);
      return value;
    }
    if (!canResolveUsers) {
      throw new Error(
        'Filtering by actor needs an id, and resolving an email needs platform:manage_users. Paste the user id instead.',
      );
    }
    const matches = await PlatformAdminService.listUsers({ search: value, limit: 6 });
    const exact = matches.filter((row) => row.email.toLowerCase() === value.toLowerCase());
    if (exact.length === 1) {
      setActorMatches([]);
      setActorLabel(exact[0].email);
      return exact[0].userId;
    }
    if (matches.length === 1) {
      setActorMatches([]);
      setActorLabel(matches[0].email);
      return matches[0].userId;
    }
    if (matches.length === 0) {
      setActorMatches([]);
      throw new Error(`No user matched "${value}".`);
    }
    setActorMatches(matches);
    throw new Error(`${matches.length} users matched "${value}". Pick one below, or paste the user id.`);
  }

  /** Same problem as the actor: the endpoint filters on org_id. */
  async function resolveBusiness(raw: string): Promise<string | null> {
    const value = raw.trim();
    if (!value) return null;
    if (UUID_PATTERN.test(value)) {
      setOrgLabel(null);
      return value;
    }
    if (!canResolveBusinesses) {
      throw new Error(
        'Filtering by business needs an id, and resolving a name needs platform:manage_businesses. Paste the organisation id instead.',
      );
    }
    const matches = await PlatformAdminService.listBusinesses({ search: value, limit: 6 });
    if (matches.length === 1) {
      setOrgMatches([]);
      setOrgLabel(matches[0].name);
      return matches[0].orgId;
    }
    if (matches.length === 0) {
      setOrgMatches([]);
      throw new Error(`No business matched "${value}".`);
    }
    setOrgMatches(matches);
    throw new Error(`${matches.length} businesses matched "${value}". Pick one below, or paste the organisation id.`);
  }

  async function applyFilters() {
    setResolving(true);
    setResolveError(null);
    try {
      const nextActorId = actorDraft.trim() ? await resolveActor(actorDraft) : actorId;
      const nextOrgId = orgDraft.trim() ? await resolveBusiness(orgDraft) : orgId;

      const next = new URLSearchParams(searchParams);
      if (nextActorId) next.set('actor', nextActorId);
      else next.delete('actor');
      if (nextOrgId) next.set('org', nextOrgId);
      else next.delete('org');
      next.delete('page');
      setSearchParams(next, { replace: true });
    } catch (cause) {
      setResolveError(cause instanceof Error ? cause.message : 'That filter could not be applied.');
    } finally {
      setResolving(false);
    }
  }

  function clearFilters() {
    setActionDraft('');
    setActorDraft('');
    setOrgDraft('');
    setFromDraft('');
    setToDraft('');
    setActorLabel(null);
    setOrgLabel(null);
    setActorMatches([]);
    setOrgMatches([]);
    setResolveError(null);
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  const columns = useMemo<DataTableColumn<PlatformAuditLog>[]>(
    () => [
      {
        key: 'time',
        header: 'Time',
        nowrap: true,
        sortValue: (row) => row.createdAt,
        render: (row) => (
          <div>
            <span className="data-table-primary">{formatDateTime(row.createdAt)}</span>
            <p className="data-table-secondary">{formatRelative(row.createdAt)}</p>
          </div>
        ),
      },
      {
        key: 'actor',
        header: 'Actor',
        sortValue: (row) => row.actorEmail ?? '',
        render: (row) =>
          row.actorEmail ?? <span className="data-table-secondary">Not recorded</span>,
      },
      {
        key: 'action',
        header: 'Action',
        label: '',
        sortValue: (row) => row.action,
        render: (row) => (
          <div>
            <span className="data-table-primary">{humaniseToken(row.action)}</span>
            <p className="data-table-secondary mono">{row.action}</p>
          </div>
        ),
      },
      {
        key: 'resource',
        header: 'Resource',
        sortValue: (row) => row.resourceType,
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.resourceName ?? humaniseToken(row.resourceType)}</span>
            <p className="data-table-secondary">
              {humaniseToken(row.resourceType)}
              {row.resourceId ? ` · ${row.resourceId}` : ''}
            </p>
          </div>
        ),
      },
      {
        key: 'business',
        header: 'Business',
        sortValue: (row) => row.orgName ?? '',
        render: (row) => row.orgName ?? <span className="data-table-secondary">Platform-wide</span>,
      },
      {
        key: 'status',
        header: 'Status',
        sortValue: (row) => row.status ?? '',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'environment',
        header: 'Environment (this session)',
        nowrap: true,
        render: () => <EnvironmentBadge environment={environment} />,
      },
      {
        key: 'detail',
        header: 'Values',
        nowrap: true,
        render: (row) => (
          <Button variant="ghost" className="btn-sm" onClick={() => setDetail(row)}>
            {row.changes || row.details ? 'Inspect' : 'Nothing recorded'}
          </Button>
        ),
      },
    ],
    [environment],
  );

  if (!allowed) {
    return (
      <>
        <PlatformPageHead area={AREA} />
        <PermissionDenied what="the audit trail" permission="platform:view_audit" />
      </>
    );
  }

  const filtersActive = Boolean(actorId || orgId || action || resourceType || status || from || to);

  const detailRows: DefRow[] = detail
    ? [
        { term: 'When', value: `${formatDateTime(detail.createdAt)} (${formatRelative(detail.createdAt)})` },
        {
          term: 'Actor',
          value: detail.actorEmail ?? 'Not recorded',
          muted: !detail.actorEmail,
        },
        { term: 'Action', value: <span className="mono">{detail.action}</span> },
        { term: 'Resource type', value: detail.resourceType },
        { term: 'Resource name', value: detail.resourceName ?? '—', muted: !detail.resourceName },
        {
          term: 'Resource id',
          value: detail.resourceId ? <span className="mono">{detail.resourceId}</span> : '—',
          muted: !detail.resourceId,
        },
        {
          term: 'Business',
          value: detail.orgName ?? 'Platform-wide (no organisation on this row)',
          muted: !detail.orgName,
        },
        { term: 'Recorded status', value: <StatusBadge status={detail.status} /> },
        { term: 'Environment', value: <EnvironmentBadge environment={environment} /> },
      ]
    : [];

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description={`Search changes by actor, action, business and date.`}
        actions={<RefreshButton onClick={load} loading={loading} />}
      />

      <AreaCoverage gaps={AREA.gaps} title="What this trail does not cover" />

      {/* ── What the environment column means ───────────────────────── */}
      <div className="callout callout-warning" role="status">
        <div>
          <p className="callout-title">The environment column is this session, not the action</p>
          <p className="callout-text">
            <span className="mono">audit_logs</span> has no environment column, so every row carries the environment you
            are reading from — it is not evidence of where a change was made.
          </p>
          <Disclosure summary="Where that is verified">
            <p>
              Verified in <span className="mono">supabase/migrations/20260612000005_audit_logging_schema.sql</span>, and no
              later migration adds one. The value is resolved now by the platform context, so a row written by another
              deployment of this database carries this session&rsquo;s label.
            </p>
          </Disclosure>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="audit-filters">
        <SectionHead
          id="audit-filters"
          title="Filter the trail"
          sub="Dates cover whole days in this browser’s timezone."
        />

        <form
          className="plat-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void applyFilters();
          }}
        >
          <div className="plat-field plat-field-grow">
            <label className="form-label" htmlFor="audit-actor">
              Actor (email or user id)
            </label>
            <input
              id="audit-actor"
              className="form-input"
              value={actorDraft}
              placeholder={actorId ? `filtering on ${actorLabel ?? actorId}` : 'name@example.com'}
              onChange={(event) => setActorDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="plat-field plat-field-grow">
            <label className="form-label" htmlFor="audit-business">
              Business (name or org id)
            </label>
            <input
              id="audit-business"
              className="form-input"
              value={orgDraft}
              placeholder={orgId ? `filtering on ${orgLabel ?? orgId}` : 'Business name'}
              onChange={(event) => setOrgDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="audit-action">
              Action contains
            </label>
            <input
              id="audit-action"
              className="form-input"
              value={actionDraft}
              placeholder="developer"
              onChange={(event) => setActionDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="audit-resource">
              Resource type
            </label>
            <select
              id="audit-resource"
              className="select-input"
              value={resourceType}
              onChange={(event) => setFilter('resourceType', event.target.value)}
              disabled={resolving}
            >
              <option value="">Any resource type</option>
              {RESOURCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="audit-status">
              Status
            </label>
            <select
              id="audit-status"
              className="select-input"
              value={status}
              onChange={(event) => setFilter('status', event.target.value)}
              disabled={resolving}
            >
              <option value="">Any status</option>
              {AUDIT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="audit-from">
              From
            </label>
            <input
              id="audit-from"
              className="form-input"
              type="date"
              value={fromDraft}
              onChange={(event) => setFromDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="audit-to">
              To
            </label>
            <input
              id="audit-to"
              className="form-input"
              type="date"
              value={toDraft}
              onChange={(event) => setToDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <Button type="submit" variant="neutral" className="btn-sm" loading={resolving}>
            Apply filters
          </Button>

          {filtersActive && (
            <Button type="button" variant="ghost" className="btn-sm" onClick={clearFilters} disabled={resolving}>
              Clear filters
            </Button>
          )}
        </form>

        {/* Two filters are ids on the wire, so the resolution step is explicit
            rather than implied by a field that looks like free text. */}
        {(actorId || orgId) && (
          <p className="form-hint">
            Matched by id. Filtering on
            {actorId ? ` actor ${actorLabel ?? actorId}` : ''}
            {actorId && orgId ? ' and' : ''}
            {orgId ? ` business ${orgLabel ?? orgId}` : ''}.
          </p>
        )}

        {!canResolveUsers && (
          <p className="form-hint">
            An actor email cannot be resolved without platform:manage_users. Paste the user id instead.
          </p>
        )}

        {!canResolveBusinesses && (
          <p className="form-hint">
            A business name cannot be resolved without platform:manage_businesses. Paste the organisation id instead.
          </p>
        )}

        {resolveError && (
          <p className="form-error" role="alert">
            {resolveError}
          </p>
        )}

        {actorMatches.length > 0 && (
          <div className="chip-row">
            {actorMatches.map((match) => (
              <button
                key={match.userId}
                type="button"
                className="chip"
                onClick={() => {
                  setActorLabel(match.email);
                  setActorMatches([]);
                  setActorDraft('');
                  setFilter('actor', match.userId);
                }}
              >
                {match.email}
              </button>
            ))}
          </div>
        )}

        {orgMatches.length > 0 && (
          <div className="chip-row">
            {orgMatches.map((match) => (
              <button
                key={match.orgId}
                type="button"
                className="chip"
                onClick={() => {
                  setOrgLabel(match.name);
                  setOrgMatches([]);
                  setOrgDraft('');
                  setFilter('org', match.orgId);
                }}
              >
                {match.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── The table ───────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="audit-table">
        <SectionHead
          id="audit-table"
          title="Audit entries"
          sub="Newest first. The page count covers the whole filtered set."
        />

        {error ? (
          <>
            <StateBlock
              variant="error"
              title="Could not load the audit trail"
              body={error}
              actions={
                <Button variant="outline" className="btn-sm" onClick={load}>
                  Try again
                </Button>
              }
            />
            {looksUndeployed(error) && (
              <StateBlock
                variant="unavailable"
                title="This looks like the audit browser is not deployed yet"
                body="list_platform_audit_logs comes from migration 20260927000089_platform_owner_hardening.sql. Until it is applied the function does not exist, and nothing is shown in its place rather than a fabricated page."
              />
            )}
          </>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={entries}
              rowKey={(row) => row.id}
              caption="Platform audit log"
              stacked
              loading={loading}
              empty={
                <StateBlock
                  variant="empty"
                  title={filtersActive ? 'No audit entries match these filters' : 'No audit entries'}
                  body={
                    filtersActive
                      ? 'Widen the range or clear a filter. Only the actions listed below write a row.'
                      : 'Nothing has been audited yet. Only the actions listed below write a row.'
                  }
                />
              }
            />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              noun="entries"
              onPageChange={(next) => setFilter('page', String(next))}
            />
          </>
        )}

        <p className="section-sub">
          An actor of &ldquo;Not recorded&rdquo; means the row has no actor id: a server-side action, or an account since
          deleted.
        </p>
      </section>

      {/* ── Coverage ────────────────────────────────────────────────── */}
      <Disclosure summary="What is and is not recorded"><section className="card" aria-labelledby="audit-coverage">
        <SectionHead id="audit-coverage" title="What is and is not recorded" />

        <p className="section-sub">
          Not recorded: permission denials, reads, actions with no endpoint, and developer session start and end.
        </p>

        <Disclosure summary="Which actions write a row">
          <h3 className="section-title">
            Recorded <Badge tone="success">audited</Badge>
          </h3>
          <ul className="list">
            {AUDITED_ACTIONS.map((item) => (
              <li className="list-item" key={item}>
                <p className="list-item-subtitle">{item}</p>
              </li>
            ))}
          </ul>

          <h3 className="section-title">
            Not recorded <Badge tone="outline">no audit row</Badge>
          </h3>
          <ul className="list">
            {UNAUDITED_ACTIONS.map((item) => (
              <li className="list-item" key={item}>
                <p className="list-item-subtitle">{item}</p>
              </li>
            ))}
          </ul>

          <p className="section-sub">
            Rows are read through a SECURITY DEFINER function on purpose: audit rows with no organisation — every
            platform-scoped event, which is the set this screen exists to show — are invisible to every row-level security
            policy. The same function redacts credential-looking keys from <span className="mono">changes</span> and{' '}
            <span className="mono">details</span>, and <span className="mono">create_audit_log()</span> is no longer
            executable by authenticated or anonymous callers after migration 089, so rows cannot be forged from a client.
          </p>
        </Disclosure>
      </section>
      </Disclosure>

      {/* ── Detail dialog ───────────────────────────────────────────── */}
      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        wide
        title={detail ? humaniseToken(detail.action) : 'Audit entry'}
        description="Recorded changes and context."
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && (
          <>
            <DefList rows={detailRows} />

            <div className="callout callout-info">
              <div>
                <p className="callout-title">Redaction happens in the database</p>
                <p className="callout-text">
                  Credential-shaped values become <span className="mono">***redacted***</span>, so withheld detail is not
                  absent detail and an empty payload does not prove nothing changed.
                </p>
                <Disclosure summary="Which keys are redacted">
                  <p>
                    Any value whose key looks like a credential —{' '}
                    <span className="mono">
                      secret, password, token, api_key, private_key, authorization, service_role
                    </span>{' '}
                    — is replaced, including inside nested objects.
                  </p>
                </Disclosure>
              </div>
            </div>

            <div>
              <h3 className="section-title">Changes (before and after)</h3>
              <p className="section-sub">
                Setting changes carry <span className="mono">{'{ previous, new }'}</span> here. Absent means the action
                recorded no before-and-after pair.
              </p>
              {detail.changes ? (
                <pre className="code-panel">{JSON.stringify(detail.changes, null, 2)}</pre>
              ) : (
                <StateBlock variant="unavailable" title="Not recorded" body="This entry has no changes payload." />
              )}
            </div>

            <div>
              <h3 className="section-title">Details</h3>
              {detail.details ? (
                <pre className="code-panel">{JSON.stringify(detail.details, null, 2)}</pre>
              ) : (
                <StateBlock variant="unavailable" title="Not recorded" body="This entry has no details payload." />
              )}
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
