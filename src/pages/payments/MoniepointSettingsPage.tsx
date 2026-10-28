import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { MerchantPaymentService, type MerchantRegister, type MoniepointConnection, type MoniepointTerminal } from '../../services/merchantPayment.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { Card, CardHead, Page, PageHeader, Pill, btn, cn, inputClass } from '../../components/kit';

export default function MoniepointSettingsPage() {
  const { profile, user } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;
  const toast = useToast();
  const [connection, setConnection] = useState<MoniepointConnection | null>(null);
  const [terminals, setTerminals] = useState<MoniepointTerminal[]>([]);
  const [registers, setRegisters] = useState<MerchantRegister[]>([]);
  const [registerName, setRegisterName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [authMode, setAuthMode] = useState<'api_key' | 'client_credentials'>('api_key');
  const [apiKey, setApiKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [erpEnabled, setErpEnabled] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [nextConnection, nextTerminals, nextRegisters] = await Promise.all([
        MerchantPaymentService.connection(storeId), MerchantPaymentService.terminals(storeId),
        MerchantPaymentService.registers(storeId),
      ]);
      setConnection(nextConnection);
      setTerminals(nextTerminals);
      setRegisters(nextRegisters);
      setErpEnabled(nextConnection.erpEnabled);
      setAuthMode(nextConnection.authMode ?? (nextConnection.environment === 'sandbox' ? 'client_credentials' : 'api_key'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load payment settings');
    } finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!storeId) return;
    setSaving(true);
    try {
      await MerchantPaymentService.saveConnection(storeId, { authMode, apiKey, clientId, clientSecret, erpEnabled });
      setApiKey(''); setClientSecret('');
      toast.success('Moniepoint configuration saved');
      await load();
    } catch (cause) {
      toast.error('Connection was not saved', { description: cause instanceof Error ? cause.message : undefined });
    } finally { setSaving(false); }
  };

  const test = async () => {
    if (!storeId) return;
    setSaving(true);
    try {
      const message = await MerchantPaymentService.testConnection(storeId);
      toast.info(message);
      await load();
    } catch (cause) {
      toast.error('Connection test failed', { description: cause instanceof Error ? cause.message : undefined });
    } finally { setSaving(false); }
  };

  const disconnect = async () => {
    if (!storeId) return;
    setSaving(true);
    try {
      await MerchantPaymentService.disconnect(storeId);
      toast.success('Moniepoint disconnected');
      await load();
    } catch (cause) {
      toast.error('Could not disconnect', { description: cause instanceof Error ? cause.message : undefined });
    } finally { setSaving(false); }
  };

  const addRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!storeId || !user || !registerName.trim()) return;
    setSaving(true);
    try {
      await MerchantPaymentService.addRegister(storeId, user.id, registerName);
      setRegisterName('');
      toast.success('Checkout register added');
      await load();
    } catch (cause) { toast.error('Could not add register', { description: cause instanceof Error ? cause.message : undefined }); }
    finally { setSaving(false); }
  };

  if (permsLoading || loading) return <PageLoader />;
  if (!storeId) return <Page width="form"><Card><StateBlock variant="unavailable" title="Choose a workspace" body="Choose a business branch to manage payment terminals." /></Card></Page>;
  if (error) return <Page width="form"><Card><StateBlock variant="error" title="Payment settings unavailable" body={error}
    actions={<Button variant="outline" className="btn-sm" onClick={load}>Try again</Button>} /></Card></Page>;

  const canManage = hasPermission('store:update');
  const canManageDevices = hasPermission('devices:manage');
  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const statusText = connection?.status === 'connected' ? 'Credentials verified' :
    connection?.status === 'configured' ? 'Credentials stored; terminal not verified' :
    connection?.status === 'error' ? 'Connection needs attention' : 'Not connected';
  const statusTone = connection?.status === 'connected' ? 'success' : connection?.status === 'configured' ? 'brand' : connection?.status === 'error' ? 'danger' : 'neutral';
  const sideForms = canManage || canManageDevices;
  return (
    <Page>
      <PageHeader eyebrow="Payments" title="Moniepoint POS" subtitle="Customer payments collected on this business's Moniepoint terminals"
        actions={<Link className={btn('outline')} to="/payments">View payments</Link>} />

      <div className={cn('grid gap-4 lg:gap-6', sideForms && 'lg:grid-cols-[minmax(0,1fr)_360px]')}>
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          <Card aria-labelledby="connection-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="connection-title" className="m-0 text-[15px] font-semibold text-ink">Connection</h2>
              <div className="flex flex-wrap gap-1.5" aria-hidden="true">
                <Pill tone={statusTone}>{statusText}</Pill>
                <Pill tone={connection?.environment === 'sandbox' ? 'warn' : 'neutral'}>{connection?.environment === 'sandbox' ? 'Sandbox business' : 'Live business'}</Pill>
              </div>
            </div>
            <p className="sr-only">Status: {statusText} · {connection?.environment === 'sandbox' ? 'Sandbox business' : 'Live business'}</p>
            <p className="m-0 text-[13px] text-ink-2">Your Moniepoint terminal must have ERP integration enabled and run the supported terminal app before payment requests can reach it.</p>
            {connection?.status === 'configured' && <p className="m-0 mt-2 text-[13px] text-ink-2">The API key is stored, but has not been verified by a live terminal request.</p>}
            {connection && (!connection.amountUnitConfirmed || !connection.approvalCodesConfirmed) && (
              <div className="mt-3 rounded-lg bg-warn-soft px-4 py-3 text-[13px] text-warn-ink" role="status">POS payment verification is not ready. TrackOja's server operator must confirm Moniepoint's amount unit and approved response codes before payments can complete.</div>
            )}
            {canManage && connection?.status !== 'disconnected' && <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" disabled={saving} onClick={test}>Test connection</Button>
              <Button variant="ghost" disabled={saving} onClick={disconnect}>Disconnect</Button>
            </div>}
          </Card>

          <Card padded={false} className="overflow-hidden" aria-labelledby="terminals-title">
            <div className="flex flex-col gap-3 px-4 pb-4 pt-4 sm:flex-row sm:items-start sm:justify-between sm:px-5 sm:pt-5">
              <div className="min-w-0">
                <h2 id="terminals-title" className="m-0 text-[15px] font-semibold leading-[22px] text-ink">Terminals in this branch</h2>
                <p className="m-0 mt-0.5 text-[13px] text-ink-3">Only active Moniepoint terminals assigned to the current branch appear at checkout. Serial numbers are masked here.</p>
              </div>
              {canManageDevices && <Link className={cn(btn('outline', 'sm'), 'shrink-0 self-start')} to="/devices">Manage terminals</Link>}
            </div>
            {terminals.length ? <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">{terminals.map((terminal) => <li className="px-4 py-4 sm:px-5" key={terminal.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-medium text-ink">{terminal.name}{terminal.isDefault && <Pill tone="brand">Default</Pill>}</p>
                  <p className="m-0 mt-0.5 text-xs text-ink-3">Terminal ••••{terminal.serialLastFour} · {terminal.status} · {terminal.verifiedAt ? 'Verified by payment' : 'Not tested'}</p>
                </div>
                {canManageDevices && <div className="flex gap-2">
                  {!terminal.isDefault && terminal.status === 'active' && <Button variant="outline" className="btn-sm" disabled={saving}
                    onClick={async () => {
                      setSaving(true);
                      try { await MerchantPaymentService.setDefaultTerminal(terminal.id); await load(); toast.success('Default terminal updated'); }
                      catch (cause) { toast.error('Could not set default terminal', { description: cause instanceof Error ? cause.message : undefined }); }
                      finally { setSaving(false); }
                    }}>Set default</Button>}
                  <Link className={btn('ghost', 'sm')} to={`/devices/${terminal.id}`}>Manage</Link>
                </div>}
              </div>
              {canManageDevices && <div className="mt-3 max-w-xs">
                <label className={label} htmlFor={`terminal-register-${terminal.id}`}>Checkout register</label>
                <select id={`terminal-register-${terminal.id}`} className={inputClass} value={terminal.registerId ?? ''}
                  disabled={saving} onChange={async (event) => {
                    setSaving(true);
                    try { await MerchantPaymentService.assignRegister(terminal.id, event.target.value || null); await load();
                      toast.success('Terminal register updated'); }
                    catch (cause) { toast.error('Register assignment failed', { description: cause instanceof Error ? cause.message : undefined }); }
                    finally { setSaving(false); }
                  }}>
                  <option value="">No register assigned</option>
                  {registers.filter((register) => register.status === 'active').map((register) =>
                    <option key={register.id} value={register.id}>{register.name}</option>)}
                </select>
              </div>}
            </li>)}</ul> : <div className="px-4 pb-4 sm:px-5"><StateBlock title="No Moniepoint terminals" body="Add and activate a Moniepoint payment terminal for this branch." /></div>}
          </Card>
        </div>

        {sideForms && <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          {canManage && <form onSubmit={save}>
            <Card aria-labelledby="credentials-title">
              <CardHead title={<span id="credentials-title">{connection?.status === 'disconnected' ? 'Connect Moniepoint' : 'Replace credentials'}</span>}
                hint="Only the business owner can save provider credentials. Saved secrets cannot be viewed again." />
              <div className="mb-4"><label className={label} htmlFor="moniepoint-auth-mode">Credential type</label>
                <select id="moniepoint-auth-mode" className={inputClass} value={authMode}
                  onChange={(event) => setAuthMode(event.target.value as 'api_key' | 'client_credentials')}>
                  <option value="api_key" disabled={connection?.environment === 'sandbox'}>Moniepoint API key</option>
                  <option value="client_credentials">Client ID and secret</option>
                </select>
              </div>
              {authMode === 'api_key' ?
                <FormField id="moniepoint-api-key" label="API key" type="password" value={apiKey} onChange={setApiKey} required autoComplete="off" /> :
                <><FormField id="moniepoint-client-id" label="Client ID" value={clientId} onChange={setClientId} required autoComplete="off" />
                  <FormField id="moniepoint-client-secret" label="Client secret" type="password" value={clientSecret} onChange={setClientSecret} required autoComplete="off" /></>}
              <label className="mb-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-[13px] text-ink-2">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]" checked={erpEnabled} onChange={(event) => setErpEnabled(event.target.checked)} />
                I enabled ERP integration in Moniepoint for the terminals I will use.
              </label>
              <Button type="submit" className="w-full" loading={saving}>Save connection</Button>
            </Card>
          </form>}

          {canManageDevices && <form onSubmit={addRegister}>
            <Card aria-labelledby="registers-title">
              <CardHead title={<span id="registers-title">Checkout registers</span>} hint="Group terminals by counter or checkout within this branch." />
              {registers.length > 0 && <div className="mb-4 flex flex-wrap gap-1.5">
                {registers.map((register) => <Pill key={register.id} tone={register.status === 'active' ? 'neutral' : 'warn'}>{register.name}</Pill>)}
              </div>}
              <FormField id="register-name" label="New register name" value={registerName} onChange={setRegisterName} required />
              <Button type="submit" variant="outline" className="w-full" disabled={saving || registerName.trim().length < 2}>Add register</Button>
            </Card>
          </form>}
        </div>}
      </div>
    </Page>
  );
}
