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
 * Spelled out here rather than reused from src/config/environment.ts: that copy is
 * deliberately terse for the sidebar marker, and on this screen the operator is
 * about to run a test, so the consequence has to be explicit.
 */
const ENVIRONMENT_MEANING: Record<PlatformEnvironmentName, string> = {
  production:
    'Live customer data. Diagnostics here read real businesses, and a sandbox created here sits in the same database as paying customers.',
  staging:
    'A rehearsal environment. Customer data must not be created here, and figures read here are not the customer-facing ones.',
  development:
    'A development environment. Nothing here is a customer record, so a sandbox test proves nothing about production behaviour.',
  unknown:
    'This deployment has not declared which environment it is, so treat anything read here as unattributable rather than assume it is a test system.',
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
  'No webhook inspection or replay: nothing records an inbound provider delivery, so a failed or unknown webhook cannot be looked up, and a rejected one cannot be re-sent.',
  'No background-job status: there is no job table, queue or scheduler to report on.',
  'No error-log tail: the only failure record is failed and attempted audit rows, which the redacted diagnostics payload exposes one business at a time.',
  'No API key management: no key store exists, so there is nothing to issue, rotate or revoke.',
  'Feature flags are readable through the diagnostics payload (platform and per-business scope) but no list or update endpoint exists, so they cannot be listed or toggled on their own.',
  'No cross-admin impersonation history: the only session endpoint reports the caller’s own live session, so other admins’ sessions appear only as IMPERSONATION_STARTED / IMPERSONATION_ENDED rows in the audit trail.',
  'No general-purpose SQL console. That is deliberate and will not be added: an arbitrary query surface would defeat the permission gates every other screen here respects.',
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

    const sources: Array<[keyof DeveloperData, Promise<unknown>]> = [
      ['status', PlatformAdminService.getDeveloperStatus()],
      ['sandboxes', PlatformAdminService.listSandboxBusinesses()],
      ['impersonation', PlatformAdminService.getActiveImpersonation()],
    ];
    if (includeGrants) sources.push(['grants', PlatformAdminService.listDeveloperGrants()]);
    if (includeBusinesses) sources.push(['businesses', PlatformAdminService.listBusinesses({ limit: 200 })]);

    const results = await Promise.allSettled(sources.map(([, promise]) => promise));
    const next: Partial<DeveloperData> = {};
    const failures: string[] = [];

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
      toast.success('Developer session started', { description: 'The session is journalled and time-bounded.' });
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
        toast.success('Developer mode revoked', {
          description: 'Any open developer session for that admin was ended and developer:access was withdrawn.',
        });
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
        toast.success('Read-only support session started', {
          description: 'Audited at both ends. Writes are refused on the tenant tables the guard covers.',
        });
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
      term: 'Developer mode',
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
        description={`Environment, diagnostics and sandbox records. Signed in as ${
          isSuperAdmin ? 'platform owner' : 'developer'
        } in ${environment.label.toLowerCase()}.`}
        actions={<RefreshButton onClick={reload} loading={loading} />}
      />

      {failed.length > 0 && (
        <div className="callout callout-warning" role="status">
          <div>
            <p className="callout-title">Part of this page could not be loaded</p>
            <p className="callout-text">
              {failed.length} source{failed.length === 1 ? '' : 's'} failed ({failed.join(', ')}). The panels that
              answered are accurate; treat the rest as unknown rather than empty.
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
        <SectionHead
          id="developer-environment"
          title="Environment"
          sub="Which deployment you are working in, and where that answer came from."
        />
        <DefList rows={environmentRows} />
        <div className="callout callout-info">
          <div>
            <p className="callout-title">This application can only report the environment it was told about</p>
            <p className="callout-text">
              Nothing on this screen inspects the database, the Supabase project or the deployed region, so an
              environment that was never declared reads as <span className="mono">unknown</span> rather than being
              guessed. Resolution order is the <span className="mono">{ENVIRONMENT_SETTING_KEY}</span> setting, then this
              build&rsquo;s <span className="mono">VITE_ENVIRONMENT</span>, then the Vite build mode — and a plain
              production build mode counts as no evidence at all. No migration declares{' '}
              <span className="mono">{ENVIRONMENT_SETTING_KEY}</span> (the only inserts into{' '}
              <span className="mono">platform_settings</span> are in{' '}
              <span className="mono">20260926000068_platform_products_seed.sql</span> and{' '}
              <span className="mono">20260926000074_platform_products_plan_ladder.sql</span>), and{' '}
              <span className="mono">set_platform_setting()</span> refuses a key a migration has not declared — so unless
              the row was inserted by hand, the marker falls back to the build and the row above reads &ldquo;Not
              configured&rdquo;.
            </p>
          </div>
        </div>
      </section>

      {/* ── Developer session ───────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-session">
        <SectionHead
          id="developer-session"
          title="Developer session"
          sub="Grant status and the journalled session that bounds this access."
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
              Opening a session does not widen what you may do — the grant is what grants access. The session is what
              makes sandbox work journalled and time-bounded, and only one may be open at a time. Ending it takes no data
              with it, so neither control is confirmed; the destructive actions below are.
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
            sub="Developer mode is never a signup option and never attaches to a business user: the target must already be an active platform admin."
          />

          <div className="callout callout-info">
            <div>
              <p className="callout-title">What developer mode does and does not do</p>
              <p className="callout-text">
                It never bypasses payment verification, tenant isolation, or production permissions on a real customer
                account. The only sandbox exemption that exists in code is the seat-limit trigger{' '}
                <span className="mono">enforce_seat_limit()</span>, which returns early for a sandbox organisation so test
                staff can be added — verified in{' '}
                <span className="mono">supabase/migrations/20260926000069_platform_products_functions.sql</span>. Every
                other override path in{' '}
                <span className="mono">20260926000072_platform_developer_mode_functions.sql</span> raises unless the target
                organisation is a sandbox, and <span className="mono">assert_sandbox_override()</span> fails closed even if
                the <span className="mono">developer.sandbox_required</span> setting is absent.
              </p>
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
              No platform admin accounts were returned. A grant needs an existing active platform admin as its target, so
              there is nothing to grant here yet.
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
          sub="Test records, excluded from every customer figure and every revenue total."
          actions={
            <Button variant="outline" className="btn-sm" onClick={() => setSandboxOpen(true)} disabled={busy !== null}>
              Create sandbox business
            </Button>
          }
        />

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">Sandboxes cannot be deleted, and they arrive empty</p>
            <p className="callout-text">
              <span className="mono">create_sandbox_business()</span> writes exactly two things: the organisation row and
              its TrackOja entitlement. There is no store, no product, no staff member, no category and no sample sale
              behind it. No migration anywhere defines a delete or archive endpoint for an organisation either, so every
              sandbox created here stays in the database permanently and accumulates.
            </p>
          </div>
        </div>

        <SectionState
          loading={loading && !data.sandboxes}
          error={failed.includes('sandboxes') ? 'list_sandbox_businesses did not answer.' : null}
          empty={sandboxes.length === 0}
          emptyTitle="No sandbox businesses"
          emptyBody="Nothing has been created through developer mode on this platform yet."
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
              {formatNumber(sandboxes.length)} sandbox record{sandboxes.length === 1 ? '' : 's'} listed. Names carry a{' '}
              <span className="mono">[SANDBOX]</span> prefix and the entitlement is flagged too, so a sandbox cannot be
              mistaken for a customer in the business directory.
            </p>
          </>
        </SectionState>
      </section>

      {/* ── Redacted diagnostics ────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-diagnostics">
        <SectionHead
          id="developer-diagnostics"
          title="Diagnostics (redacted)"
          sub="A read-only view of what one business actually holds. The payload is redacted server-side before it reaches this browser."
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
              emptyBody="Choose a business and load its redacted diagnostics."
              onRetry={loadDiagnostics}
            >
              <>
                <pre className="code-panel">{JSON.stringify(diagnostics, null, 2)}</pre>
                <p className="section-sub">
                  Redaction happens in the database, not here: emails arrive masked and the payload excludes secret keys,
                  API tokens, passwords, payment provider payloads, webhook signatures, raw metadata and transaction
                  references — its own <span className="mono">excluded</span> list names them.{' '}
                  <span className="mono">override_allowed</span> is true only for a sandbox organisation, and no part of
                  this payload lets a caller act as the customer, so nothing displayed above is a credential.
                </p>
              </>
            </SectionState>
          </>
        ) : (
          <StateBlock
            variant="unavailable"
            title="Choosing a business needs another permission"
            body="The only endpoint that lists businesses is list_product_businesses, which requires platform:manage_businesses. Without it there is no way to pick an organisation, so diagnostics cannot be run from this screen."
          />
        )}
      </section>

      {/* ── Impersonation ───────────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-impersonation">
        <SectionHead
          id="developer-impersonation"
          title="Read-only support session"
          sub="A named, reasoned, time-limited session on one real business. Every start and end is audited."
        />

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">How far read-only is actually enforced</p>
            <p className="callout-text">
              <span className="mono">block_writes_while_impersonating()</span> was declared in{' '}
              <span className="mono">20260926000065_platform_developer_mode_schema.sql</span> and attached to no table, so
              the promised guarantee did not exist. Migration{' '}
              <span className="mono">20260927000089_platform_owner_hardening.sql</span> (section 4) attached it to 20
              tenant business tables, but kept a clause exempting platform admins — and since only a platform admin can
              own an impersonation session, that exempted every caller the rest of the predicate could match. Migration{' '}
              <span className="mono">20260927000090_entitlement_and_impersonation_fixes.sql</span> removed that exemption
              and asserts at migration time that all 20 triggers are still attached, so the guard now refuses a write
              from the owner of any active, unexpired session. Two limits remain, both stated in that migration: the
              guard covers only those 20 tables, so a write to anything outside the list is not blocked, and a caller
              with no JWT — a <span className="mono">service_role</span> webhook, a migration or the seed path — is
              deliberately never blocked because <span className="mono">auth.uid()</span> is NULL. The &ldquo;attached to
              no table&rdquo; wording in the coverage notice at the top of this page predates migration 090 and is kept
              only because that notice is generated from the shared area registry.
            </p>
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
              particular staff member. Only one live session is allowed at a time.
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
              Sandbox businesses are left out of this picker on purpose:{' '}
              <span className="mono">start_impersonation()</span> refuses them with &ldquo;Sandbox businesses are reached
              through developer mode, not impersonation&rdquo;. A live session is never ended implicitly, and the duration
              is clamped to 1–60 minutes by the server as well as here.
            </p>
          </>
        ) : (
          <StateBlock
            variant="unavailable"
            title="Choosing a business needs another permission"
            body="Selecting a business requires platform:manage_businesses, because the business list endpoint is gated on it. Without that permission no session can be started from this screen."
          />
        )}
      </section>

      {/* ── Not built ───────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="developer-not-built">
        <SectionHead
          id="developer-not-built"
          title="Not built in this area"
          sub="Named capabilities with no backend at all, kept visible so an absence is not mistaken for a clean bill of health."
        />
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
        description="This creates permanent, empty test records. Read what will exist before you confirm."
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
              One organisation flagged as a sandbox, with a <span className="mono">[SANDBOX]</span> name prefix and a
              generated slug, plus one active TrackOja entitlement at zero agreed price. No store, no products, no staff,
              no categories and no sample sales — the function inserts into <span className="mono">organizations</span> and{' '}
              <span className="mono">organization_products</span> only. There is no delete endpoint, so it cannot be
              removed afterwards.
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
        } will hold developer mode for ${grantDays || '—'} day(s), gaining developer:access, sandbox creation, redacted diagnostics and the developer area of this dashboard. It does not bypass payment verification, tenant isolation or production permissions. Your reason is stored on the grant and written to the audit trail, and revoking it later also ends any open developer session immediately.`}
        confirmLabel="Grant developer mode"
        requireReason
        reasonLabel="Why this admin needs developer mode"
        reasonHint="At least 10 characters: the server refuses a shorter reason."
      />

      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirmedAction}
        title="Revoke developer mode"
        consequence={`${
          confirm?.kind === 'revoke' ? confirm.grant.email : 'That admin'
        } loses developer:access immediately, any open developer session is ended, and the developer area disappears from their dashboard. Their other platform permissions are untouched. Sandbox records they created stay behind, because sandboxes cannot be deleted.`}
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
        } for ${impersonateMinutes} minutes as its owner. The session is audited at both ends, expires on its own, and writes by this session are refused on the 20 tenant business tables the write guard covers — tables outside that list are not blocked. It does not sign you in as the customer and it changes nothing in their account.`}
        confirmLabel="Start session"
        requireReason
        reasonLabel="Reason for this session"
        reasonHint="At least 10 characters: the server refuses a shorter reason and audits it."
      />
    </>
  );
}
