import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { DeviceService } from '../../services/device.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { Card, CardHead, Page, PageHeader, Pill, cn, inputClass } from '../../components/kit';
import { DevicesIcon } from '../../components/icons';
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

const STATUS_TONES: Record<DeviceStatus, 'neutral' | 'success' | 'warn' | 'danger'> = {
  pending: 'neutral',
  active: 'success',
  offline: 'warn',
  maintenance: 'warn',
  decommissioned: 'danger',
};

const label = 'text-[13px] font-medium text-ink-2';
const selectClass = cn(inputClass, 'disabled:bg-subtle disabled:text-ink-3');

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
  const formRef = useRef<HTMLDivElement>(null);

  // On a phone the form sits below the list, so bring it into view when editing starts.
  useEffect(() => {
    if (editingId) formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [editingId]);

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

  const field = (id: string, text: string, control: React.ReactNode) => (
    <div className="mb-4 flex min-w-0 flex-col gap-1.5">
      <label className={label} htmlFor={id}>{text}</label>
      {control}
    </div>
  );

  return (
    <Page>
      <PageHeader title="Devices" subtitle="Payment terminals, scanners, printers, and other store hardware." />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <div className={cn('grid items-start gap-4 lg:gap-6', canManage && 'lg:grid-cols-[minmax(0,1fr)_360px]')}>
        {devices.length === 0 ? (
          <Card>
            <StateBlock
              title="No devices registered"
              body="Register a payment terminal, scanner, printer, tablet, or mobile device to see it here."
            />
          </Card>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <ul className="m-0 list-none divide-y divide-line p-0" aria-label="Devices">
              {devices.map((device) => (
                <li key={device.id} className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-5', editingId === device.id && 'bg-brand-soft/40')}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span aria-hidden="true" className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-lg',
                      device.status === 'decommissioned' ? 'bg-tray text-ink-3' : 'bg-brand-soft text-brand-ink')}>
                      <DevicesIcon width={18} height={18} />
                    </span>
                    <div className="min-w-0">
                      <Link to={`/devices/${device.id}`} className="block truncate text-sm font-medium text-ink no-underline hover:text-brand-ink">
                        {device.name}
                      </Link>
                      <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                        <span className="capitalize">{device.type.replace('_', ' ')}</span>
                        {device.provider && ` · ${device.provider}`}
                        {device.serialNumber && ` · SN: ${device.serialNumber}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-[52px] sm:shrink-0 sm:pl-0">
                    <Pill tone={STATUS_TONES[device.status]}><span className="capitalize">{device.status}</span></Pill>
                    {device.connectivity && <Pill><span className="capitalize">{device.connectivity}</span></Pill>}
                    {canManage && (
                      <>
                        <Button variant="ghost" className="btn-sm" onClick={() => startEdit(device)}>
                          Edit
                        </Button>
                        {device.status !== 'decommissioned' && (
                          <Button variant="ghost" className="btn-sm" onClick={() => handleDecommission(device)}>
                            Decommission
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {canManage && (
          <div ref={formRef} className="min-w-0 scroll-mt-20 lg:sticky lg:top-6">
          <Card>
            <form onSubmit={handleSubmit} aria-labelledby="device-form-title">
              <CardHead title={<span id="device-form-title">{editingId ? 'Edit device' : 'Register device'}</span>}
                hint={editingId ? 'Type cannot be changed after registering' : 'Add hardware used in this store'} />
              <FormField id="device-name" label="Name" value={name} onChange={setName} required />
              {field('device-type', 'Type',
                <select
                  id="device-type"
                  className={selectClass}
                  value={type}
                  onChange={(e) => setType(e.target.value as DeviceType)}
                  disabled={!!editingId}
                >
                  {DEVICE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>)}
              <FormField id="device-provider" label="Provider" value={provider} onChange={setProvider} placeholder="Optional, e.g. opay" />
              <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <FormField id="device-serial" label="Serial number" value={serialNumber} onChange={setSerialNumber} placeholder="Optional" />
                <FormField id="device-model" label="Model" value={model} onChange={setModel} placeholder="Optional" />
              </div>

              {editingId && (
                <>
                  <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {field('device-status', 'Status',
                      <select
                        id="device-status"
                        className={cn(selectClass, 'capitalize')}
                        value={status}
                        onChange={(e) => setStatus(e.target.value as DeviceStatus)}
                      >
                        {DEVICE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>)}
                    {field('device-connectivity', 'Connectivity',
                      <select
                        id="device-connectivity"
                        className={cn(selectClass, 'capitalize')}
                        value={connectivity}
                        onChange={(e) => setConnectivity(e.target.value as DeviceConnectivity | '')}
                      >
                        <option value="">Unknown</option>
                        {DEVICE_CONNECTIVITY.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>)}
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

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {editingId && (
                  <Button type="button" variant="ghost" onClick={resetForm}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" loading={saving}>
                  {editingId ? 'Save changes' : 'Register device'}
                </Button>
              </div>
            </form>
          </Card>
          </div>
        )}
      </div>
    </Page>
  );
}
