import { useEffect, useMemo, useState } from 'react';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PlatformPageHead } from '../../../components/platform/PlatformPageHead';
import { AttentionList } from '../../../components/ui/AttentionList';
import { Badge } from '../../../components/ui/Badge';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList } from '../../../components/ui/DefList';
import { Disclosure } from '../../../components/ui/Disclosure';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { formatDateTime } from '../../../utils/format';
import { supabase } from '../../../config/supabase';
import { Button } from '../../../components/ui/Button';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'integrations')!;

/**
 * The legacy static catalogue cannot read Edge secrets or test a connection.
 * `unknown` is therefore deliberate; merchant Moniepoint diagnostics below
 * come from a separate permission-controlled database function.
 */
interface IntegrationEntry {
  key: string;
  name: string;
  category: string;
  purpose: string;
  status: 'unknown' | 'not_configured';
  environment: 'test' | 'live' | null;
  /** Always null: no connection test exists, so nothing is ever checked. */
  lastCheckedAt: string | null;
  /** Always null: no delivery or call result is ever recorded. */
  lastError: string | null;
  /** Where the secret actually lives today. */
  credentialHome: string;
  /** Files that make the claim checkable. */
  codeRef: string;
  notes: string[];
}

/**
 * The three integrations that exist. Declared on the page because there is no
 * `integration_registry` table and no listing RPC; secret availability is
 * unknown from the browser even when the corresponding code exists.
 */
const INTEGRATIONS: IntegrationEntry[] = [
  {
    key: 'paystack',
    name: 'Paystack',
    category: 'Payments',
    purpose: 'Card and transfer payment for platform subscription plans.',
    status: 'unknown',
    environment: null,
    lastCheckedAt: null,
    lastError: null,
    credentialHome: 'PAYSTACK_SECRET_KEY, an Edge Function environment variable',
    codeRef: 'supabase/functions/paystack-initialize/index.ts, supabase/functions/paystack-webhook/index.ts',
    notes: [
      'HMAC-SHA512 over the raw body, compared with the x-paystack-signature header (paystack-webhook/index.ts, lines 20-53).',
      'Drives initiate_subscription_checkout, activate_subscription and mark_subscription_transaction_failed (20260614000031_subscriptions_functions.sql; activate_subscription re-issued by 20260927000089_platform_owner_hardening.sql, lines 117-255).',
      'A missing or misclassified Paystack secret now leaves checkout unavailable; no paid entitlement is granted by a mock fallback.',
    ],
  },
  {
    key: 'opay',
    name: 'OPay',
    category: 'Payments',
    purpose: 'Device payment requests raised by a store, confirmed by the OPay merchant webhook.',
    status: 'unknown',
    environment: null,
    lastCheckedAt: null,
    lastError: null,
    credentialHome: 'OPAY_SECRET_KEY, an Edge Function environment variable',
    codeRef: 'supabase/functions/opay-initiate-payment/index.ts, supabase/functions/opay-webhook/index.ts',
    notes: [
      'handle_opay_webhook resolves a device_transactions row by external_ref and is granted to service_role only (20260614000047_opay_webhook_functions.sql, lines 30-33 and 60). No platform RPC calls it, so this console cannot see, retry or reconcile a device payment.',
      'The legacy OPay endpoint targets a sandbox URL. Requests and webhook settlement are restricted to sandbox businesses; missing secrets and unsigned webhooks are refused.',
      'The secret must be set on the Edge Function; the platform settings table refuses credential-shaped keys and values.',
    ],
  },
  {
    key: 'email',
    name: 'Email delivery',
    category: 'Messaging',
    purpose: 'Verification, receipts and notification email for businesses and their staff.',
    status: 'not_configured',
    environment: null,
    lastCheckedAt: null,
    lastError: null,
    credentialHome: 'Supabase project auth SMTP settings, outside this database',
    codeRef: 'None — no sender exists anywhere in this repository',
    notes: [
      'notification_templates exists with no seeded rows and no dispatcher; the only function over it, list_notification_templates, reads (20260926000066_platform_operations_schema.sql, lines 87-100; 20260926000071, lines 977-1010).',
      'The only email sent at all is supabase.auth resendVerification — Supabase Auth using the project SMTP configuration, not an application sender (src/services/auth.service.ts).',
    ],
  },
];

/** The credential contract. None of this exists; it is what would be required. */
const CREDENTIAL_CONTRACT_SQL = `-- NOT PRESENT IN THIS REPOSITORY. Specification only.
CREATE TABLE public.integration_registry (
  key             TEXT PRIMARY KEY,          -- 'paystack' | 'opay' | 'email'
  name            TEXT NOT NULL,
  category        TEXT NOT NULL
    CHECK (category IN ('payments','messaging','logistics','identity')),
  environment     TEXT NOT NULL
    CHECK (environment IN ('test','live')),  -- separate rows, never one shared row
  status          TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured','configured','error')),
  -- A pointer, not a value. The secret itself never enters an ordinary table.
  secret_ref      TEXT,                      -- e.g. 'vault://integrations/paystack/live'
  secret_hint     TEXT,                      -- last four characters only
  last_checked_at TIMESTAMPTZ,               -- written only by a connection test
  last_error      TEXT,
  updated_by      UUID REFERENCES public.users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, environment)
);`;

/** The webhook ledger. None of this exists; it is what would be required. */
const WEBHOOK_EVENTS_SQL = `-- NOT PRESENT IN THIS REPOSITORY. Specification only.
CREATE TABLE public.webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,             -- 'paystack' | 'opay'
  event_type      TEXT,                      -- provider's own event name
  external_ref    TEXT,                      -- provider reference / external_ref
  payload         JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL,          -- a rejected signature is a row, not silence
  status          TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processed','ignored','failed','duplicate')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_webhook_events_provider
  ON public.webhook_events(provider, received_at DESC);
CREATE INDEX idx_webhook_events_failed
  ON public.webhook_events(status, received_at DESC)
  WHERE status IN ('failed','received');`;

export default function IntegrationsArea() {
  const { environment, can } = usePlatform();
  const [moniepointHealth, setMoniepointHealth] = useState<Record<string, number | string | null> | null>(null);
  const [moniepointError, setMoniepointError] = useState<string | null>(null);
  const [moniepointLoading, setMoniepointLoading] = useState(false);
  const refreshMoniepoint = async () => {
    setMoniepointLoading(true); setMoniepointError(null);
    const { data, error } = await supabase.rpc('platform_moniepoint_health');
    if (error) setMoniepointError(error.message);
    else setMoniepointHealth(data as Record<string, number | string | null>);
    setMoniepointLoading(false);
  };
  useEffect(() => { if (can('platform:manage_integrations')) void refreshMoniepoint(); }, []);

  // No fetch happens on this page and no refresh control is offered: a Refresh
  // button over three declared rows would imply a source that does not exist.
  const columns = useMemo<DataTableColumn<IntegrationEntry>[]>(
    () => [
      {
        key: 'integration',
        header: 'Integration',
        label: '',
        sortValue: (row) => row.name.toLowerCase(),
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.name}</span>
            <p className="data-table-secondary">{row.purpose}</p>
            <p className="data-table-secondary">
              Key <span className="mono">{row.key}</span>
            </p>
          </div>
        ),
      },
      { key: 'category', header: 'Category', sortValue: (row) => row.category, render: (row) => row.category },
      // These three cells render a real value when one exists; every row is null
      // today, so each falls through to No data.
      {
        key: 'environment',
        header: 'Environment',
        render: (row) =>
          row.environment ? (
            <Badge tone="outline">{row.environment === 'live' ? 'Live' : 'Test'}</Badge>
          ) : (
            <StatusBadge status="no_data" />
          ),
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
        render: (row) =>
          row.lastCheckedAt ? formatDateTime(row.lastCheckedAt) : <StatusBadge status="no_data" />,
      },
      {
        key: 'error',
        header: 'Last error',
        render: (row) =>
          row.lastError ? <span className="mono">{row.lastError}</span> : <StatusBadge status="no_data" />,
      },
    ],
    [],
  );

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description={`Payment gateways and email delivery in ${environment.label.toLowerCase()}. Server secret availability is unknown to this page unless a dedicated diagnostic reports it.`}
      />

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot do yet" />

      {can('platform:manage_integrations') && <section className="card" aria-labelledby="moniepoint-platform-title">
        <SectionHead id="moniepoint-platform-title" title="Moniepoint merchant POS"
          sub="Customer payments to businesses, separate from TrackOja subscription billing"
          actions={<Button variant="outline" className="btn-sm" loading={moniepointLoading} onClick={refreshMoniepoint}>Refresh</Button>} />
        {moniepointError ? <StateBlock variant="error" title="Moniepoint diagnostics unavailable" body={moniepointError}
          actions={<Button variant="outline" onClick={refreshMoniepoint}>Try again</Button>} /> :
          moniepointHealth ? <DefList rows={[
            { term: 'Live merchant connections', value: moniepointHealth.liveConnections ?? 0 },
            { term: 'Verified connections', value: moniepointHealth.verifiedConnections ?? 0 },
            { term: 'Active terminals', value: moniepointHealth.activeTerminals ?? 0 },
            { term: 'Live transactions today', value: moniepointHealth.liveTransactionsToday ?? 0 },
            { term: 'Successful today', value: moniepointHealth.liveSuccessfulToday ?? 0 },
            { term: 'Failed today', value: moniepointHealth.liveFailedToday ?? 0 },
            { term: 'Live requests awaiting status', value: moniepointHealth.livePending ?? 0 },
            { term: 'Live requests needing reconciliation', value: moniepointHealth.liveNeedsReconciliation ?? 0 },
            { term: 'Sandbox connections', value: moniepointHealth.sandboxConnections ?? 0 },
            { term: 'Sandbox requests awaiting status', value: moniepointHealth.sandboxPending ?? 0 },
            { term: 'Provider unavailable calls (24h)', value: moniepointHealth.providerUnavailable24h ?? 0 },
            { term: 'Provider rejected calls (24h)', value: moniepointHealth.providerRejected24h ?? 0 },
            { term: 'Average provider latency (24h)', value: moniepointHealth.averageLatencyMs24h == null
              ? 'No calls' : `${moniepointHealth.averageLatencyMs24h} ms`,
              muted: moniepointHealth.averageLatencyMs24h == null },
            { term: 'Last credential verification', value: moniepointHealth.lastVerifiedAt
              ? formatDateTime(String(moniepointHealth.lastVerifiedAt)) : 'No verified connection',
              muted: !moniepointHealth.lastVerifiedAt },
          ]} /> : <p className="page-subtitle">Loading redacted merchant payment diagnostics…</p>}
        <p className="form-hint">Credentials and individual customer amounts are not returned here. An API key is only marked configured until a real terminal transaction can verify it.</p>
      </section>}

      {/* ── The catalogue ─────────────────────────────────────────── */}
      <section className="card" aria-labelledby="integrations-catalogue">
        <SectionHead id="integrations-catalogue" title="Integrations" />
        <DataTable
          columns={columns}
          rows={INTEGRATIONS}
          rowKey={(row) => row.key}
          stacked
          caption="Platform integration code catalogue; secret state is unknown"
        />

        <AttentionList
          items={[
            {
              id: 'no-registry',
              tone: 'muted',
              title: 'No integrations registry',
              meta: 'These three rows are declared on this page: no table and no listing RPC holds them.',
            },
            {
              id: 'no-sender',
              tone: 'warning',
              title: 'No email sender exists',
              meta: 'No code, no credential, nothing to configure for email delivery.',
            },
            {
              id: 'webhook-discard',
              tone: 'warning',
              title: 'Both webhooks discard unknown events',
              meta: 'Answered 200 with no row written; an invalid signature is answered 401 and is also unrecorded.',
            },
          ]}
        />

        <p className="form-hint">
          <span className="mono">Last checked</span>, <span className="mono">Last error</span> and{' '}
          <span className="mono">Environment</span> read No data for every row: no connection test endpoint
          exists, and the key mode of the Paystack and OPay secrets is not recorded anywhere this application
          can read.
        </p>

        <Disclosure summary="Secrets, code references and verified notes">
          {INTEGRATIONS.map((entry) => (
            <div className="plat-section" key={entry.key}>
              <p className="list-item-title">
                {entry.name} <StatusBadge status={entry.status} />
              </p>
              <DefList
                rows={[
                  { term: 'Secret', value: <span className="mono">{entry.credentialHome}</span> },
                  { term: 'Code', value: <span className="mono">{entry.codeRef}</span> },
                ]}
              />
              <ul className="plat-coverage-list">
                {entry.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ))}
        </Disclosure>
      </section>

      <div className="callout callout-danger">
        <div>
          <p className="callout-title">A green indicator here would be fabricated</p>
          <p className="callout-text">
            Nothing on this page can test a connection: there is no reachability probe, no latency
            measurement and no delivery ledger. A webhook can be failing for a month and this page would
            still read Configured, because a failure has nowhere to be written down.
          </p>
        </div>
      </div>

      {/* ── Credentials ───────────────────────────────────────────── */}
      <section className="card" aria-labelledby="integrations-credentials">
        <SectionHead
          id="integrations-credentials"
          title="Credentials"
          sub="No credential can be entered from this page."
        />

        <StateBlock
          variant="unavailable"
          title="Not configured"
          body={
            <>
              This application has no secret store and no{' '}
              <span className="mono">integration_registry</span> table, so no credential form is rendered.
              The Paystack and OPay secrets exist only as Edge Function environment variables: describable
              here, not manageable.
            </>
          }
        />

        <Disclosure summary="How a credential store would work">
          <DefList
            rows={[
              {
                term: 'Where a credential is entered',
                value:
                  'Server-side, through a function that holds the write privilege — never a browser form that stores it where the browser can read it.',
              },
              {
                term: 'What the browser may receive',
                value: (
                  <>
                    A masked hint only, typically the last four characters:{' '}
                    <span className="secret-mask">sk_live_••••••••4f2a</span>
                  </>
                ),
              },
              {
                term: 'What must never reach the browser',
                value:
                  'The secret in full — not on save, not on a reveal control, not in an error message or a log line.',
              },
              {
                term: 'Test and live',
                value:
                  'Separate rows with separate secrets and references. Mixing them is how a test run charges a real card.',
              },
              {
                term: 'Why not platform_settings',
                value:
                  'It refuses credential-shaped keys and values, and only accepts settings a migration has declared (20260927000089_platform_owner_hardening.sql, lines 1066-1095).',
              },
            ]}
          />
        </Disclosure>

        <Disclosure summary="What the backend would need">
          <pre className="code-panel">{CREDENTIAL_CONTRACT_SQL}</pre>
          <DefList
            rows={[
              {
                term: 'set_integration_credential',
                value:
                  'p_key, p_environment, p_secret → writes the secret into Supabase Vault, sets secret_hint to the last four characters and returns { key, environment, secret_hint }. An Edge Function, not a database function: a database argument is visible in pg_stat_activity and in logs.',
              },
              {
                term: 'test_integration_connection',
                value:
                  'p_key, p_environment → { ok, latency_ms, checked_at, error }. The single missing piece behind every Last checked cell above.',
              },
              {
                term: 'list_integration_registry',
                value: 'Returns the catalogue with the masked hint, never the secret.',
              },
              {
                term: 'clear_integration_credential',
                value:
                  'p_key, p_environment → removes the Vault entry and sets status back to not_configured, so a leaked secret can be rotated without a database edit.',
              },
            ]}
          />
        </Disclosure>
      </section>

      {/* ── Webhook health ────────────────────────────────────────── */}
      <section className="card" aria-labelledby="integrations-webhooks">
        <SectionHead
          id="integrations-webhooks"
          title="Webhook health and reconciliation"
          sub="What the two live webhooks do with an event."
        />

        <StateBlock
          variant="unavailable"
          title="Not configured"
          body="No webhook event is stored anywhere, so there is no delivery history to show, no failed delivery to inspect and no replay."
        />

        <div className="callout callout-danger">
          <div>
            <p className="callout-title">Nothing reaches this page when a webhook breaks</p>
            <p className="callout-text">
              A verified event the handler cannot map is acknowledged with 200 and no row is written, and a
              failure inside the handler is logged and still answered 200 — so an activation that threw can
              never be replayed. An invalid signature returns 401 with no record. A broken, forged or quiet
              webhook all look the same here.
            </p>
          </div>
        </div>

        <Disclosure summary="What the backend would need">
          <pre className="code-panel">{WEBHOOK_EVENTS_SQL}</pre>
          <DefList
            rows={[
              {
                term: 'list_webhook_events',
                value:
                  'p_provider, p_status, p_from, p_to, p_limit, p_offset → the ledger, newest first, including ignored rows and failed signatures.',
              },
              {
                term: 'get_webhook_event',
                value: 'p_event_id → one event with its payload, attempts and last_error.',
              },
              {
                term: 'retry_webhook_event',
                value: 'p_event_id → re-runs the handler for a failed event and increments attempts.',
              },
              {
                term: 'webhook_health_summary',
                value:
                  'p_provider → { last_received_at, received_24h, failed_24h, invalid_signature_24h }. This is what would turn Last checked from No data into a measurement.',
              },
            ]}
          />
        </Disclosure>
      </section>

      {/* ── Operator instructions, explicitly not status ──────────── */}
      <section className="card" aria-labelledby="integrations-setup">
        <SectionHead
          id="integrations-setup"
          title="Operator setup and troubleshooting"
          sub="Runbook only: this page does not check whether any of it was done."
        />

        <Disclosure summary="Setup runbook and troubleshooting">
          <ul className="list">
            <li className="list-item">
              <div>
                <p className="list-item-title">Paystack: set the secret and the webhook URL</p>
                <p className="list-item-subtitle">
                  Run <span className="mono">supabase secrets set PAYSTACK_SECRET_KEY=sk_...</span>, then
                  point the Paystack dashboard webhook at the deployed{' '}
                  <span className="mono">paystack-webhook</span> URL and subscribe to{' '}
                  <span className="mono">charge.success</span> and{' '}
                  <span className="mono">charge.failed</span>. A missing live secret makes checkout unavailable.
                </p>
              </div>
            </li>
            <li className="list-item">
              <div>
                <p className="list-item-title">OPay: set the secret before registering the webhook</p>
                <p className="list-item-subtitle">
                  Configure the secret in Supabase before testing. A missing secret causes the request and
                  webhook to fail closed. The legacy endpoint uses a sandbox URL and is limited to sandbox businesses.
                </p>
              </div>
            </li>
            <li className="list-item">
              <div>
                <p className="list-item-title">Email: configure SMTP in the Supabase project</p>
                <p className="list-item-subtitle">
                  Project Settings → Auth → SMTP. It lives in the Supabase project configuration, not in this
                  database, so this page cannot read the setting back.
                </p>
              </div>
            </li>
            <li className="list-item">
              <div>
                <p className="list-item-title">Troubleshooting: a webhook returning 401</p>
                <p className="list-item-subtitle">
                  The signature did not match, which usually means the secret on the function and the signing
                  secret in the provider dashboard differ. No row is written for this case, so the only
                  evidence is the Edge Function log.
                </p>
              </div>
            </li>
            <li className="list-item">
              <div>
                <p className="list-item-title">
                  Troubleshooting: a provider reports delivery but nothing changed
                </p>
                <p className="list-item-subtitle">
                  The handler swallowed the error and still answered 200, so the provider will not retry.
                  Look for the error line in the Edge Function log. For OPay, a{' '}
                  <span className="mono">Device transaction not found</span> error means the reference belongs
                  to a store in another project or environment — handle_opay_webhook resolves
                  device_transactions by external_ref alone.
                </p>
              </div>
            </li>
          </ul>
        </Disclosure>
      </section>

      <section className="card" aria-labelledby="integrations-write-path">
        <SectionHead
          id="integrations-write-path"
          title="Read-only"
          sub="The write path does not exist, so there is nothing to edit here."
        />
        <p className="is-locked">
          Integration writes would require <span className="mono">platform:manage_integrations</span>. The
          key is declared (20260927000089_platform_owner_hardening.sql, line 382) but nothing consumes it, and
          you {can('platform:manage_integrations') ? 'hold' : 'do not hold'} it in this session. Either way
          there is no credential form, no connection test button and no toggle on this page.
        </p>
      </section>
    </>
  );
}
