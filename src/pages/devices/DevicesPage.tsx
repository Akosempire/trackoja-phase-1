import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { DeviceService } from '../../services/device.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Device, DeviceType, DeviceStatus, DeviceConnectivity } from '../../types';

const DEVICE_TYPES: { value: DeviceType; label: string }[] = [
  { value: 'payment_terminal', label: 'Payment terminal' },
  { value: 'scanner', label: 'Scanner' },
  { value: 'printer', label: 'Printer' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'mobile', label: 'Mobile' },
];

const DEVICE_STATUSES: DeviceStatus[] = ['pending', 'active', 'offline', 'maintenance', 'decommissioned'];
const DEVICE_CONNECTIVITY: DeviceConnectivity[] = ['online', 'offline', 'bluetooth', 'wifi', 'cellular'];

const STATUS_BADGES: Record<DeviceStatus, string> = {
  pending: 'badge-default',
  active: 'badge-success',
  offline: 'badge-warning',
  maintenance: 'badge-warning',
  decommissioned: 'badge-danger',
};

export default function DevicesPage() {
  const { user, profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceType>('payment_terminal');
  const [provider, setProvider] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<DeviceStatus>('pending');
  const [connectivity, setConnectivity] = useState<DeviceConnectivity | ''>('');
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const canManage = hasPermission('devices:manage');

  const loadDevices = () => {
    if (!storeId) return;
    setLoading(true);
    DeviceService.getDevices(storeId)
      .then(setDevices)
      .catch((err) => setError(err.message ?? 'Failed to load devices'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDevices();
  }, [storeId]);

  const resetForm = () => {
    setName('');
    setType('payment_terminal');
    setProvider('');
    setSerialNumber('');
    setModel('');
    setStatus('pending');
    setConnectivity('');
    setFirmwareVersion('');
    setEditingId(null);
  };

  const startEdit = (device: Device) => {
    setEditingId(device.id);
    setName(device.name);
    setType(device.type);
    setProvider(device.provider ?? '');
    setSerialNumber(device.serialNumber ?? '');
    setModel(device.model ?? '');
    setStatus(device.status);
    setConnectivity(device.connectivity ?? '');
    setFirmwareVersion(device.firmwareVersion ?? '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !user) return;

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await DeviceService.updateDevice(editingId, {
          name,
          status,
          provider: provider || undefined,
          serialNumber: serialNumber || undefined,
          model: model || undefined,
          firmwareVersion: firmwareVersion || undefined,
          connectivity: connectivity || undefined,
        });
      } else {
        await DeviceService.registerDevice(storeId, user.id, {
          name,
          type,
          provider: provider || undefined,
          serialNumber: serialNumber || undefined,
          model: model || undefined,
        });
      }
      resetForm();
      loadDevices();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save device');
    } finally {
      setSaving(false);
    }
  };

  const handleDecommission = async (device: Device) => {
    if (!confirm(`Decommission "${device.name}"? It can no longer be used to start a session.`)) return;
    setError(null);
    try {
      await DeviceService.updateDevice(device.id, { status: 'decommissioned' });
      if (editingId === device.id) resetForm();
      loadDevices();
    } catch (err: any) {
      setError(err.message ?? 'Failed to decommission device');
    }
  };

  if (loading || permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Devices</h1>
          <p className="page-subtitle">Payment terminals, scanners, printers, and other store hardware.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {canManage && (
        <form className="card" onSubmit={handleSubmit}>
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            {editingId ? 'Edit device' : 'Register device'}
          </p>
          <FormField id="device-name" label="Name" value={name} onChange={setName} required />
          <div className="form-group">
            <label className="form-label" htmlFor="device-type">
              Type
            </label>
            <select
              id="device-type"
              className="select-input"
              value={type}
              onChange={(e) => setType(e.target.value as DeviceType)}
              disabled={!!editingId}
            >
              {DEVICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <FormField id="device-provider" label="Provider" value={provider} onChange={setProvider} placeholder="Optional, e.g. opay" />
          <FormField id="device-serial" label="Serial number" value={serialNumber} onChange={setSerialNumber} placeholder="Optional" />
          <FormField id="device-model" label="Model" value={model} onChange={setModel} placeholder="Optional" />

          {editingId && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="device-status">
                  Status
                </label>
                <select
                  id="device-status"
                  className="select-input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DeviceStatus)}
                >
                  {DEVICE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="device-connectivity">
                  Connectivity
                </label>
                <select
                  id="device-connectivity"
                  className="select-input"
                  value={connectivity}
                  onChange={(e) => setConnectivity(e.target.value as DeviceConnectivity | '')}
                >
                  <option value="">Unknown</option>
                  {DEVICE_CONNECTIVITY.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <FormField
                id="device-firmware"
                label="Firmware version"
                value={firmwareVersion}
                onChange={setFirmwareVersion}
                placeholder="Optional"
              />
            </>
          )}

          <div className="btn-row">
            <Button type="submit" loading={saving} className="btn-sm">
              {editingId ? 'Save changes' : 'Register device'}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" onClick={resetForm} className="btn-sm">
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {devices.length === 0 ? (
        <div className="empty-state">No devices registered yet.</div>
      ) : (
        <div className="list">
          {devices.map((device) => (
            <div key={device.id} className="list-item">
              <div>
                <Link to={`/devices/${device.id}`} className="list-item-title">
                  {device.name}
                </Link>
                <p className="list-item-subtitle" style={{ textTransform: 'capitalize' }}>
                  {device.type.replace('_', ' ')}
                  {device.provider && ` · ${device.provider}`}
                  {device.serialNumber && ` · SN: ${device.serialNumber}`}
                </p>
              </div>
              <div className="list-item-meta">
                <span className={`badge ${STATUS_BADGES[device.status]}`} style={{ textTransform: 'capitalize' }}>
                  {device.status}
                </span>
                {device.connectivity && (
                  <span className="badge badge-default" style={{ textTransform: 'capitalize' }}>
                    {device.connectivity}
                  </span>
                )}
                {canManage && (
                  <div className="btn-row">
                    <Button variant="ghost" className="btn-sm" onClick={() => startEdit(device)}>
                      Edit
                    </Button>
                    {device.status !== 'decommissioned' && (
                      <Button variant="ghost" className="btn-sm" onClick={() => handleDecommission(device)}>
                        Decommission
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
