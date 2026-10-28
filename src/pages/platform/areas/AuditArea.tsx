import { updateListFilter } from '../../../utils/list-filters';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { chipClass, tableBleed } from '../../../components/platform/ui';
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
            <span className="font-medium text-ink whitespace-nowrap">{formatDateTime(row.createdAt)}</span>
            <p className="m-0 text-xs text-ink-3 whitespace-nowrap">{formatRelative(row.createdAt)}</p>
          </div>
        ),
      },
      {
        key: 'actor',
        header: 'Actor',
        sortValue: (row) => row.actorEmail ?? '',
        render: (row) =>
          row.actorEmail ?? <span className="m-0 block text-xs text-ink-3 break-words">Not recorded</span>,
      },
      {
        key: 'action',
        header: 'Action',
        label: '',
        sortValue: (row) => row.action,
        render: (row) => (
          <div>
            <span className="font-medium text-ink break-words">{humaniseToken(row.action)}</span>
            <p className="m-0 font-mono text-xs text-ink-3 break-words">{row.action}</p>
          </div>
        ),
      },
      {
        key: 'resource',
        header: 'Resource',
        sortValue: (row) => row.resourceType,
        render: (row) => (
          <div>
            <span className="font-medium text-ink break-words">{row.resourceName ?? humaniseToken(row.resourceType)}</span>
            <p className="m-0 text-xs text-ink-3 break-words">
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
        render: (row) => row.orgName ?? <span className="m-0 block text-xs text-ink-3 break-words">Platform-wide</span>,
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
        { term: 'Action', value: <span className="font-mono text-[0.92em]">{detail.action}</span> },
        { term: 'Resource type', value: detail.resourceType },
        { term: 'Resource name', value: detail.resourceName ?? '—', muted: !detail.resourceName },
        {
          term: 'Resource id',
          value: detail.resourceId ? <span className="font-mono text-[0.92em]">{detail.resourceId}</span> : '—',
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
      <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border px-4 py-3 text-[13px] break-words border-warn/30 bg-warn-soft" role="status">
        <div>
          <p className="m-0 text-sm font-semibold text-ink">The environment column is this session, not the action</p>
          <p className="m-0 text-[13px] text-ink-2">
            <span className="font-mono text-[0.92em]">audit_logs</span> has no environment column, so every row carries the environment you
            are reading from — it is not evidence of where a change was made.
          </p>
          <Disclosure summary="Where that is verified">
            <p>
              Verified in <span className="font-mono text-[0.92em]">supabase/migrations/20260612000005_audit_logging_schema.sql</span>, and no
              later migration adds one. The value is resolved now by the platform context, so a row written by another
              deployment of this database carries this session&rsquo;s label.
            </p>
          </Disclosure>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <section className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card [&>*+*]:mt-4 [&>.section-head+*]:mt-0" aria-labelledby="audit-filters">
        <SectionHead
          id="audit-filters"
          title="Filter the trail"
          sub="Dates cover whole days in this browser’s timezone."
        />

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void applyFilters();
          }}
        >
          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="audit-actor">
              Actor (email or user id)
            </label>
            <input
              id="audit-actor"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
              value={actorDraft}
              placeholder={actorId ? `filtering on ${actorLabel ?? actorId}` : 'name@example.com'}
              onChange={(event) => setActorDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="audit-business">
              Business (name or org id)
            </label>
            <input
              id="audit-business"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
              value={orgDraft}
              placeholder={orgId ? `filtering on ${orgLabel ?? orgId}` : 'Business name'}
              onChange={(event) => setOrgDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="audit-action">
              Action contains
            </label>
            <input
              id="audit-action"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
              value={actionDraft}
              placeholder="developer"
              onChange={(event) => setActionDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="audit-resource">
              Resource type
            </label>
            <select
              id="audit-resource"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
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

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="audit-status">
              Status
            </label>
            <select
              id="audit-status"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
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

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="audit-from">
              From
            </label>
            <input
              id="audit-from"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
              type="date"
              value={fromDraft}
              onChange={(event) => setFromDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="audit-to">
              To
            </label>
            <input
              id="audit-to"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
              type="date"
              value={toDraft}
              onChange={(event) => setToDraft(event.target.value)}
              disabled={resolving}
            />
          </div>

          <Button type="submit" variant="neutral" loading={resolving}>
            Apply filters
          </Button>

          {filtersActive && (
            <Button type="button" variant="ghost" onClick={clearFilters} disabled={resolving}>
              Clear filters
            </Button>
          )}
        </form>

        {/* Two filters are ids on the wire, so the resolution step is explicit
            rather than implied by a field that looks like free text. */}
        {(actorId || orgId) && (
          <p className="m-0 text-xs text-ink-3">
            Matched by id. Filtering on
            {actorId ? ` actor ${actorLabel ?? actorId}` : ''}
            {actorId && orgId ? ' and' : ''}
            {orgId ? ` business ${orgLabel ?? orgId}` : ''}.
          </p>
        )}

        {!canResolveUsers && (
          <p className="m-0 text-xs text-ink-3">
            An actor email cannot be resolved without platform:manage_users. Paste the user id instead.
          </p>
        )}

        {!canResolveBusinesses && (
          <p className="m-0 text-xs text-ink-3">
            A business name cannot be resolved without platform:manage_businesses. Paste the organisation id instead.
          </p>
        )}

        {resolveError && (
          <p className="m-0 text-xs text-danger" role="alert">
            {resolveError}
          </p>
        )}

        {actorMatches.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actorMatches.map((match) => (
              <button
                key={match.userId}
                type="button"
                className={chipClass}
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
          <div className="flex flex-wrap gap-2">
            {orgMatches.map((match) => (
              <button
                key={match.orgId}
                type="button"
                className={chipClass}
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
      <section className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card [&>*+*]:mt-4 [&>.section-head+*]:mt-0" aria-labelledby="audit-table">
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
            <div className={tableBleed}>
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
            </div>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              noun="entries"
              onPageChange={(next) => setFilter('page', String(next))}
            />
          </>
        )}

        <p className="m-0 mt-0.5 text-[13px] text-ink-3">
          An actor of &ldquo;Not recorded&rdquo; means the row has no actor id: a server-side action, or an account since
          deleted.
        </p>
      </section>

      {/* ── Coverage ────────────────────────────────────────────────── */}
      <Disclosure summary="What is and is not recorded"><section className="min-w-0 [&>*+*]:mt-4 [&>.section-head+*]:mt-0" aria-labelledby="audit-coverage">
        <h2 id="audit-coverage" className="sr-only">What is and is not recorded</h2>

        <p className="m-0 mt-0.5 text-[13px] text-ink-3">
          Not recorded: permission denials, reads, actions with no endpoint, and developer session start and end.
        </p>

        <Disclosure summary="Which actions write a row">
          <h3 className="m-0 text-[15px] font-semibold text-ink">
            Recorded <Badge tone="success">audited</Badge>
          </h3>
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {AUDITED_ACTIONS.map((item) => (
              <li className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" key={item}>
                <p className="m-0 mt-0.5 text-xs text-ink-3 break-words">{item}</p>
              </li>
            ))}
          </ul>

          <h3 className="m-0 text-[15px] font-semibold text-ink">
            Not recorded <Badge tone="outline">no audit row</Badge>
          </h3>
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {UNAUDITED_ACTIONS.map((item) => (
              <li className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" key={item}>
                <p className="m-0 mt-0.5 text-xs text-ink-3 break-words">{item}</p>
              </li>
            ))}
          </ul>

          <p className="m-0 mt-0.5 text-[13px] text-ink-3">
            Rows are read through a SECURITY DEFINER function on purpose: audit rows with no organisation — every
            platform-scoped event, which is the set this screen exists to show — are invisible to every row-level security
            policy. The same function redacts credential-looking keys from <span className="font-mono text-[0.92em]">changes</span> and{' '}
            <span className="font-mono text-[0.92em]">details</span>, and <span className="font-mono text-[0.92em]">create_audit_log()</span> is no longer
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

            <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border px-4 py-3 text-[13px] break-words border-brand-line bg-brand-soft/60">
              <div>
                <p className="m-0 text-sm font-semibold text-ink">Redaction happens in the database</p>
                <p className="m-0 text-[13px] text-ink-2">
                  Credential-shaped values become <span className="font-mono text-[0.92em]">***redacted***</span>, so withheld detail is not
                  absent detail and an empty payload does not prove nothing changed.
                </p>
                <Disclosure summary="Which keys are redacted">
                  <p>
                    Any value whose key looks like a credential —{' '}
                    <span className="font-mono text-[0.92em]">
                      secret, password, token, api_key, private_key, authorization, service_role
                    </span>{' '}
                    — is replaced, including inside nested objects.
                  </p>
                </Disclosure>
              </div>
            </div>

            <div>
              <h3 className="m-0 text-[15px] font-semibold text-ink">Changes (before and after)</h3>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">
                Setting changes carry <span className="font-mono text-[0.92em]">{'{ previous, new }'}</span> here. Absent means the action
                recorded no before-and-after pair.
              </p>
              {detail.changes ? (
                <pre className="m-0 max-h-[360px] min-w-0 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-subtle p-3 font-mono text-xs leading-5 text-ink-2 break-words">{JSON.stringify(detail.changes, null, 2)}</pre>
              ) : (
                <StateBlock variant="unavailable" title="Not recorded" body="This entry has no changes payload." />
              )}
            </div>

            <div>
              <h3 className="m-0 text-[15px] font-semibold text-ink">Details</h3>
              {detail.details ? (
                <pre className="m-0 max-h-[360px] min-w-0 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-subtle p-3 font-mono text-xs leading-5 text-ink-2 break-words">{JSON.stringify(detail.details, null, 2)}</pre>
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
