import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { DeviceService } from '../../services/device.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Device, DeviceSession, DeviceTransaction, DeviceStatus } from '../../types';

const STATUS_BADGES: Record<DeviceStatus, string> = {
  pending: 'badge-default',
  active: 'badge-success',
  offline: 'badge-warning',
  maintenance: 'badge-warning',
  decommissioned: 'badge-danger',
};

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
  if (!device) return <div className="page">{error && <div className="alert alert-error">{error}</div>}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{device.name}</h1>
          <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>
            {device.type.replace('_', ' ')}
            {device.provider && ` · ${device.provider}`}
            {device.model && ` · ${device.model}`}
          </p>
        </div>
        <span className={`badge ${STATUS_BADGES[device.status]}`} style={{ textTransform: 'capitalize' }}>
          {device.status}
        </span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="total-row">
          <span>Serial number</span>
          <span>{device.serialNumber ?? '—'}</span>
        </div>
        <div className="total-row">
          <span>Firmware</span>
          <span>{device.firmwareVersion ?? '—'}</span>
        </div>
        <div className="total-row">
          <span>Connectivity</span>
          <span style={{ textTransform: 'capitalize' }}>{device.connectivity ?? '—'}</span>
        </div>
        <div className="total-row">
          <span>Battery level</span>
          <span>{device.batteryLevel !== undefined ? `${device.batteryLevel}%` : '—'}</span>
        </div>
        <div className="total-row grand">
          <span>Last seen</span>
          <span>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'Never'}</span>
        </div>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Session
        </p>
        {mySession ? (
          <>
            <div className="btn-row">
              <p className="page-subtitle" style={{ flex: 1 }}>
                You started a session at {new Date(mySession.startedAt).toLocaleString()}.
              </p>
              <Button className="btn-sm" loading={sessionActionLoading} onClick={handleEndSession}>
                End session
              </Button>
            </div>
            {mySession.sessionToken && (
              <div className="total-row" style={{ marginTop: 8 }}>
                <span>Device pairing token</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{mySession.sessionToken}</span>
              </div>
            )}
            {mySession.expiresAt && (
              <div className="total-row">
                <span>Token expires</span>
                <span>{new Date(mySession.expiresAt).toLocaleString()}</span>
              </div>
            )}
          </>
        ) : (
          <div className="btn-row">
            <p className="page-subtitle" style={{ flex: 1 }}>
              No active session for you on this device.
            </p>
            <Button
              className="btn-sm"
              loading={sessionActionLoading}
              disabled={device.status === 'decommissioned'}
              onClick={handleStartSession}
            >
              Start session
            </Button>
          </div>
        )}
      </div>

      {device.provider === 'opay' && device.status === 'active' && (
        <div className="card">
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            Send OPay payment request
          </p>
          {opayResult && <p className="page-subtitle">{opayResult}</p>}
          <div className="btn-row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <FormField
                id="opay-amount"
                label="Amount (NGN)"
                type="number"
                value={opayAmount}
                onChange={setOpayAmount}
                placeholder="e.g. 1500"
              />
            </div>
            <Button className="btn-sm" loading={opayLoading} onClick={handleInitiateOpayPayment}>
              Send request
            </Button>
          </div>
        </div>
      )}

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Session history
        </p>
        {sessions.length === 0 ? (
          <p className="page-subtitle">No sessions recorded yet.</p>
        ) : (
          <div className="list">
            {sessions.map((session) => (
              <div key={session.id} className="list-item">
                <div>
                  <p className="list-item-title" style={{ textTransform: 'capitalize' }}>
                    {session.status}
                  </p>
                  <p className="list-item-subtitle">
                    Started {new Date(session.startedAt).toLocaleString()}
                    {session.endedAt && ` · Ended ${new Date(session.endedAt).toLocaleString()}`}
                  </p>
                </div>
                {session.lastHeartbeatAt && (
                  <div className="list-item-meta">
                    <span className="list-item-subtitle">
                      Last heartbeat: {new Date(session.lastHeartbeatAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Transaction history
        </p>
        {transactions.length === 0 ? (
          <p className="page-subtitle">No device transactions recorded yet.</p>
        ) : (
          <div className="list">
            {transactions.map((txn) => (
              <div key={txn.id} className="list-item">
                <div>
                  <p className="list-item-title" style={{ textTransform: 'capitalize' }}>
                    {txn.transactionType.replace('_', ' ')}
                  </p>
                  <p className="list-item-subtitle">{new Date(txn.createdAt).toLocaleString()}</p>
                </div>
                <div className="list-item-meta">
                  {txn.amount !== undefined && (
                    <span className="list-item-subtitle">
                      {txn.currency} {txn.amount.toLocaleString()}
                    </span>
                  )}
                  <span
                    className={`badge ${
                      txn.status === 'success'
                        ? 'badge-success'
                        : txn.status === 'failed' || txn.status === 'cancelled'
                          ? 'badge-danger'
                          : 'badge-default'
                    }`}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {txn.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
