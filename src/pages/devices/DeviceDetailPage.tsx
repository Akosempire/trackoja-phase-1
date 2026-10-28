import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { DeviceService } from '../../services/device.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { DefList } from '../../components/ui/DefList';
import { Card, CardHead, Page, Pill, btn, cn, inputClass } from '../../components/kit';
import { DevicesIcon } from '../../components/icons';
import type { Device, DeviceSession, DeviceTransaction, DeviceStatus } from '../../types';

const STATUS_TONES: Record<DeviceStatus, 'neutral' | 'success' | 'warn' | 'danger'> = {
  pending: 'neutral',
  active: 'success',
  offline: 'warn',
  maintenance: 'warn',
  decommissioned: 'danger',
};

const when = (value: string) => new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function DeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { user } = useAuth();

  const [device, setDevice] = useState<Device | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [transactions, setTransactions] = useState<DeviceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionActionLoading, setSessionActionLoading] = useState(false);
  const [opayAmount, setOpayAmount] = useState('');
  const [opayLoading, setOpayLoading] = useState(false);
  const [opayResult, setOpayResult] = useState<string | null>(null);

  const load = () => {
    if (!deviceId) return;
    setLoading(true);
    Promise.all([
      DeviceService.getDevice(deviceId),
      DeviceService.getDeviceSessions(deviceId),
      DeviceService.getDeviceTransactions(deviceId),
    ])
      .then(([d, s, t]) => {
        setDevice(d);
        setSessions(s);
        setTransactions(t);
      })
      .catch((err) => setError(err.message ?? 'Failed to load device'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [deviceId]);

  const mySession = sessions.find((s) => s.userId === user?.id && s.status === 'active');

  const handleStartSession = async () => {
    if (!deviceId) return;
    setSessionActionLoading(true);
    setError(null);
    try {
      await DeviceService.startDeviceSession(deviceId);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to start session');
    } finally {
      setSessionActionLoading(false);
    }
  };

  const handleEndSession = async () => {
    if (!mySession) return;
    setSessionActionLoading(true);
    setError(null);
    try {
      await DeviceService.endDeviceSession(mySession.id);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to end session');
    } finally {
      setSessionActionLoading(false);
    }
  };

  const handleInitiateOpayPayment = async () => {
    if (!deviceId) return;
    const amount = Number(opayAmount);
    if (!amount || amount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setOpayLoading(true);
    setError(null);
    setOpayResult(null);
    try {
      const result = await DeviceService.initiateOpayPayment({
        deviceId,
        amount,
        sessionId: mySession?.id,
      });
      setOpayResult(`Payment request sent. Reference: ${result.reference}`);
      setOpayAmount('');
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to initiate OPay payment');
    } finally {
      setOpayLoading(false);
    }
  };

  if (loading) return <PageLoader />;
  if (!device) {
    return (
      <Page>
        <Card>
          <StateBlock variant="error" title="Could not load this device" body={error ?? 'This device could not be found.'}
            actions={<Link className={btn('outline', 'sm')} to="/devices">Back to devices</Link>} />
        </Card>
      </Page>
    );
  }

  const meta = [device.provider, device.model].filter(Boolean).map((part) => ` · ${part}`).join('');
  const txnTone = (status: DeviceTransaction['status']) => status === 'success' ? 'success' : status === 'failed' || status === 'cancelled' ? 'danger' : 'neutral';
  const listHead = (id: string, title: string) => (
    <h2 id={id} className="m-0 px-4 pb-3 pt-4 text-[15px] font-semibold text-ink sm:px-5">{title}</h2>
  );

  return (
    <Page>
      <div className="mb-6 flex items-start gap-4 sm:items-center lg:mb-8">
        <span aria-hidden="true" className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <DevicesIcon width={24} height={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 break-words text-2xl font-semibold leading-8 tracking-tight text-ink lg:text-[28px] lg:leading-9">{device.name}</h1>
          <p className="m-0 mt-0.5 text-sm text-ink-2"><span className="capitalize">{device.type.replace('_', ' ')}</span>{meta}</p>
        </div>
        <span className="shrink-0 pt-1 sm:pt-0"><Pill tone={STATUS_TONES[device.status]}><span className="capitalize">{device.status}</span></Pill></span>
      </div>

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <div className="grid items-start gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-3 lg:row-start-1 lg:gap-6">
          <Card aria-labelledby="session-title">
            <CardHead title={<span id="session-title">Session</span>} />
            {mySession ? (
              <>
                <p className="m-0 mb-4 text-sm text-ink-2">
                  You started a session at {when(mySession.startedAt)}.
                </p>
                {(mySession.sessionToken || mySession.expiresAt) && (
                  <dl className="m-0 mb-4 space-y-2 rounded-lg bg-tray px-3.5 py-3">
                    {mySession.sessionToken && (
                      <div>
                        <dt className="text-xs text-ink-3">Device pairing token</dt>
                        <dd className="m-0 mt-0.5 break-all font-mono text-[13px] text-ink">{mySession.sessionToken}</dd>
                      </div>
                    )}
                    {mySession.expiresAt && (
                      <div>
                        <dt className="text-xs text-ink-3">Token expires</dt>
                        <dd className="m-0 mt-0.5 text-[13px] text-ink">{when(mySession.expiresAt)}</dd>
                      </div>
                    )}
                  </dl>
                )}
                <Button variant="outline" className="w-full" loading={sessionActionLoading} onClick={handleEndSession}>
                  End session
                </Button>
              </>
            ) : (
              <>
                <p className="m-0 mb-4 text-sm text-ink-2">
                  No active session for you on this device.
                </p>
                <Button
                  className="w-full"
                  loading={sessionActionLoading}
                  disabled={device.status === 'decommissioned'}
                  onClick={handleStartSession}
                >
                  Start session
                </Button>
              </>
            )}
          </Card>

          {device.provider === 'opay' && device.status === 'active' && (
            <Card aria-labelledby="opay-title">
              <CardHead title={<span id="opay-title">Send OPay payment request</span>} hint="The amount appears on the terminal for the customer" />
              {opayResult && <p className="m-0 mb-4 rounded-lg bg-success-soft px-3.5 py-2.5 text-[13px] text-success-ink" role="status">{opayResult}</p>}
              <div className="mb-4 flex min-w-0 flex-col gap-1.5">
                <label className="text-[13px] font-medium text-ink-2" htmlFor="opay-amount">Amount (NGN)</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3" aria-hidden="true">₦</span>
                  <input id="opay-amount" name="opay-amount" className={cn(inputClass, 'pl-7 tabular-nums')} type="number" inputMode="decimal"
                    value={opayAmount} onChange={(e) => setOpayAmount(e.target.value)} placeholder="e.g. 1500" />
                </div>
              </div>
              <Button variant="outline" className="w-full" loading={opayLoading} onClick={handleInitiateOpayPayment}>
                Send request
              </Button>
            </Card>
          )}

          <Card aria-labelledby="device-details-title">
            <CardHead title={<span id="device-details-title">Details</span>} />
            <DefList rows={[
              { term: 'Serial number', value: device.serialNumber ?? '—', muted: !device.serialNumber },
              { term: 'Firmware', value: device.firmwareVersion ?? '—', muted: !device.firmwareVersion },
              { term: 'Connectivity', value: <span className="capitalize">{device.connectivity ?? '—'}</span>, muted: !device.connectivity },
              { term: 'Battery level', value: device.batteryLevel !== undefined ? `${device.batteryLevel}%` : '—', muted: device.batteryLevel === undefined },
              { term: 'Last seen', value: device.lastSeenAt ? when(device.lastSeenAt) : 'Never', muted: !device.lastSeenAt },
            ]} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 lg:col-start-1 lg:row-start-1 lg:gap-6">
          <Card padded={false} className="overflow-hidden" aria-labelledby="session-history-title">
            {listHead('session-history-title', 'Session history')}
            {sessions.length === 0 ? (
              <p className="m-0 px-4 pb-5 text-sm text-ink-3 sm:px-5">No sessions recorded yet.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                {sessions.map((session) => (
                  <li key={session.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-medium capitalize text-ink">
                        {session.status}
                      </p>
                      <p className="m-0 mt-0.5 text-xs text-ink-3">
                        Started {when(session.startedAt)}
                        {session.endedAt && ` · Ended ${when(session.endedAt)}`}
                      </p>
                    </div>
                    {session.lastHeartbeatAt && (
                      <p className="m-0 shrink-0 text-xs text-ink-3">
                        Last heartbeat: {when(session.lastHeartbeatAt)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden" aria-labelledby="transaction-history-title">
            {listHead('transaction-history-title', 'Transaction history')}
            {transactions.length === 0 ? (
              <p className="m-0 px-4 pb-5 text-sm text-ink-3 sm:px-5">No device transactions recorded yet.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                {transactions.map((txn) => (
                  <li key={txn.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-medium capitalize text-ink">
                        {txn.transactionType.replace('_', ' ')}
                      </p>
                      <p className="m-0 mt-0.5 text-xs text-ink-3">{when(txn.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {txn.amount !== undefined && (
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {txn.currency} {txn.amount.toLocaleString()}
                        </span>
                      )}
                      <Pill tone={txnTone(txn.status)}><span className="capitalize">{txn.status}</span></Pill>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
