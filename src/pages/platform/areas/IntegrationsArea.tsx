import { Link } from 'react-router-dom';
import { useBillingAvailability } from '../../../hooks/useBillingAvailability';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PlatformPageHead } from '../../../components/platform/PlatformPageHead';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { DefList } from '../../../components/ui/DefList';
import { SectionHead } from '../../../components/ui/SectionHead';
import { SectionState, StateBlock } from '../../../components/ui/StateBlock';
import { Button } from '../../../components/ui/Button';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { supabase } from '../../../config/supabase';
import { formatDateTime } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'integrations')!;

interface ServiceLocation {
  key: string;
  name: string;
  purpose: string;
  setup: string;
}

// These are setup locations, not a connection-status registry. The browser
// cannot read Edge Function secrets or the Supabase Auth SMTP configuration.
const SERVICE_LOCATIONS: ServiceLocation[] = [
  {
    key: 'paystack',
    name: 'Paystack',
    purpose: 'TrackOja subscription checkout and payment confirmation',
    setup: 'Server-side Edge Function secret and Paystack webhook settings',
  },
  {
    key: 'opay',
    name: 'OPay',
    purpose: 'Sandbox device payment requests',
    setup: 'Server-side Edge Function secret and OPay webhook settings',
  },
  {
    key: 'email',
    name: 'Authentication email',
    purpose: 'Account verification and password recovery',
    setup: 'Supabase Auth SMTP settings',
  },
];

type MoniepointHealth = Record<string, number | string | null>;

export default function IntegrationsArea() {
  const { environment, can } = usePlatform();
  const { billing, error: billingError, reload: reloadBilling } = useBillingAvailability();
  const canManage = can('platform:manage_integrations');
  const [moniepointHealth, setMoniepointHealth] = useState<MoniepointHealth | null>(null);
  const [moniepointError, setMoniepointError] = useState<string | null>(null);
  const [moniepointLoading, setMoniepointLoading] = useState(canManage);

  const refreshMoniepoint = useCallback(async () => {
    setMoniepointLoading(true);
    setMoniepointError(null);
    try {
      const { data, error } = await supabase.rpc('platform_moniepoint_health');
      if (error) {
        setMoniepointError(error.message);
      } else {
        setMoniepointHealth(data as MoniepointHealth);
      }
    } catch {
      setMoniepointError('Could not reach merchant payment diagnostics.');
    } finally {
      setMoniepointLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void refreshMoniepoint();
  }, [canManage, refreshMoniepoint]);

  const columns = useMemo<DataTableColumn<ServiceLocation>[]>(() => [
    {
      key: 'service',
      header: 'Service',
      sortValue: (row) => row.name.toLowerCase(),
      render: (row) => <span className="data-table-primary">{row.name}</span>,
    },
    { key: 'purpose', header: 'Used for', render: (row) => row.purpose },
    { key: 'setup', header: 'Configured in', render: (row) => row.setup },
  ], []);

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description={`Payment and account-email services for ${environment.label.toLowerCase()}. Merchant payment diagnostics are shown below when available.`}
      />

      <section className="card">
        <SectionHead title="Subscription billing" actions={<Button variant="outline" onClick={reloadBilling}>Refresh status</Button>} />
        {billingError ? <p role="alert">{billingError}</p> : billing ? <>
          <DefList rows={[
            { term: 'Payment system', value: billing.paymentSystem === 'DISABLED' ? 'Not configured ? payments disabled' : billing.paymentSystem === 'TEST' ? 'Test ? authorised sandbox businesses only' : 'Live mode selected ? server credentials required' },
            { term: 'Free trials', value: billing.trialEnabled ? `${billing.trialDays} days` : 'Disabled' },
          ]} />
          <p className="section-sub">Payment credentials stay on the server. A mode setting does not verify a provider connection. Existing paid subscriptions are preserved.</p>
          {can('platform:manage_settings') && <Link className="btn btn-outline" to="/platform/settings">Manage billing availability</Link>}
        </> : <p role="status">Loading billing availability?</p>}
      </section>
      {canManage && (
        <section className="card" aria-labelledby="moniepoint-platform-title">
          <SectionHead
            id="moniepoint-platform-title"
            title="Moniepoint merchant POS"
            sub="Customer payments to businesses, separate from TrackOja subscription billing"
            actions={<Button variant="outline" className="btn-sm" loading={moniepointLoading} onClick={refreshMoniepoint}>Refresh</Button>}
          />
          <SectionState
            loading={moniepointLoading}
            error={moniepointError}
            unavailable={!moniepointHealth ? 'Merchant payment diagnostics have not been returned.' : null}
            onRetry={refreshMoniepoint}
          >
            {moniepointHealth && <DefList rows={[
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
              {
                term: 'Average provider latency (24h)',
                value: moniepointHealth.averageLatencyMs24h == null ? 'No calls' : `${moniepointHealth.averageLatencyMs24h} ms`,
                muted: moniepointHealth.averageLatencyMs24h == null,
              },
              {
                term: 'Last credential verification',
                value: moniepointHealth.lastVerifiedAt ? formatDateTime(String(moniepointHealth.lastVerifiedAt)) : 'No verified connection',
                muted: !moniepointHealth.lastVerifiedAt,
              },
            ]} />}
          </SectionState>
          <p className="form-hint">Credentials and individual customer amounts are never returned here. A configured key is only marked verified after a real terminal transaction.</p>
        </section>
      )}

      <section className="card" aria-labelledby="integrations-services">
        <SectionHead
          id="integrations-services"
          title="Other service setup"
          sub="Where each service is configured; this list does not claim that a connection is healthy"
        />
        <DataTable
          columns={columns}
          rows={SERVICE_LOCATIONS}
          rowKey={(row) => row.key}
          stacked
          caption="Platform service setup locations"
        />
        <p className="form-hint">Keep payment keys in server-side secrets. This dashboard cannot display or change them.</p>
      </section>

      <section className="card" aria-labelledby="integrations-delivery">
        <SectionHead id="integrations-delivery" title="Delivery monitoring" />
        <StateBlock
          variant="unavailable"
          compact
          title="No webhook delivery history"
          body="Paystack and OPay delivery logs and connection tests are not available in this dashboard. Check the provider dashboard and Edge Function logs when a payment is missing."
        />
        <p className="form-hint">Application notification emails are not enabled yet. Supabase Auth handles account verification and password recovery email through its own SMTP settings.</p>
      </section>

      <AreaCoverage gaps={AREA.gaps} title="Current limits" />
    </>
  );
}
