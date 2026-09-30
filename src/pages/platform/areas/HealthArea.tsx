import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PlatformService } from '../../../services/platform.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import {
  AreaCoverage,
  PermissionDenied,
  PlatformPageHead,
  RefreshButton,
} from '../../../components/platform/PlatformPageHead';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList } from '../../../components/ui/DefList';
import { Disclosure } from '../../../components/ui/Disclosure';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { formatDateTime, formatNumber, formatRelative, humaniseToken } from '../../../utils/format';
import type { PlatformRecentError, PlatformSystemHealth } from '../../../types';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'health')!;

/**
 * `list_platform_recent_errors` takes a limit and nothing else — no date range
 * — so this reads the most recent 100 failed or attempted rows whatever their
 * age. The grouping below therefore counts occurrences *within those 100 rows*.
 */
const RECENT_ERROR_LIMIT = 100;

/**
 * The status vocabulary this page is allowed to use. There is no `healthy`: a
 * console that can only say 'healthy' or 'failing' will say 'healthy' about
 * everything it does not measure.
 */
type SignalStatus = 'ok' | 'degraded' | 'failing' | 'not_instrumented' | 'unknown';

interface SignalRow {
  key: string;
  name: string;
  /** What the signal would tell an operator, in one sentence. */
  meaning: string;
  status: SignalStatus;
  reading: ReactNode;
  checked: ReactNode;
  diagnostics: ReactNode;
}

/**
 * Reads the two health sources that exist, keeping whichever answered.
 *
 * `get_platform_system_health` and `list_platform_recent_errors` are separate
 * functions with separate failure modes, so one failing must not blank the
 * screen and must not be hidden either: the failures are returned and the page
 * says the figures are partial.
 */
function useHealthData(enabled: boolean) {
  const [health, setHealth] = useState<PlatformSystemHealth | null>(null);
  const [recentErrors, setRecentErrors] = useState<PlatformRecentError[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);

    const sources: Array<[string, Promise<unknown>]> = [
      ['counters', PlatformService.getSystemHealth()],
      ['recent failures', PlatformService.getRecentErrors(RECENT_ERROR_LIMIT)],
    ];

    const results = await Promise.allSettled(sources.map(([, promise]) => promise));
    const failures: string[] = [];

    results.forEach((result, index) => {
      const [label] = sources[index];
      if (result.status === 'fulfilled') {
        if (index === 0) setHealth(result.value as PlatformSystemHealth);
        else setRecentErrors(result.value as PlatformRecentError[]);
      } else {
        failures.push(label);
      }
    });

    // The server returns no timestamp with either read, so "last checked" is the
    // moment the browser received the answer and is labelled as such.
    setLoadedAt(new Date().toISOString());
    setFailed(failures);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { health, recentErrors, failed, loadedAt, loading, reload: load };
}

/**
 * Signals that are declared here rather than fetched: nothing measures any of
 * them, so there is no endpoint to call and no row to read. Listing them is the
 * point — the absence has to be as visible as the four numbers that do exist.
 */
const UNINSTRUMENTED_SIGNALS: { key: string; name: string; meaning: string; needed: string }[] = [
  {
    key: 'uptime',
    name: 'Application uptime',
    meaning: 'Whether the API and the web application are reachable at all.',
    needed:
      'An external probe writing a check result on a schedule. Nothing in this repository pings anything, so an outage is discovered by a user.',
  },
  {
    key: 'api_error_rate',
    name: 'API error rate and latency',
    meaning: 'The share of requests failing server-side, and how slow the successful ones are.',
    needed:
      'Request-level telemetry with a p95 latency series. Postgres has no such table here, and Edge Function logs are not queryable from this database.',
  },
  {
    key: 'database',
    name: 'Database connectivity',
    meaning: 'Whether the database the whole product depends on is accepting connections.',
    needed:
      'A probe that connects and records the result — the obvious one is circular, because these counters are themselves a database query.',
  },
  {
    key: 'auth_failures',
    name: 'Authentication failures',
    meaning: 'Failed sign-ins and refused permissions, where credential stuffing would first show.',
    needed:
      'A record of refused authentication. Permission denials leave no audit row today, and Supabase Auth logs live outside this database.',
  },
  {
    key: 'background_jobs',
    name: 'Background jobs',
    meaning: 'Whether the sweeps and scheduled work the platform depends on actually ran.',
    needed: 'A job_runs table and a scheduler to write to it. Nothing schedules anything.',
  },
  {
    key: 'webhooks',
    name: 'Webhook processing',
    meaning: 'Whether provider webhooks are arriving, verifying and being processed.',
    needed:
      'A webhook_events ledger written by paystack-webhook and opay-webhook. Both discard unknown events and never persist a signature failure, so a broken webhook looks identical to a quiet one.',
  },
  {
    key: 'email',
    name: 'Email delivery',
    meaning: 'Whether verification and notification email is being accepted and delivered.',
    needed:
      'A sender and its delivery results. There is no application email sender in this repository, and SMTP is configured in the Supabase project outside this database.',
  },
];

/**
 * Grade for a real counter.
 *
 * `degraded` means "above zero — there is something here to look at". It is not
 * a threshold: no alerting rule exists to compare against, so any number chosen
 * as a limit would be an invented grade presented as a measurement.
 */
function counterStatus(value: number | null): SignalStatus {
  if (value === null) return 'unknown';
  return value === 0 ? 'ok' : 'degraded';
}

interface FailureGroup {
  action: string;
  occurrences: number;
  failed: number;
  attempted: number;
  latestAt: string;
  businesses: string[];
}

export default function HealthArea() {
  const { can } = usePlatform();
  // `platform:view_health` is the key this area is meant to use; `platform:view`
  // is accepted as the fallback so an operator holding only the older key still
  // reaches the page instead of a blank one.
  const allowed = can('platform:view_health') || can('platform:view');

  const { health, recentErrors, failed, loadedAt, loading, reload } = useHealthData(allowed);
  const partial = failed.length > 0;

  const signals = useMemo<SignalRow[]>(() => {
    const readAt = loadedAt ? formatRelative(loadedAt) : '—';

    const counterRow = (
      key: string,
      name: string,
      meaning: string,
      value: number | null,
      unit: string,
      diagnostics: ReactNode,
    ): SignalRow => ({
      key,
      name,
      meaning,
      status: loading ? 'unknown' : counterStatus(value),
      reading:
        value === null ? (
          <span className="data-table-secondary">No value</span>
        ) : (
          <>
            {formatNumber(value)}
            <p className="data-table-secondary">{unit}</p>
          </>
        ),
      checked: loading ? '—' : readAt,
      diagnostics,
    });

    const auditLink = (
      <Link className="btn btn-outline btn-sm" to="/platform/audit?status=failed">
        <span className="btn-label">Failed events</span>
      </Link>
    );

    const real: SignalRow[] = [
      counterRow(
        'failed_audit_events',
        'Failed audit events',
        'Audit rows the server recorded as failed in the last 24 hours.',
        health?.failedAuditEvents24h ?? null,
        'in the last 24 hours',
        auditLink,
      ),
      counterRow(
        'failed_transactions',
        'Failed subscription payments',
        'Subscription transactions recorded as failed in the last 24 hours.',
        health?.failedTransactions24h ?? null,
        'in the last 24 hours',
        <Link className="btn btn-outline btn-sm" to="/platform/billing?filter=failed">
          <span className="btn-label">Failed payments</span>
        </Link>,
      ),
      counterRow(
        'past_due',
        'Businesses past due',
        'Billing status past_due right now — a business state, not a fault.',
        health?.pastDueOrganizations ?? null,
        'as of this read',
        <Link className="btn btn-outline btn-sm" to="/platform/billing?filter=past_due">
          <span className="btn-label">Open billing</span>
        </Link>,
      ),
      counterRow(
        'suspended',
        'Businesses suspended',
        'Billing status suspended right now — access withdrawn, not an outage.',
        health?.suspendedOrganizations ?? null,
        'as of this read',
        <Link className="btn btn-outline btn-sm" to="/platform/businesses?billing=suspended">
          <span className="btn-label">Open directory</span>
        </Link>,
      ),
    ];

    const absent: SignalRow[] = UNINSTRUMENTED_SIGNALS.map((signal) => ({
      key: signal.key,
      name: signal.name,
      meaning: signal.meaning,
      status: 'not_instrumented',
      // The literal words, not a dash and not a zero: a zero is a measurement.
      reading: <span className="data-table-secondary">Not configured</span>,
      checked: <span className="data-table-secondary">Never</span>,
      diagnostics: <span className="data-table-secondary">No route</span>,
    }));

    return [...real, ...absent];
  }, [health, loading, loadedAt]);

  const signalColumns = useMemo<DataTableColumn<SignalRow>[]>(
    () => [
      {
        key: 'signal',
        header: 'Signal',
        label: '',
        sortValue: (row) => row.name.toLowerCase(),
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.name}</span>
            <p className="data-table-secondary">{row.meaning}</p>
          </div>
        ),
      },
      {
        key: 'reading',
        header: 'Current',
        numeric: true,
        render: (row) => row.reading,
      },
      {
        key: 'status',
        header: 'Status',
        sortValue: (row) => row.status,
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'checked',
        header: 'Last checked',
        render: (row) => row.checked,
      },
      {
        key: 'diagnostics',
        header: 'Diagnostics',
        render: (row) => row.diagnostics,
      },
    ],
    [],
  );

  /**
   * Repeated failures collapsed by action. The rows are real, so the counts are
   * real; grouping is presentation, not interpretation.
   */
  const failureGroups = useMemo<FailureGroup[]>(() => {
    const byAction = new Map<string, FailureGroup>();
    for (const entry of recentErrors) {
      const group = byAction.get(entry.action) ?? {
        action: entry.action,
        occurrences: 0,
        failed: 0,
        attempted: 0,
        latestAt: entry.createdAt,
        businesses: [],
      };
      group.occurrences += 1;
      if (entry.status === 'failed') group.failed += 1;
      else group.attempted += 1;
      if (new Date(entry.createdAt).getTime() > new Date(group.latestAt).getTime()) {
        group.latestAt = entry.createdAt;
      }
      // A platform-scoped audit row carries no organisation, so it is named
      // rather than dropped: "Platform-wide" is what the row actually says.
      const business = entry.orgName ?? 'Platform-wide';
      if (!group.businesses.includes(business)) group.businesses.push(business);
      byAction.set(entry.action, group);
    }
    return [...byAction.values()].sort(
      (a, b) => b.occurrences - a.occurrences || a.action.localeCompare(b.action),
    );
  }, [recentErrors]);

  const failureColumns = useMemo<DataTableColumn<FailureGroup>[]>(
    () => [
      {
        key: 'action',
        header: 'Action',
        label: '',
        sortValue: (row) => row.action,
        render: (row) => (
          <div>
            <span className="data-table-primary">{humaniseToken(row.action)}</span>
            <p className="data-table-secondary">
              <span className="mono">{row.action}</span>
            </p>
          </div>
        ),
      },
      {
        key: 'occurrences',
        header: 'Occurrences',
        numeric: true,
        sortValue: (row) => row.occurrences,
        render: (row) => formatNumber(row.occurrences),
      },
      {
        key: 'split',
        header: 'Failed / attempted',
        numeric: true,
        render: (row) => `${formatNumber(row.failed)} / ${formatNumber(row.attempted)}`,
      },
      {
        key: 'latest',
        header: 'Most recent',
        sortValue: (row) => row.latestAt,
        render: (row) => (
          <div>
            <span className="data-table-primary">{formatDateTime(row.latestAt)}</span>
            <p className="data-table-secondary">{formatRelative(row.latestAt)}</p>
          </div>
        ),
      },
      {
        key: 'businesses',
        header: 'Businesses',
        render: (row) =>
          row.businesses.length <= 3
            ? row.businesses.join(', ')
            : `${row.businesses.slice(0, 3).join(', ')} and ${row.businesses.length - 3} more`,
      },
    ],
    [],
  );

  if (!allowed) {
    return (
      <>
        <PlatformPageHead area={AREA} />
        <PermissionDenied what="system health" permission="platform:view_health" />
      </>
    );
  }

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description="What is measured, what is not, and what that leaves unknown."
        actions={<RefreshButton onClick={() => void reload()} loading={loading} />}
      />

      {partial && (
        <div className="callout callout-warning" role="status">
          <div>
            <p className="callout-title">Some readings could not be loaded</p>
            <p className="callout-text">
              {failed.length} of 2 sources failed to return ({failed.join(', ')}). The figures below are
              partial; the missing source is unknown rather than zero.
            </p>
          </div>
        </div>
      )}

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot measure yet" />

      {/* ── Signals ───────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="health-signals">
        <SectionHead
          id="health-signals"
          title="Signals"
          sub="Four are read from the database; seven are not measured at all. Last checked is the browser clock at page load — the server timestamps nothing."
        />
        <DataTable
          columns={signalColumns}
          rows={signals}
          rowKey={(row) => row.key}
          stacked
          loading={loading}
          skeletonRows={6}
          caption="Platform health signals, instrumented and uninstrumented"
        />

        <p className="form-hint">
          OK on a counter means no matching row was written, not that the platform is healthy. Unknown means
          no value has been read yet — a blank is not a zero.
        </p>

        <Disclosure summary="How to read the statuses">
          <DefList
            rows={[
              {
                term: 'ok',
                value: 'The query answered and the counter is zero — "no matching row", not "the platform is healthy".',
              },
              {
                term: 'degraded',
                value:
                  'The query answered and the counter is above zero. Not a breached threshold: no threshold exists to breach.',
              },
              {
                term: 'failing',
                value:
                  'Kept in the vocabulary for a real alerting rule. Nothing sets it today, because nothing compares a measurement to a limit.',
              },
              {
                term: 'not_instrumented',
                value:
                  'Nothing measures this signal — no endpoint, no table and no probe. Shown as Not configured and never as ok.',
              },
              {
                term: 'unknown',
                value: 'No value has been read: the query has not returned yet, or it failed. A blank is not a zero.',
              },
            ]}
          />
        </Disclosure>

        <Disclosure summary="What each missing signal would need">
          <DefList
            rows={UNINSTRUMENTED_SIGNALS.map((signal) => ({
              term: signal.name,
              value: signal.needed,
            }))}
          />
        </Disclosure>
      </section>

      {/* ── The limit of the four real counters ───────────────────── */}
      <div className="callout callout-danger">
        <div>
          <p className="callout-title">&quot;0 failed events&quot; is not proof of health</p>
          <p className="callout-text">
            The four counters come from <span className="mono">get_platform_system_health()</span>:
            audit and subscription rows with <span className="mono">status = &apos;failed&apos;</span> over a
            fixed 24-hour window, plus two current billing-state counts. Almost nothing in this application
            writes that status, so zeros are the normal reading and mean only that no row was written. A job
            that never ran, a webhook never delivered and an email never sent leave no trace. Treat these
            four numbers as a floor on known failures.
          </p>
        </div>
      </div>

      {/* ── Recent failures, grouped ──────────────────────────────── */}
      <section className="card" aria-labelledby="health-failures">
        <SectionHead
          id="health-failures"
          title="Recent failed events, grouped"
          sub={`Grouped in the browser from the most recent ${formatNumber(RECENT_ERROR_LIMIT)} audit rows with status failed or attempted.`}
          actions={
            <Link className="btn btn-ghost btn-sm" to="/platform/audit?status=failed">
              <span className="btn-label">Open audit logs</span>
            </Link>
          }
        />

        {failed.includes('recent failures') ? (
          <StateBlock
            variant="error"
            title="Could not load recent failures"
            body="list_platform_recent_errors did not return. The counters above are unaffected."
            actions={
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void reload()}>
                <span className="btn-label">Try again</span>
              </button>
            }
          />
        ) : (
          <>
            <DataTable
              columns={failureColumns}
              rows={failureGroups}
              rowKey={(row) => row.action}
              stacked
              loading={loading}
              caption="Recent failed audit events grouped by action"
              empty={
                <StateBlock
                  variant="empty"
                  title="No failed or attempted audit rows"
                  body="The query returned no rows. Given how little writes a failed status, this is the expected reading and is not evidence that nothing failed."
                />
              }
            />
            <p className="form-hint">
              Occurrences are counted within those {formatNumber(RECENT_ERROR_LIMIT)} rows, not over a
              period: <span className="mono">list_platform_recent_errors</span> accepts a limit and no date
              range. The 24-hour figures above come from a different query and the two will not agree.
            </p>
          </>
        )}
      </section>

      {/* ── Incidents ─────────────────────────────────────────────── */}
      <Disclosure summary="Incidents"><section className="card" aria-labelledby="health-incidents">
        <SectionHead id="health-incidents" title="Incidents" />

        <StateBlock
          variant="unavailable"
          title="Not configured"
          body={
            <>
              There is no incident table, so there is nothing to acknowledge, assign or resolve — and no
              incident list is rendered, because an empty list would read as &quot;no incidents&quot; when
              the truth is that incidents cannot be recorded.
            </>
          }
        />

        <Disclosure summary="What the backend would need">
          <pre className="code-panel">{`-- NOT PRESENT IN THIS REPOSITORY. Specification only.
CREATE TABLE public.platform_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT NOT NULL UNIQUE,      -- quotable, e.g. INC-2026-0007
  title           TEXT NOT NULL,
  severity        TEXT NOT NULL
    CHECK (severity IN ('low','normal','high','urgent')),
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','resolved')),
  summary         TEXT NOT NULL,             -- what is happening, in operator language
  signal_keys     TEXT[] NOT NULL DEFAULT '{}',  -- which signals opened / belong to it
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES public.users(id),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES public.users(id),
  resolution_note TEXT,
  -- The workflow is enforced by the table, not by the screen:
  CHECK (status <> 'acknowledged' OR acknowledged_at IS NOT NULL),
  CHECK (status <> 'resolved' OR (resolved_at IS NOT NULL AND resolution_note IS NOT NULL))
);

CREATE INDEX idx_platform_incidents_open
  ON public.platform_incidents(status, severity, opened_at DESC)
  WHERE status <> 'resolved';`}</pre>
          <DefList
            rows={[
              {
                term: 'open_platform_incident',
                value:
                  'p_title, p_severity, p_summary, p_signal_keys → one incident from a group of failures, so the same failure arriving 300 times opens one incident rather than 300.',
              },
              {
                term: 'list_platform_incidents',
                value: 'p_status, p_severity, p_limit, p_offset → the incident list, unresolved first.',
              },
              {
                term: 'acknowledge_platform_incident',
                value: 'p_incident_id → stamps acknowledged_at and acknowledged_by.',
              },
              {
                term: 'resolve_platform_incident',
                value:
                  'p_incident_id, p_resolution_note → stamps resolved_at and resolved_by. The note is mandatory.',
              },
            ]}
          />
        </Disclosure>
      </section>
      </Disclosure>

      {/* ── Scheduler: a real operational gap ─────────────────────── */}
      <section className="card" aria-labelledby="health-scheduler">
        <SectionHead
          id="health-scheduler"
          title="Scheduled work"
          sub="One sweep exists in the codebase; nothing calls it."
        />

        <div className="callout callout-danger">
          <div>
            <p className="callout-title">
              <span className="mono">expire_stale_developer_state()</span> is never called by anything
            </p>
            <p className="callout-text">
              The function exists and works — it expires lapsed developer grants, sessions that outlived their
              grant and over-time impersonation sessions — but it has no caller: no{' '}
              <span className="mono">cron.schedule</span>, no pg_cron extension and no job runner anywhere in
              this repository. Until something calls it, a lapsed grant keeps reading as active.
            </p>
          </div>
        </div>

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">Two more things nothing sweeps</p>
            <p className="callout-text">
              <span className="mono">organization_products.expires_at</span> is the date that gates a
              business&apos;s access, and no function moves a row to{' '}
              <span className="mono">expired</span> when it passes: access ends only when a seat check next
              runs. An expired{' '}
              <span className="mono">activation_keys</span> key is refused at redemption but its stored status
              stays <span className="mono">issued</span> forever — nothing anywhere sets a key to{' '}
              <span className="mono">expired</span>.
            </p>
          </div>
        </div>

        <Disclosure summary="What the backend would need">
          <pre className="code-panel">{`-- NOT PRESENT IN THIS REPOSITORY. Specification only.
CREATE TABLE public.job_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key      TEXT NOT NULL,          -- 'expire_stale_developer_state', 'expire_lapsed_entitlements', ...
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','succeeded','failed')),
  rows_changed INTEGER,                -- the sweep already returns this
  error        TEXT
);

CREATE INDEX idx_job_runs_key ON public.job_runs(job_key, started_at DESC);`}</pre>
          <DefList
            rows={[
              {
                term: 'expire-stale-developer-state',
                value: (
                  <>
                    Every 15 minutes:{' '}
                    <span className="mono">SELECT public.expire_stale_developer_state()</span>, writing a{' '}
                    <span className="mono">job_runs</span> row with the returned row count.
                  </>
                ),
              },
              {
                term: 'expire-lapsed-entitlements',
                value:
                  'Daily: moves organization_products past expires_at to expired and records the count. That sweep does not exist either.',
              },
              {
                term: 'expire-activation-keys',
                value:
                  'Daily: moves activation_keys past valid_until to expired, so the key list stops showing lapsed keys as issued.',
              },
              {
                term: 'How this page would report it',
                value:
                  'From job_runs: last started_at and last status per job_key, so Background jobs gets a real Last checked instead of Not configured.',
              },
            ]}
          />
        </Disclosure>
      </section>

      <p className="section-sub">
        Nothing on this page alerts anyone: no threshold, no notification path and no history. Every reading
        is taken when you press Refresh and is gone on the next load.
      </p>
    </>
  );
}
