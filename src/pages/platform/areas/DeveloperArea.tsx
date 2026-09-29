import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PlatformAdminService,
  type DeveloperGrant,
  type DeveloperStatus,
  type ImpersonationInfo,
  type PlatformUserRow,
  type ProductBusiness,
  type SandboxBusiness,
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
import { ConfirmDialog, Dialog } from '../../../components/ui/Dialog';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList, type DefRow } from '../../../components/ui/DefList';
import { Disclosure } from '../../../components/ui/Disclosure';
import { FormField } from '../../../components/ui/FormField';
import { SectionHead } from '../../../components/ui/SectionHead';
import { SectionState, StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useToast } from '../../../components/ui/Toast';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { ENVIRONMENT_SETTING_KEY, type PlatformEnvironmentName } from '../../../config/environment';
import { formatDateTime, formatNumber, formatRelative } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'developer')!;

/**
 * What each environment means for the work being done.
 *
 * Spelled out rather than reused from src/config/environment.ts, whose copy is
 * deliberately terse for the sidebar marker. The consequence is what matters
 * here, because the operator is about to run a test.
 */
const ENVIRONMENT_MEANING: Record<PlatformEnvironmentName, string> = {
  production: 'Live customer data. Sandboxes here share the database with paying customers.',
  staging: 'A rehearsal environment: figures read here are not customer-facing.',
  development: 'A development environment: nothing here is a customer record.',
  unknown: 'No environment declared: treat anything read here as unattributable.',
};

const SOURCE_LABEL: Record<string, string> = {
  setting: `The ${ENVIRONMENT_SETTING_KEY} platform setting`,
  build: 'This build (VITE_ENVIRONMENT, or the Vite build mode)',
  unknown: 'Nothing declared it',
};

/**
 * Capabilities this area cannot serve at all, because no backend exists for them.
 *
 * Kept in the UI rather than in a comment: an operator who cannot find webhook
 * replay will otherwise assume it is somewhere else in the dashboard.
 */
const NOT_BUILT: string[] = [
  'No webhook inspection or replay: nothing records a provider delivery.',
  'No background-job status: no job table exists.',
  'No error-log tail: audit rows only.',
  'No API key management: no key store exists.',
  'Feature flags are read-only, inside the diagnostics payload.',
  'No cross-admin impersonation history.',
  'No general-purpose SQL console, deliberately.',
];

interface DeveloperData {
  status: DeveloperStatus;
  sandboxes: SandboxBusiness[];
  impersonation: ImpersonationInfo | null;
  grants: DeveloperGrant[];
  businesses: ProductBusiness[];
}

/**
 * Reads every Developer source, keeping the ones that worked.
 *
 * The reads have different gates — the grant list is super-admin only, and the
 * business list needs platform:manage_businesses — so a source that is not
 * permitted is not requested at all, and one that fails is reported rather than
 * silently rendered as an empty panel.
 */
function useDeveloperData(options: { includeGrants: boolean; includeBusinesses: boolean }) {
  const [data, setData] = useState<Partial<DeveloperData>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const { includeGrants, includeBusinesses } = options;

  const load = useCallback(async () => {
    setLoading(true);

    const next: Partial<DeveloperData> = {};
    const failures: string[] = [];

    /*
     * Status is fetched first and on its own. Everything else in this area is
     * gated on developer mode, so calling the gated endpoints before knowing
     * whether it is active only produces refusals that have to be explained away,
     * log errors for a screen that is working correctly, and waste a round trip.
     */
    let developerMode = false;
    try {
      const status = await PlatformAdminService.getDeveloperStatus();
      next.status = status;
      developerMode = status.developerMode;
    } catch {
      failures.push('status');
    }

    const sources: Array<[keyof DeveloperData, Promise<unknown>]> = [
      ['impersonation', PlatformAdminService.getActiveImpersonation()],
    ];
    if (developerMode) sources.push(['sandboxes', PlatformAdminService.listSandboxBusinesses()]);
    if (includeGrants) sources.push(['grants', PlatformAdminService.listDeveloperGrants()]);
    if (includeBusinesses) sources.push(['businesses', PlatformAdminService.listBusinesses({ limit: 200 })]);

    const results = await Promise.allSettled(sources.map(([, promise]) => promise));

    results.forEach((result, index) => {
      const [key] = sources[index];
      if (result.status === 'fulfilled') {
        (next as Record<string, unknown>)[key] = result.value;
      } else {
        failures.push(key);
      }
    });

    setData(next);
    setFailed(failures);
    setLoading(false);
  }, [includeGrants, includeBusinesses]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, failed, loading, reload: load };
}

type ConfirmState =
  | { kind: 'grant' }
  | { kind: 'revoke'; grant: DeveloperGrant }
  | { kind: 'impersonate-start' }
  | null;

/** Seconds as the operator reads a countdown, never as a raw total. */
function formatCountdown(total: number): string {
  if (total <= 0) return '0s';
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default function DeveloperArea() {
  const toast = useToast();
  const { access, can, environment, settings } = usePlatform();

  // The area is developer-only in the sidebar, but a direct URL must not be a way
  // in: the server refuses every call regardless, and saying so reads better than
  // rendering controls whose only outcome is "Developer mode not granted".
  const isSuperAdmin = access?.isSuperAdmin ?? false;
  const allowed = isSuperAdmin || (access?.developerMode ?? false);

  const canListBusinesses = can('platform:manage_businesses');
  const { data, failed, loading, reload } = useDeveloperData({
    includeGrants: isSuperAdmin,
    includeBusinesses: canListBusinesses,
  });

  const status = data.status;
  const sandboxes = useMemo(() => data.sandboxes ?? [], [data.sandboxes]);
  const grants = useMemo(() => data.grants ?? [], [data.grants]);
  const businesses = useMemo(() => data.businesses ?? [], [data.businesses]);
  const impersonation = data.impersonation ?? null;

  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [grantTarget, setGrantTarget] = useState('');
  const [grantDays, setGrantDays] = useState('30');
  const [admins, setAdmins] = useState<PlatformUserRow[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);

  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandboxName, setSandboxName] = useState('');
  const [sandboxOwner, setSandboxOwner] = useState('');
  const [sandboxAcknowledged, setSandboxAcknowledged] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);

  const [diagnosticsOrgId, setDiagnosticsOrgId] = useState('');
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const [impersonateOrgId, setImpersonateOrgId] = useState('');
  const [impersonateMinutes, setImpersonateMinutes] = useState('15');

  const [secondsLeft, setSecondsLeft] = useState(0);
  const expiryHandled = useRef(false);

  /**
   * Candidate targets for a developer grant.
   *
   * grant_developer_mode() refuses a user who is not already an active platform
   * admin, so the picker offers platform admins only instead of letting the
   * operator choose somebody the server will reject.
   */
  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    PlatformAdminService.listUsers({ limit: 200 })
      .then((rows) => {
        if (!cancelled) setAdmins(rows.filter((row) => row.isPlatformAdmin));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setAdminError(cause instanceof Error ? cause.message : 'Could not list platform admins.');
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  // The countdown is local, but the decision that a session has ended is the
  // server's: when it reaches zero the session is re-read rather than assumed gone.
  useEffect(() => {
    expiryHandled.current = false;
    setSecondsLeft(impersonation?.secondsRemaining ?? 0);
  }, [impersonation?.sessionId, impersonation?.secondsRemaining]);

  useEffect(() => {
    if (!impersonation) return;
    const timer = window.setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [impersonation]);

  useEffect(() => {
    if (!impersonation || secondsLeft > 0 || expiryHandled.current) return;
    expiryHandled.current = true;
    void reload();
  }, [impersonation, secondsLeft, reload]);

  const environmentSetting = settings.find((setting) => setting.key === ENVIRONMENT_SETTING_KEY);

  /** Real businesses only: the server refuses impersonating a sandbox by design. */
  const impersonationTargets = useMemo(() => businesses.filter((row) => !row.isSandbox), [businesses]);

  async function startSession() {
    setBusy('session-start');
    setActionError(null);
    try {
      await PlatformAdminService.startDeveloperSession();
      toast.success('Developer session started');
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not start the developer session.');
    } finally {
      setBusy(null);
    }
  }

  async function endSession() {
    setBusy('session-end');
    setActionError(null);
    try {
      await PlatformAdminService.endDeveloperSession();
      toast.success('Developer session ended');
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not end the developer session.');
    } finally {
      setBusy(null);
    }
  }

  /** Runs whichever confirmation is open. ConfirmationDialog surfaces any throw. */
  async function runConfirmedAction(reason: string) {
    if (!confirm) return;
    setBusy(confirm.kind);
    setActionError(null);
    try {
      if (confirm.kind === 'grant') {
        if (reason.trim().length < 10) {
          // The server's own rule, applied before the round trip so the operator
          // is told the requirement instead of watching a silent refusal.
          throw new Error('The server requires a reason of at least 10 characters to grant developer mode.');
        }
        if (!grantTarget) throw new Error('Choose the platform admin who needs developer mode.');
        const days = Number(grantDays);
        if (!Number.isFinite(days) || days < 1 || days > 3650) {
          throw new Error('Developer mode validity must be between 1 and 3650 days.');
        }
        await PlatformAdminService.grantDeveloperMode(grantTarget, reason.trim(), days);
        toast.success('Developer mode granted');
      } else if (confirm.kind === 'revoke') {
        await PlatformAdminService.revokeDeveloperMode(confirm.grant.userId, reason.trim());
        toast.success('Developer mode revoked', { description: 'Any open developer session was ended.' });
      } else {
        if (reason.trim().length < 10) {
          throw new Error('The server requires a reason of at least 10 characters to start impersonation.');
        }
        if (!impersonateOrgId) throw new Error('Choose the business to view.');
        const minutes = Number(impersonateMinutes);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) {
          throw new Error('A support session lasts between 1 and 60 minutes.');
        }
        await PlatformAdminService.startImpersonation(impersonateOrgId, reason.trim(), minutes);
        toast.success('Read-only support session started', { description: 'Audited at both ends.' });
      }
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function endImpersonation() {
    setBusy('impersonate-end');
    setActionError(null);
    try {
      await PlatformAdminService.endImpersonation(impersonation?.sessionId);
      toast.success('Support session ended');
      await reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not end the support session.');
    } finally {
      setBusy(null);
    }
  }

  async function createSandbox() {
    setBusy('sandbox-create');
    setSandboxError(null);
    try {
      const created = await PlatformAdminService.createSandboxBusiness(
        sandboxName.trim(),
        sandboxOwner.trim() || undefined,
      );
      toast.success(`${created.name} created`, {
        description: `Organisation ${created.orgId} now exists permanently and holds one TrackOja entitlement.`,
      });
      setSandboxOpen(false);
      setSandboxName('');
      setSandboxOwner('');
      setSandboxAcknowledged(false);
      await reload();
    } catch (cause) {
      setSandboxError(cause instanceof Error ? cause.message : 'Could not create the sandbox business.');
    } finally {
      setBusy(null);
    }
  }

  async function loadDiagnostics() {
    if (!diagnosticsOrgId) return;
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      setDiagnostics(await PlatformAdminService.getDiagnostics(diagnosticsOrgId));
    } catch (cause) {
      setDiagnostics(null);
      setDiagnosticsError(cause instanceof Error ? cause.message : 'Could not load diagnostics.');
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  const grantColumns = useMemo<DataTableColumn<DeveloperGrant>[]>(
    () => [
      {
        key: 'admin',
        header: 'Platform admin',
        label: '',
        sortValue: (row) => row.email.toLowerCase(),
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.email}</span>
            <p className="data-table-secondary">{row.level.replace(/_/g, ' ')}</p>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Grant',
        sortValue: (row) => row.status,
        render: (row) => (
          <div>
            <StatusBadge status={row.status} />
            <p className="data-table-secondary">
              {row.revokedAt
                ? `Revoked ${formatRelative(row.revokedAt)}`
                : row.expiresAt
                  ? `Expires ${formatRelative(row.expiresAt)}`
                  : 'No expiry recorded'}
            </p>
          </div>
        ),
      },
      {
        key: 'granted',
        header: 'Granted',
        sortValue: (row) => row.grantedAt ?? '',
        render: (row) => (
          <div>
            <span className="data-table-primary">{formatDateTime(row.grantedAt)}</span>
            <p className="data-table-secondary">by {row.grantedByEmail ?? 'not recorded'}</p>
          </div>
        ),
      },
      {
        key: 'reason',
        header: 'Reason',
        render: (row) => <span className="data-table-secondary">{row.reason ?? '—'}</span>,
      },
      {
        key: 'actions',
        header: 'Actions',
        nowrap: true,
        render: (row) =>
          row.status === 'active' ? (
            <Button
              variant="outline"
              className="btn-sm"
              disabled={busy !== null}
              onClick={() => setConfirm({ kind: 'revoke', grant: row })}
            >
              Revoke
            </Button>
          ) : (
            <span className="data-table-secondary">—</span>
          ),
      },
    ],
    [busy],
  );

  const sandboxColumns = useMemo<DataTableColumn<SandboxBusiness>[]>(
    () => [
      {
        key: 'name',
        header: 'Sandbox business',
        label: '',
        sortValue: (row) => row.name.toLowerCase(),
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.name}</span>
            <p className="data-table-secondary mono">{row.slug}</p>
          </div>
        ),
      },
      {
        key: 'owner',
        header: 'Owner email',
        sortValue: (row) => row.ownerEmail ?? '',
        render: (row) => row.ownerEmail ?? '—',
      },
      {
        key: 'created',
        header: 'Created',
        sortValue: (row) => row.createdAt,
        render: (row) => (
          <div>
            <span className="data-table-primary">{formatDateTime(row.createdAt)}</span>
            <p className="data-table-secondary">{formatRelative(row.createdAt)}</p>
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
        <PermissionDenied what="the developer tools" permission="developer:access" />
      </>
    );
  }

  const environmentRows: DefRow[] = [
    { term: 'Reported environment', value: <EnvironmentBadge environment={environment} /> },
    { term: 'Where that answer came from', value: SOURCE_LABEL[environment.source] ?? environment.source },
    { term: 'What it means here', value: ENVIRONMENT_MEANING[environment.name] },
    {
      term: `${ENVIRONMENT_SETTING_KEY} setting`,
      value: environmentSetting ? (
        <span className="mono">{JSON.stringify(environmentSetting.value)}</span>
      ) : (
        'Not configured'
      ),
      muted: !environmentSetting,
    },
  ];

  const sessionRows: DefRow[] = [
    {
      term: 'Developer access grant',
      value: status ? (
        <StatusBadge
          status={status.developerMode ? 'active' : 'inactive'}
          label={status.developerMode ? 'Granted' : 'Not granted'}
        />
      ) : (
        '—'
      ),
    },
    { term: 'Granted at', value: formatDateTime(status?.grantedAt), muted: !status?.grantedAt },
    {
      term: 'Grant expires',
      value: status?.expiresAt
        ? `${formatDateTime(status.expiresAt)} (${formatRelative(status.expiresAt)})`
        : 'No expiry recorded',
      muted: !status?.expiresAt,
    },
    {
      term: 'Active session id',
      value: status?.activeSessionId ? <span className="mono">{status.activeSessionId}</span> : 'No open session',
      muted: !status?.activeSessionId,
    },
  ];

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description="Diagnostics, sandbox testing and developer access grants."
        actions={<RefreshButton onClick={reload} loading={loading} />}
      />

      {failed.length > 0 && (
        <div className="callout callout-warning" role="status">
          <div>
            <p className="callout-title">Part of this page did not load</p>
            <p className="callout-text">
              {failed.length} source{failed.length === 1 ? '' : 's'} failed ({failed.join(', ')}). Panels that answered
              are accurate; treat the rest as unknown, not as empty.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <div className="callout callout-danger" role="alert">
          <div>
            <p className="callout-title">That action was refused</p>
            <p className="callout-text">{actionError}</p>
          </div>
        </div>
      )}

      <AreaCoverage gaps={AREA.gaps} title="What is not enforced or not built here" />

      {/* ── Environment ─────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-environment">
        <SectionHead id="developer-environment" title="Environment" />
        <DefList rows={environmentRows} />
        <div className="callout callout-info">
          <div>
            <p className="callout-title">The environment is only what this build was told</p>
            <p className="callout-text">
              Nothing here inspects the database or the deployed region, so an undeclared environment reads as{' '}
              <span className="mono">unknown</span> rather than being guessed.
            </p>
            <Disclosure summary="Resolution order and caveats">
              <p>
                The order is the <span className="mono">{ENVIRONMENT_SETTING_KEY}</span> setting, then this build&rsquo;s{' '}
                <span className="mono">VITE_ENVIRONMENT</span>, then the Vite build mode — and a plain production build
                mode counts as no evidence. No migration declares{' '}
                <span className="mono">{ENVIRONMENT_SETTING_KEY}</span>: the only inserts into{' '}
                <span className="mono">platform_settings</span> are in migrations 068 and 074, and{' '}
                <span className="mono">set_platform_setting()</span> refuses a key a migration has not declared. Unless
                the row was inserted by hand, the marker falls back to the build.
              </p>
            </Disclosure>
          </div>
        </div>
      </section>

      {/* ── Developer session ───────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-session">
        <SectionHead
          id="developer-session"
          title="Developer session"
          actions={
            <div className="toolbar-group">
              <Button
                variant="outline"
                className="btn-sm"
                loading={busy === 'session-start'}
                disabled={!status?.developerMode || Boolean(status?.activeSessionId) || busy !== null}
                onClick={startSession}
              >
                Start session
              </Button>
              <Button
                variant="ghost"
                className="btn-sm"
                loading={busy === 'session-end'}
                disabled={!status?.activeSessionId || busy !== null}
                onClick={endSession}
              >
                End session
              </Button>
            </div>
          }
        />
        <SectionState
          loading={loading && !status}
          error={failed.includes('status') ? 'get_my_developer_status did not answer, so nothing is known about this account.' : null}
          onRetry={reload}
        >
          <>
            <DefList rows={sessionRows} />
            <p className="section-sub">
              Your grant is managed by a platform owner. Starting or ending a session records diagnostic work; it does not change customer access.
            </p>
          </>
        </SectionState>
      </section>

      {/* ── Developer mode grants ───────────────────────────────────── */}
      {isSuperAdmin && (
        <section className="card" aria-labelledby="developer-grants">
          <SectionHead
            id="developer-grants"
            title="Developer mode grants"
            sub="Grantable only to an existing active platform admin."
          />

          <div className="callout callout-info">
            <div>
              <p className="callout-title">What developer mode does and does not do</p>
              <p className="callout-text">
                Nothing here bypasses payment verification, tenant isolation or production permissions.
              </p>
              <Disclosure summary="Where the sandbox limits are enforced">
                <p>
                  <span className="mono">enforce_seat_limit()</span> returns early for a sandbox organisation so test
                  staff can be added — verified in{' '}
                  <span className="mono">supabase/migrations/20260926000069_platform_products_functions.sql</span>. Every
                  other override path in{' '}
                  <span className="mono">20260926000072_platform_developer_mode_functions.sql</span> raises unless the
                  target organisation is a sandbox, and <span className="mono">assert_sandbox_override()</span> fails
                  closed even if the <span className="mono">developer.sandbox_required</span> setting is absent.
                </p>
              </Disclosure>
            </div>
          </div>

          <div className="plat-toolbar">
            <div className="plat-field plat-field-grow">
              <label className="form-label" htmlFor="developer-grant-target">
                Platform admin
              </label>
              <select
                id="developer-grant-target"
                className="select-input"
                value={grantTarget}
                onChange={(event) => setGrantTarget(event.target.value)}
                disabled={admins.length === 0}
              >
                <option value="">Select a platform admin</option>
                {admins.map((admin) => (
                  <option key={admin.userId} value={admin.userId}>
                    {admin.email}
                    {admin.developerMode ? ' — already has developer mode' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="plat-field">
              <label className="form-label" htmlFor="developer-grant-days">
                Valid for (days)
              </label>
              <input
                id="developer-grant-days"
                className="form-input"
                type="number"
                min={1}
                max={3650}
                value={grantDays}
                onChange={(event) => setGrantDays(event.target.value)}
              />
            </div>

            <Button
              variant="outline"
              className="btn-sm"
              disabled={!grantTarget || busy !== null}
              onClick={() => setConfirm({ kind: 'grant' })}
            >
              Grant developer mode
            </Button>
          </div>

          {adminError && <p className="form-error">{adminError}</p>}
          {!adminError && admins.length === 0 && (
            <p className="form-hint">
              No platform admin accounts returned; a grant needs an existing active platform admin.
            </p>
          )}
          <SectionState
            loading={loading && !data.grants}
            error={failed.includes('grants') ? 'list_developer_grants did not answer. Only a platform owner may read it.' : null}
            empty={grants.length === 0}
            emptyTitle="No developer grants recorded"
            emptyBody="Nobody holds developer mode on this platform yet."
            onRetry={reload}
          >
            <DataTable
              columns={grantColumns}
              rows={grants}
              rowKey={(row) => row.userId}
              caption="Developer mode grants"
              stacked
            />
          </SectionState>
        </section>
      )}

      {/* ── Sandbox businesses ──────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-sandbox">
        <SectionHead
          id="developer-sandbox"
          title="Sandbox businesses"
          sub="Test records, excluded from every customer figure."
          actions={
            <Button
              variant="outline"
              className="btn-sm"
              onClick={() => setSandboxOpen(true)}
              disabled={busy !== null || !status?.developerMode}
            >
              Create sandbox business
            </Button>
          }
        />

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">Sandboxes cannot be deleted</p>
            <p className="callout-text">
              <span className="mono">create_sandbox_business()</span> writes the organisation and its TrackOja entitlement
              and nothing else.
            </p>
          </div>
        </div>

        <SectionState
          loading={loading && !data.sandboxes}
          /*
           * Listing sandboxes requires an active developer grant, so without one
           * the call is refused by design. That is a permission state, not a
           * failure: a platform owner reaches this area precisely in order to
           * grant developer mode in the first place, and showing them an error
           * for a refusal they caused on purpose reads as a broken screen.
           */
          unavailable={
            !status?.developerMode
              ? 'Developer mode is not active, so sandbox businesses cannot be listed. Grant it above, then start a session.'
              : null
          }
          error={failed.includes('sandboxes') && status?.developerMode ? 'list_sandbox_businesses did not answer.' : null}
          empty={sandboxes.length === 0}
          emptyTitle="No sandbox businesses"
          emptyBody="Nothing has been created through developer mode yet."
          onRetry={reload}
        >
          <>
            <DataTable
              columns={sandboxColumns}
              rows={sandboxes}
              rowKey={(row) => row.orgId}
              caption="Sandbox businesses"
              stacked
            />
            <p className="section-sub">
              {formatNumber(sandboxes.length)} sandbox record{sandboxes.length === 1 ? '' : 's'}. A{' '}
              <span className="mono">[SANDBOX]</span> prefix marks each one, so none is mistaken for a customer.
            </p>
          </>
        </SectionState>
      </section>

      {/* ── Redacted diagnostics ────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-diagnostics">
        <SectionHead
          id="developer-diagnostics"
          title="Diagnostics (redacted)"
          sub="One business’s records, redacted server-side."
        />

        {canListBusinesses ? (
          <>
            <div className="plat-toolbar">
              <div className="plat-field plat-field-grow">
                <label className="form-label" htmlFor="developer-diagnostics-org">
                  Business
                </label>
                <select
                  id="developer-diagnostics-org"
                  className="select-input"
                  value={diagnosticsOrgId}
                  onChange={(event) => setDiagnosticsOrgId(event.target.value)}
                >
                  <option value="">Select a business</option>
                  {businesses.map((row) => (
                    <option key={row.orgId} value={row.orgId}>
                      {row.name}
                      {row.isSandbox ? ' — sandbox' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="outline"
                className="btn-sm"
                loading={diagnosticsLoading}
                disabled={!diagnosticsOrgId}
                onClick={loadDiagnostics}
              >
                Load diagnostics
              </Button>
            </div>

            <SectionState
              loading={diagnosticsLoading}
              error={diagnosticsError}
              empty={!diagnostics}
              emptyTitle="No diagnostics loaded"
              emptyBody="Choose a business, then load its redacted diagnostics."
              onRetry={loadDiagnostics}
            >
              <>
                <pre className="code-panel">{JSON.stringify(diagnostics, null, 2)}</pre>
                <p className="section-sub">
                  Redaction happens in the database: emails arrive masked, and nothing here acts as the customer.
                </p>
                <Disclosure summary="What the payload excludes">
                  <p>
                    Secret keys, API tokens, passwords, payment provider payloads, webhook signatures, raw metadata and
                    transaction references are excluded — the payload&rsquo;s own <span className="mono">excluded</span>{' '}
                    list names them, so withheld detail is not absent detail.{' '}
                    <span className="mono">override_allowed</span> is true only for a sandbox organisation.
                  </p>
                </Disclosure>
              </>
            </SectionState>
          </>
        ) : (
          <StateBlock
            variant="unavailable"
            title="Choosing a business needs another permission"
            body="Listing businesses is gated on platform:manage_businesses, so no organisation can be picked here."
          />
        )}
      </section>

      {/* ── Impersonation ───────────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-impersonation">
        <SectionHead
          id="developer-impersonation"
          title="Read-only support session"
          sub="Named, reasoned, time-limited; audited at both ends."
        />

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">How far read-only is actually enforced</p>
            <p className="callout-text">
              The guard covers 20 tenant business tables: writes outside them, and callers with no JWT, are not blocked.
            </p>
            <Disclosure summary="Origin of the guard">
              <p>
                <span className="mono">block_writes_while_impersonating()</span> was declared in{' '}
                <span className="mono">20260926000065_platform_developer_mode_schema.sql</span> and attached to no table,
                so the guarantee did not exist. Migration 089 (section 4) attached it to 20 tenant business tables but
                exempted platform admins — the only callers that can own a session, so the exemption covered every caller
                the predicate could match. Migration 090 removed it and asserts that all 20 triggers are still attached. A
                caller with no JWT — a <span className="mono">service_role</span> webhook, a migration or the seed path —
                is never blocked, because <span className="mono">auth.uid()</span> is NULL. The &ldquo;attached to no
                table&rdquo; wording in the coverage notice above predates 090 and comes from the shared area registry.
              </p>
            </Disclosure>
          </div>
        </div>

        {impersonation ? (
          <>
            <DefList
              rows={[
                { term: 'Business being viewed', value: impersonation.orgName },
                { term: 'Reason recorded', value: impersonation.reason },
                { term: 'Session id', value: <span className="mono">{impersonation.sessionId}</span> },
                { term: 'Expires at', value: formatDateTime(impersonation.expiresAt) },
                {
                  term: 'Time remaining',
                  value: secondsLeft > 0 ? formatCountdown(secondsLeft) : 'Expired — re-reading the session',
                },
              ]}
            />
            <div className="state-actions">
              <Button
                variant="outline"
                className="btn-sm"
                loading={busy === 'impersonate-end'}
                disabled={busy !== null}
                onClick={endImpersonation}
              >
                End support session
              </Button>
            </div>
            <p className="section-sub">
              The target is the business owner, always: <span className="mono">start_impersonation()</span> writes{' '}
              <span className="mono">target_user_id = organizations.owner_id</span>, so a session cannot be narrowed to a
              particular staff member. Only one live session is allowed.
            </p>
          </>
        ) : canListBusinesses ? (
          <>
            <div className="plat-toolbar">
              <div className="plat-field plat-field-grow">
                <label className="form-label" htmlFor="developer-impersonate-org">
                  Business
                </label>
                <select
                  id="developer-impersonate-org"
                  className="select-input"
                  value={impersonateOrgId}
                  onChange={(event) => setImpersonateOrgId(event.target.value)}
                >
                  <option value="">Select a real business</option>
                  {impersonationTargets.map((row) => (
                    <option key={row.orgId} value={row.orgId}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="plat-field">
                <label className="form-label" htmlFor="developer-impersonate-minutes">
                  Minutes (1–60)
                </label>
                <input
                  id="developer-impersonate-minutes"
                  className="form-input"
                  type="number"
                  min={1}
                  max={60}
                  value={impersonateMinutes}
                  onChange={(event) => setImpersonateMinutes(event.target.value)}
                />
              </div>

              <Button
                variant="outline"
                className="btn-sm"
                disabled={!impersonateOrgId || busy !== null}
                onClick={() => setConfirm({ kind: 'impersonate-start' })}
              >
                Start support session
              </Button>
            </div>

            <p className="section-sub">
              Sandboxes are excluded: <span className="mono">start_impersonation()</span> refuses them. A live session is
              never ended implicitly, and the 1–60 minute duration is clamped by the server too.
            </p>
          </>
        ) : (
          <StateBlock
            variant="unavailable"
            title="Choosing a business needs another permission"
            body="Starting a session needs a business to pick, and the business list is gated on platform:manage_businesses."
          />
        )}
      </section>

      {/* ── Not built ───────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-not-built">
        <SectionHead id="developer-not-built" title="Not built in this area" />
        <ul className="list">
          {NOT_BUILT.map((item) => (
            <li className="list-item" key={item}>
              <div>
                <p className="list-item-title">
                  <StatusBadge status="not_configured" /> <Badge tone="outline">no endpoint</Badge>
                </p>
                <p className="list-item-subtitle">{item}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      <Dialog
        open={sandboxOpen}
        onClose={() => setSandboxOpen(false)}
        title="Create a sandbox business"
        description="This creates permanent, empty test records."
        footer={
          <>
            <Button variant="outline" onClick={() => setSandboxOpen(false)} disabled={busy === 'sandbox-create'}>
              Cancel
            </Button>
            <Button
              onClick={() => void createSandbox()}
              loading={busy === 'sandbox-create'}
              disabled={!sandboxName.trim() || !sandboxAcknowledged}
            >
              Create sandbox business
            </Button>
          </>
        }
      >
        <div className="callout callout-warning">
          <div>
            <p className="callout-title">What will actually exist afterwards</p>
            <p className="callout-text">
              One sandbox organisation with a <span className="mono">[SANDBOX]</span> name prefix and a generated slug,
              plus one active TrackOja entitlement at zero agreed price. No store, products, staff or sales — and no
              delete endpoint.
            </p>
          </div>
        </div>

        <FormField
          id="sandbox-name"
          label="Business name"
          value={sandboxName}
          onChange={setSandboxName}
          placeholder="Stock take trial"
          disabled={busy === 'sandbox-create'}
          required
        />

        <FormField
          id="sandbox-owner-email"
          label="Owner email (optional)"
          type="email"
          value={sandboxOwner}
          onChange={setSandboxOwner}
          placeholder="Left blank, the sandbox is owned by you"
          disabled={busy === 'sandbox-create'}
        />

        {sandboxError && (
          <p className="form-error" role="alert">
            {sandboxError}
          </p>
        )}

        <label className="plat-check" htmlFor="sandbox-acknowledge">
          <input
            id="sandbox-acknowledge"
            type="checkbox"
            checked={sandboxAcknowledged}
            onChange={(event) => setSandboxAcknowledged(event.target.checked)}
            disabled={busy === 'sandbox-create'}
          />
          I understand this sandbox record cannot be deleted.
        </label>
      </Dialog>

      <ConfirmDialog
        open={confirm?.kind === 'grant'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmedAction}
        title="Grant developer mode"
        consequence={`${
          admins.find((admin) => admin.userId === grantTarget)?.email ?? 'The selected admin'
        } will hold developer mode for ${grantDays || '—'} day(s), gaining developer:access, sandbox creation, redacted diagnostics and this area — bypassing no permission. Your reason is stored on the grant and audited; revoking it later ends any open session immediately.`}
        confirmLabel="Grant developer mode"
        requireReason
        reasonLabel="Why this admin needs developer mode"
        reasonHint="At least 10 characters; the server refuses a shorter reason."
      />

      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmedAction}
        title="Revoke developer mode"
        consequence={`${
          confirm?.kind === 'revoke' ? confirm.grant.email : 'That admin'
        } loses developer:access and any open session immediately; their other platform permissions are untouched, and sandboxes they created stay behind.`}
        confirmLabel="Revoke developer mode"
        danger
        requireReason
        reasonLabel="Why this access is being withdrawn"
        reasonHint="Recorded on the grant and in the audit trail."
      />

      <ConfirmDialog
        open={confirm?.kind === 'impersonate-start'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmedAction}
        title="Start a read-only support session"
        consequence={`You will be recorded as viewing ${
          businesses.find((row) => row.orgId === impersonateOrgId)?.name ?? 'the selected business'
        } for ${impersonateMinutes} minutes as its owner. Audited at both ends, expires on its own, and writes are refused on the 20 tenant tables the guard covers — outside that list they are not blocked. The customer&rsquo;s account is not changed.`}
        confirmLabel="Start session"
        requireReason
        reasonLabel="Reason for this session"
        reasonHint="At least 10 characters; the server refuses a shorter reason and audits it."
      />
    </>
  );
}
