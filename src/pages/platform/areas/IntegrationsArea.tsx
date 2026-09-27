import { useMemo } from 'react';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PlatformPageHead } from '../../../components/platform/PlatformPageHead';
import { Badge } from '../../../components/ui/Badge';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList } from '../../../components/ui/DefList';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { formatDateTime } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'integrations')!;

/**
 * The shape a registry will have, so adding a fourth integration is a row and
 * not a rewrite.
 *
 * `status` deliberately offers two values only. There is no `connected`,
 * `healthy` or `degraded`, because deciding any of those needs a connection test
 * and no such endpoint exists — the field can only report whether the code and
 * its server-side secret are in place.
 *
 * `environment` is part of the shape because test and live credentials must
 * never be mixed, and it is null for all three entries for the same reason
 * `lastCheckedAt` is: nothing records it. The key mode of the Paystack and OPay
 * secrets is not readable from this application at all.
 */
interface IntegrationEntry {
  key: string;
  name: string;
  category: string;
  purpose: string;
  status: 'configured' | 'not_configured';
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
 * The three integrations that exist, with their real status.
 *
 * This array is declared in the page on purpose: there is no
 * `integration_registry` table and no listing RPC, so reading it from a service
 * would mean inventing an endpoint. Every `configured` below means "the code and
 * its server-side secret exist", never "it works"; when the registry lands these
 * rows come from it and the status can start measuring something.
 */
const INTEGRATIONS: IntegrationEntry[] = [
  {
    key: 'paystack',
    name: 'Paystack',
    category: 'Payments',
    purpose: 'Card and transfer payment for platform subscription plans.',
    status: 'configured',
    environment: null,
    lastCheckedAt: null,
    lastError: null,
    credentialHome: 'PAYSTACK_SECRET_KEY, an Edge Function environment variable',
    codeRef: 'supabase/functions/paystack-initialize/index.ts, supabase/functions/paystack-webhook/index.ts',
    notes: [
      'Signature verification is real: HMAC-SHA512 over the raw body, compared with the x-paystack-signature header (paystack-webhook/index.ts, lines 20-53).',
      'Drives initiate_subscription_checkout, activate_subscription and mark_subscription_transaction_failed (20260614000031_subscriptions_functions.sql; activate_subscription re-issued by 20260927000089_platform_owner_hardening.sql, lines 117-255).',
      'The checkout function runs in mock mode when the secret is unset: it activates the transaction immediately and returns a MOCK- access code (paystack-initialize/index.ts, lines 71-91). Nothing on this page can tell you which mode a deployment is in.',
    ],
  },
  {
    key: 'opay',
    name: 'OPay',
    category: 'Payments',
    purpose: 'Device payment requests raised by a store, confirmed by the OPay merchant webhook.',
    status: 'configured',
    environment: null,
    lastCheckedAt: null,
    lastError: null,
    credentialHome: 'OPAY_SECRET_KEY, an Edge Function environment variable',
    codeRef: 'supabase/functions/opay-initiate-payment/index.ts, supabase/functions/opay-webhook/index.ts',
    notes: [
      'Store-scoped and unreachable from any platform function: handle_opay_webhook resolves a device_transactions row by external_ref (20260614000047_opay_webhook_functions.sql, lines 30-33) and is granted to service_role only (line 60). No platform RPC calls it, so this dashboard cannot see, retry or reconcile a device payment.',
      'When OPAY_SECRET_KEY is unset the function skips signature verification entirely and only logs a warning (opay-webhook/index.ts, lines 56-69). In that configuration an unsigned POST to the webhook URL can move a transaction to success or failed, and nothing records that it happened.',
      'The secret has to be set on the Edge Function; the platform settings table refuses credential-shaped keys and values, so it cannot be stored here (20260927000089_platform_owner_hardening.sql, lines 1066-1084).',
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
      'notification_templates exists (20260926000066_platform_operations_schema.sql, lines 87-100) with no seeded rows and no dispatcher. The only function over it is list_notification_templates, which reads (20260926000071, lines 977-1010).',
      'The only email this application sends at all is through supabase.auth (src/services/auth.service.ts, resendVerification). That is Supabase Auth using the project SMTP configuration, not an application sender.',
      'So "email delivery" has no code, no credential and nothing to configure from here.',
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
            <p className="data-table-secondary">
              Secret: {row.credentialHome}
            </p>
            <p className="data-table-secondary">
              Code: <span className="mono">{row.codeRef}</span>
            </p>
          </div>
        ),
      },
      { key: 'category', header: 'Category', sortValue: (row) => row.category, render: (row) => row.category },
      // These three cells already render a real value when one exists; every row
      // is null today, so each falls through to No data. They are left unsortable
      // while every value is the same non-value, because a sort control there
      // would imply data that is not present.
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
        description={`Payment gateways, delivery and platform service connections in ${environment.label.toLowerCase()}. Status here reports what is configured, not what is working.`}
      />

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot do yet" />

      {/* ── The catalogue ─────────────────────────────────────────── */}
      <section className="card" aria-labelledby="integrations-catalogue">
        <SectionHead
          id="integrations-catalogue"
          title="Integrations"
          sub="Every integration this platform has, with the only status that can honestly be stated today."
        />
        <DataTable
          columns={columns}
          rows={INTEGRATIONS}
          rowKey={(row) => row.key}
          stacked
          caption="Platform integrations and their configured state"
        />
        <p className="form-hint">
          Neither <span className="mono">Last checked</span> nor{' '}
          <span className="mono">Last error</span> has a source: no connection test endpoint exists and no
          event or delivery result is ever persisted, so both read No data for every row. Environment is
          the same — the key mode of the Paystack and OPay secrets is not recorded anywhere this
          application can read.
        </p>
      </section>

      {/* The per-integration facts the table has no room for. Every one of them
          names the file it comes from, so nothing here has to be taken on trust. */}
      <section className="card" aria-labelledby="integrations-detail">
        <SectionHead
          id="integrations-detail"
          title="What each integration actually is"
          sub="Verified against the code in this repository, because no registry records any of it."
        />
        <ul className="list">
          {INTEGRATIONS.map((entry) => (
            <li className="list-item" key={entry.key}>
              <div>
                <p className="list-item-title">
                  {entry.name} <StatusBadge status={entry.status} />
                </p>
                <ul className="plat-coverage-list">
                  {entry.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="callout callout-danger">
        <div>
          <p className="callout-title">A green indicator here would be fabricated</p>
          <p className="callout-text">
            Nothing on this page can test a connection. There is no reachability probe, no latency
            measurement, no last-success timestamp and no delivery ledger, so a &quot;healthy&quot; light
            would be a hardcoded claim dressed as a measurement. Configured means the code path and its
            secret exist. A webhook can be failing for a month and this page would still show Configured,
            because a failure has nowhere to be written down.
          </p>
        </div>
      </div>

      {/* ── Credentials ───────────────────────────────────────────── */}
      <section className="card" aria-labelledby="integrations-credentials">
        <SectionHead
          id="integrations-credentials"
          title="Credentials"
          sub="How secrets are meant to be handled, and why this page cannot accept one today."
        />

        <DefList
          rows={[
            {
              term: 'Where a credential is entered',
              value:
                'Server-side, through a function that holds the write privilege. A provider secret must never be typed into a browser form that stores it in a table the browser can read.',
            },
            {
              term: 'What the browser may receive',
              value: (
                <>
                  A masked hint only, typically the last four characters, so an operator can confirm they
                  are looking at the right key:{' '}
                  <span className="secret-mask">sk_live_••••••••4f2a</span>
                </>
              ),
            },
            {
              term: 'What the browser must never receive',
              value:
                'The secret in full — not on save, not on a "reveal" control, not in an error message, and not in a log line. There is no legitimate reason for a platform console to re-display a provider secret it has already stored.',
            },
            {
              term: 'Test and live',
              value:
                'Separate rows with separate secrets and separate references, labelled. Mixing them is how a test run charges a real card, so the environment is part of the registry key rather than a field someone can forget to change.',
            },
            {
              term: 'Why not platform_settings',
              value: (
                <>
                  It refuses credential-shaped keys and values by design, and only accepts settings a
                  migration has already declared (20260927000089_platform_owner_hardening.sql, lines
                  1066-1095). The table comment states the intent: rows reference server-side secrets by
                  name (20260926000066_platform_operations_schema.sql, lines 79-81).
                </>
              ),
            },
          ]}
        />

        <StateBlock
          variant="unavailable"
          title="Not configured"
          body={
            <>
              This application has no secret store, so this page cannot accept a credential today and does
              not render a form that appears to. There is no <span className="mono">integration_registry</span>{' '}
              table, no <span className="mono">secret_ref</span> column and no Edge Function that writes to
              Supabase Vault. Paystack and OPay secrets exist only as Edge Function environment variables,
              which is why the credentials above can be described but not managed.
            </>
          }
        />

        <div className="plat-section">
          <p className="plat-section-sub">Required contract</p>
          <pre className="code-panel">{CREDENTIAL_CONTRACT_SQL}</pre>
          <DefList
            rows={[
              {
                term: 'set_integration_credential',
                value:
                  'An Edge Function, not a database function: a database function argument is visible in pg_stat_activity and in logs. It takes p_key, p_environment and p_secret, writes the secret into Supabase Vault (or the Edge Function secret store), sets secret_hint to the last four characters, and returns only { key, environment, secret_hint }.',
              },
              {
                term: 'test_integration_connection',
                value:
                  'p_key, p_environment → { ok, latency_ms, checked_at, error }. This is what would make a green light honest, and it is the single missing piece behind every Last checked cell above.',
              },
              {
                term: 'list_integration_registry',
                value:
                  'Returns the catalogue from the table instead of from this page, with the masked hint and never the secret.',
              },
              {
                term: 'clear_integration_credential',
                value:
                  'p_key, p_environment → removes the Vault entry and sets status back to not_configured. Rotating a leaked secret has to be a first-class action, not a database edit.',
              },
            ]}
          />
        </div>
      </section>

      {/* ── Webhook health ────────────────────────────────────────── */}
      <section className="card" aria-labelledby="integrations-webhooks">
        <SectionHead
          id="integrations-webhooks"
          title="Webhook health and reconciliation"
          sub="What the two live webhooks actually do with an event, and what is needed to see a failure."
        />

        <StateBlock
          variant="unavailable"
          title="Not configured"
          body="No webhook event is stored anywhere, so there is no delivery history to show, no failed delivery to inspect and no replay."
        />

        <div className="callout callout-danger">
          <div>
            <p className="callout-title">Today both webhooks discard unknown events and never record a signature failure</p>
            <p className="callout-text">
              A verified event with no reference, or with a status the provider maps to nothing, is
              acknowledged with 200 and no row is written — deliberately, so the provider stops retrying
              (paystack-webhook/index.ts, lines 69-74; opay-webhook/index.ts, lines 84-90). An invalid
              signature returns 401 with no record (paystack-webhook/index.ts, lines 48-53). And a failure
              inside the handler is written to the function log and still answered 200, so a
              subscription activation that threw can never be replayed (paystack-webhook/index.ts, lines
              100-107). The practical effect: a webhook can be broken, misconfigured or forged and this
              dashboard cannot tell the difference between that and a quiet week.
            </p>
          </div>
        </div>

        <div className="plat-section">
          <p className="plat-section-sub">Required table</p>
          <pre className="code-panel">{WEBHOOK_EVENTS_SQL}</pre>
        </div>

        <div className="plat-section">
          <p className="plat-section-sub">Required functions</p>
          <DefList
            rows={[
              {
                term: 'list_webhook_events',
                value:
                  'p_provider, p_status, p_from, p_to, p_limit, p_offset → the ledger, newest first, including the rows that were ignored and the rows whose signature failed.',
              },
              {
                term: 'get_webhook_event',
                value: 'p_event_id → one event with its payload, attempts and last_error.',
              },
              {
                term: 'retry_webhook_event',
                value:
                  'p_event_id → re-runs the handler for a failed event and increments attempts. Replay is the whole point of storing the payload.',
              },
              {
                term: 'webhook_health_summary',
                value:
                  'p_provider → { last_received_at, received_24h, failed_24h, invalid_signature_24h }. This is the query that would turn Last checked and Recent events from No data into a measurement.',
              },
            ]}
          />
        </div>

        <p className="plat-note">
          Writing the ledger is a change to the webhook functions themselves, not only a schema change:
          until paystack-webhook and opay-webhook insert a row before they act on it, no amount of
          read-side tooling can reconstruct what arrived.
        </p>
      </section>

      {/* ── Operator instructions, explicitly not status ──────────── */}
      <section className="card" aria-labelledby="integrations-setup">
        <SectionHead
          id="integrations-setup"
          title="Operator setup and troubleshooting"
          sub="Instructions to follow. Nothing here is a status indicator: this page does not check whether any of it was done."
        />

        <div className="callout callout-info">
          <div>
            <p className="callout-title">Read this as a runbook, not as state</p>
            <p className="callout-text">
              The steps below describe how to configure each integration from outside this application.
              They are deliberately kept out of the table above so they cannot be mistaken for something
              the platform has verified.
            </p>
          </div>
        </div>

        <ul className="list">
          <li className="list-item">
            <div>
              <p className="list-item-title">Paystack: set the secret and the webhook URL</p>
              <p className="list-item-subtitle">
                Run <span className="mono">supabase secrets set PAYSTACK_SECRET_KEY=sk_...</span> against
                the project, then point the Paystack dashboard webhook at the deployed{' '}
                <span className="mono">paystack-webhook</span> function URL and subscribe to{' '}
                <span className="mono">charge.success</span> and <span className="mono">charge.failed</span>
                . The function runs in mock mode until that secret exists, and mock mode activates a
                subscription without any payment.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">OPay: set the secret before registering the webhook</p>
              <p className="list-item-subtitle">
                Run <span className="mono">supabase secrets set OPAY_SECRET_KEY=...</span> first. Until it
                is set the webhook accepts unsigned posts, so registering the URL before the secret exists
                opens a window in which anyone who knows the URL can change a device transaction status.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">Email: configure SMTP in the Supabase project</p>
              <p className="list-item-subtitle">
                Project Settings → Auth → SMTP. This lives in the Supabase project configuration and not in
                this database, so this page cannot read the setting back, and nothing in this repository
                sends application email regardless of how it is configured.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">Troubleshooting: a webhook returning 401</p>
              <p className="list-item-subtitle">
                The signature did not match, which usually means the secret on the function and the signing
                secret in the provider dashboard differ. No row is written for this case, so the only
                evidence is the Edge Function log — which is also where the payload you need to replay is,
                until a webhook_events table exists.
              </p>
            </div>
          </li>
          <li className="list-item">
            <div>
              <p className="list-item-title">Troubleshooting: a provider reports delivery but nothing changed</p>
              <p className="list-item-subtitle">
                The handler swallowed the error and still answered 200, so the provider will not retry. Look
                for the error line in the Edge Function log. For OPay, a{' '}
                <span className="mono">Device transaction not found</span> error means the reference belongs
                to a store in another project or environment — handle_opay_webhook resolves
                device_transactions by external_ref alone (20260614000047_opay_webhook_functions.sql, lines
                30-33).
              </p>
            </div>
          </li>
        </ul>
      </section>

      <section className="card" aria-labelledby="integrations-write-path">
        <SectionHead
          id="integrations-write-path"
          title="Why there is nothing to edit"
          sub="This page is read-only because the write path does not exist, not because of your permissions."
        />
        <p className="is-locked">
          Integration writes would require <span className="mono">platform:manage_integrations</span>.
          The key is declared (20260927000089_platform_owner_hardening.sql, line 382) but nothing consumes
          it, and you {can('platform:manage_integrations') ? 'hold' : 'do not hold'} it in this session.
          Either way there is no credential form, no connection test button and no toggle on this page: a
          control that writes nowhere teaches an operator to distrust the console.
        </p>
      </section>

      <p className="section-sub">
        Configured state is described from the code in this repository. Every claim above names the file or
        migration it comes from so it can be checked; none of it is a live health measurement.
      </p>
    </>
  );
}
