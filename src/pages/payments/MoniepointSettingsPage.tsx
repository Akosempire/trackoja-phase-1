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
  if (!storeId) return <StateBlock variant="unavailable" title="Choose a workspace" body="Choose a business branch to manage payment terminals." />;
  if (error) return <StateBlock variant="error" title="Payment settings unavailable" body={error}
    actions={<Button variant="outline" onClick={load}>Try again</Button>} />;

  const canManage = hasPermission('store:update');
  const canManageDevices = hasPermission('devices:manage');
  return (
    <div className="page">
      <div className="page-header"><div>
        <h1 className="page-title">Moniepoint POS</h1>
        <p className="page-subtitle">Customer payments collected on this business's Moniepoint terminals</p>
      </div></div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="list-item-title">Connection</h2>
        <p className="page-subtitle">Status: {connection?.status === 'connected' ? 'Credentials verified' :
          connection?.status === 'configured' ? 'Credentials stored; terminal not verified' :
          connection?.status === 'error' ? 'Connection needs attention' : 'Not connected'} ·
          {connection?.environment === 'sandbox' ? ' Sandbox business' : ' Live business'}</p>
        <p className="page-subtitle">Your Moniepoint terminal must have ERP integration enabled and run the supported terminal app before payment requests can reach it.</p>
        {connection?.status === 'configured' && <p className="page-subtitle">The API key is stored, but has not been verified by a live terminal request.</p>}
        {connection && (!connection.amountUnitConfirmed || !connection.approvalCodesConfirmed) && (
          <div className="alert alert-warning" role="status">POS payment verification is not ready. TrackOja's server operator must confirm Moniepoint's amount unit and approved response codes before payments can complete.</div>
        )}
        {canManage && connection?.status !== 'disconnected' && <div className="btn-row">
          <Button variant="outline" disabled={saving} onClick={test}>Test connection</Button>
          <Button variant="ghost" disabled={saving} onClick={disconnect}>Disconnect</Button>
        </div>}
      </div>

      {canManage && <form className="card" onSubmit={save} style={{ marginBottom: 16, maxWidth: 680 }}>
        <h2 className="list-item-title">{connection?.status === 'disconnected' ? 'Connect Moniepoint' : 'Replace credentials'}</h2>
        <p className="page-subtitle">Only the business owner can save provider credentials. Saved secrets cannot be viewed again.</p>
        <div className="form-group"><label className="form-label" htmlFor="moniepoint-auth-mode">Credential type</label>
          <select id="moniepoint-auth-mode" className="select-input" value={authMode}
            onChange={(event) => setAuthMode(event.target.value as 'api_key' | 'client_credentials')}>
            <option value="api_key" disabled={connection?.environment === 'sandbox'}>Moniepoint API key</option>
            <option value="client_credentials">Client ID and secret</option>
          </select>
        </div>
        {authMode === 'api_key' ?
          <FormField id="moniepoint-api-key" label="API key" type="password" value={apiKey} onChange={setApiKey} required autoComplete="off" /> :
          <><FormField id="moniepoint-client-id" label="Client ID" value={clientId} onChange={setClientId} required autoComplete="off" />
            <FormField id="moniepoint-client-secret" label="Client secret" type="password" value={clientSecret} onChange={setClientSecret} required autoComplete="off" /></>}
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input type="checkbox" checked={erpEnabled} onChange={(event) => setErpEnabled(event.target.checked)} />
          I enabled ERP integration in Moniepoint for the terminals I will use.
        </label>
        <div className="btn-row"><Button type="submit" loading={saving}>Save connection</Button></div>
      </form>}

      <div className="card">
        <h2 className="list-item-title">Terminals in this branch</h2>
        <p className="page-subtitle">Only active Moniepoint terminals assigned to the current branch appear at checkout. Serial numbers are masked here.</p>
        {terminals.length ? <div className="list">{terminals.map((terminal) => <div className="list-item" key={terminal.id}>
          <div><p className="list-item-title">{terminal.name}{terminal.isDefault ? ' · Default' : ''}</p>
            <p className="list-item-subtitle">Terminal ••••{terminal.serialLastFour} · {terminal.status} · {terminal.verifiedAt ? 'Verified by payment' : 'Not tested'}</p>
            {canManageDevices && <div className="form-group" style={{ marginTop: 8 }}>
              <label className="form-label" htmlFor={`terminal-register-${terminal.id}`}>Checkout register</label>
              <select id={`terminal-register-${terminal.id}`} className="select-input" value={terminal.registerId ?? ''}
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
            </div>}</div>
          {canManageDevices && <div className="btn-row">
            {!terminal.isDefault && terminal.status === 'active' && <Button variant="outline" className="btn-sm" disabled={saving}
              onClick={async () => {
                setSaving(true);
                try { await MerchantPaymentService.setDefaultTerminal(terminal.id); await load(); toast.success('Default terminal updated'); }
                catch (cause) { toast.error('Could not set default terminal', { description: cause instanceof Error ? cause.message : undefined }); }
                finally { setSaving(false); }
              }}>Set default</Button>}
            <Link className="btn btn-ghost btn-sm" to={`/devices/${terminal.id}`}>Manage</Link>
          </div>}
        </div>)}</div> : <StateBlock title="No Moniepoint terminals" body="Add and activate a Moniepoint payment terminal for this branch." />}
        {canManageDevices && <div className="btn-row"><Link className="btn btn-outline" to="/devices">Manage terminals</Link></div>}
      </div>
      {canManageDevices && <form className="card" onSubmit={addRegister} style={{ marginTop: 16, maxWidth: 680 }}>
        <h2 className="list-item-title">Checkout registers</h2>
        <p className="page-subtitle">Group terminals by counter or checkout within this branch.</p>
        <FormField id="register-name" label="New register name" value={registerName} onChange={setRegisterName} required />
        <div className="btn-row"><Button type="submit" disabled={saving || registerName.trim().length < 2}>Add register</Button></div>
      </form>}
    </div>
  );
}
