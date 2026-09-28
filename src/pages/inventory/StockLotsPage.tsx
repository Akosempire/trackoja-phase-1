import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ProductService } from '../../services/product.service';
import { StockLotService, type StockLot, type StockLotStatus, type StockLotType } from '../../services/stockLot.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { getBusinessExperience } from '../../config/businessExperience';
import type { Product } from '../../types';
import { useToast } from '../../components/ui/Toast';

/**
 * How the receive form behaves for a business type's stock model. The database
 * enforces these rules regardless; this only shapes the form so a fabric seller is
 * asked for a roll number and a pharmacy for a batch and expiry.
 */
function lotFormConfig(model: string): {
  title: string;
  identifierLabel: string | null;
  identifierRequired: boolean;
  quantityFixedToOne: boolean;
  showExpiry: boolean;
  hint: string;
} {
  switch (model) {
    case 'roll':
      return {
        title: 'Rolls',
        identifierLabel: 'Roll number',
        identifierRequired: true,
        quantityFixedToOne: false,
        showExpiry: false,
        hint: 'Receive each roll separately and record its length. Sales are deducted from the roll you sell from.',
      };
    case 'batch':
      return {
        title: 'Stock & batches',
        identifierLabel: 'Batch number',
        identifierRequired: true,
        quantityFixedToOne: false,
        showExpiry: true,
        hint: 'Each batch carries its own quantity and expiry. Expired batches cannot be sold.',
      };
    case 'serial':
      return {
        title: 'Units',
        identifierLabel: 'Serial number or IMEI',
        identifierRequired: true,
        quantityFixedToOne: true,
        showExpiry: false,
        hint: 'Register each unit separately. A unit can only be sold once.',
      };
    default:
      return {
        title: 'Stock',
        identifierLabel: null,
        identifierRequired: false,
        quantityFixedToOne: false,
        showExpiry: false,
        hint: 'Record stock received. Products without batches keep their simple stock figure.',
      };
  }
}

const STATUS_BADGE: Record<StockLotStatus, string> = {
  available: 'badge-success',
  quarantined: 'badge-warning',
  expired: 'badge-danger',
  depleted: 'badge-default',
  written_off: 'badge-danger',
};

function daysUntil(dateish: string | null): number | null {
  if (!dateish) return null;
  const then = new Date(dateish);
  if (Number.isNaN(then.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  then.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - today.getTime()) / 86_400_000);
}

export default function StockLotsPage() {
  const toast = useToast();
  const { profile } = useAuth();
  const { category } = useBusinessContext();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const experience = getBusinessExperience(category);
  const config = lotFormConfig(experience.stock.model);
  const canAdjust = hasPermission('inventory:adjust');

  const [lots, setLots] = useState<StockLot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [writingOff, setWritingOff] = useState<string | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('');

  const [form, setForm] = useState({
    productId: '',
    quantity: '1',
    identifier: '',
    expiryDate: '',
    costPerUnit: '',
  });

  const load = useCallback(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // Stamp anything past its expiry before reading, so the list reflects reality.
    StockLotService.sweepExpired(storeId)
      .catch(() => 0)
      .then(() =>
        Promise.all([StockLotService.listLots(storeId), ProductService.getProducts(storeId)])
      )
      .then(([lotRows, productRows]) => {
        setLots(lotRows);
        setProducts(productRows.filter((p) => p.status === 'active'));
      })
      .catch((err) => setError(err?.message ?? 'Could not load stock'))
      .finally(() => setLoading(false));
  }, [storeId]);

  useEffect(load, [load]);

  const receive = async () => {
    if (!storeId || !form.productId) return;
    setSaving(true);
    setError(null);
    const toastId = toast.loading('Receiving stock…', { dedupeKey: 'stock-lot-receive' });
    try {
      const lot = await StockLotService.receiveLot({
        storeId,
        productId: form.productId,
        lotType: (experience.stock.model === 'variant'
          ? 'bulk'
          : experience.stock.model) as StockLotType,
        quantity: config.quantityFixedToOne ? 1 : Number(form.quantity),
        unitOfMeasure: experience.stock.defaultUnit,
        identifier: form.identifier.trim() || null,
        expiryDate: form.expiryDate || null,
        costPerUnit: form.costPerUnit.trim() ? Number(form.costPerUnit) : null,
      });
      toast.update(toastId, {
        variant: 'success',
        message: `Received ${lot.qtyReceived} ${lot.unitOfMeasure}`,
        description: lot.identifier ?? undefined,
      });
      setForm({ productId: '', quantity: '1', identifier: '', expiryDate: '', costPerUnit: '' });
      load();
    } catch (err) {
      const message = (err as Error)?.message ?? 'Could not receive stock';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Stock was not received', description: message });
    } finally {
      setSaving(false);
    }
  };

  const applyStatus = async (lot: StockLot, status: StockLotStatus, reason: string) => {
    setSaving(true);
    setError(null);
    const toastId = toast.loading('Updating stock status…', { dedupeKey: `stock-lot-${lot.id}` });
    try {
      await StockLotService.adjustLot(lot.id, status, reason);
      toast.update(toastId, { variant: 'success', message: `${lot.identifier ?? 'Stock'} marked ${status.replace('_', ' ')}` });
      setWritingOff(null);
      setWriteOffReason('');
      load();
    } catch (err) {
      const message = (err as Error)?.message ?? 'Could not update stock';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Stock was not updated', description: message });
    } finally {
      setSaving(false);
    }
  };

  if (loading || permsLoading) return <PageLoader />;

  const openLots = lots.filter((l) => l.qtyAvailable > 0 && l.status === 'available');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{config.title}</h1>
          <p className="page-subtitle">{config.hint}</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {canAdjust ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            receive();
          }}
        >
          <p className="list-item-title">Receive stock</p>
          <label className="form-group">
            <span className="form-label">{experience.terminology.lineItem}</span>
            <select
              className="select-input"
              value={form.productId}
              onChange={(e) => setForm({ ...form, productId: e.target.value })}
              required
            >
              <option value="">Select a {experience.terminology.lineItem.toLowerCase()}…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="auth-form-row">
            <FormField
              id="lot-qty"
              label={`Quantity (${experience.stock.defaultUnit})`}
              value={config.quantityFixedToOne ? '1' : form.quantity}
              onChange={(v) => setForm({ ...form, quantity: v })}
              disabled={config.quantityFixedToOne}
              required
            />
            <FormField
              id="lot-cost"
              label="Cost per unit (optional)"
              value={form.costPerUnit}
              onChange={(v) => setForm({ ...form, costPerUnit: v })}
            />
          </div>

          {config.identifierLabel && (
            <FormField
              id="lot-identifier"
              label={config.identifierLabel}
              value={form.identifier}
              onChange={(v) => setForm({ ...form, identifier: v })}
              required={config.identifierRequired}
            />
          )}

          {config.showExpiry && (
            <FormField
              id="lot-expiry"
              label="Expiry date"
              type="date"
              value={form.expiryDate}
              onChange={(v) => setForm({ ...form, expiryDate: v })}
            />
          )}

          <Button type="submit" loading={saving} disabled={!form.productId}>
            Receive stock
          </Button>
        </form>
      ) : (
        <div className="alert alert-error">
          You do not have permission to adjust stock. Ask the owner to grant it.
        </div>
      )}

      <div className="card">
        <p className="list-item-title">
          {openLots.length} in stock
          {lots.length !== openLots.length ? ` · ${lots.length - openLots.length} not sellable` : ''}
        </p>

        {lots.length === 0 ? (
          <div className="empty-state">
            Nothing received yet. Add a {experience.terminology.lineItem.toLowerCase()} first, then
            record what you received.
          </div>
        ) : (
          <div className="list">
            {lots.map((lot) => {
              const left = daysUntil(lot.expiryDate);
              return (
                <div className="list-item" key={lot.id}>
                  <div>
                    <p className="list-item-title">
                      {lot.productName}
                      {lot.identifier ? ` · ${lot.identifier}` : ''}
                    </p>
                    <p className="list-item-subtitle">
                      {lot.qtyAvailable} of {lot.qtyReceived} {lot.unitOfMeasure}
                      {lot.expiryDate
                        ? left !== null && left < 0
                          ? ` · expired ${Math.abs(left)}d ago`
                          : ` · expires in ${left}d`
                        : ''}
                    </p>
                  </div>
                  <div className="list-item-meta">
                    <span className={`badge ${STATUS_BADGE[lot.status] ?? 'badge-default'}`}>
                      {lot.status.replace('_', ' ')}
                    </span>
                    {canAdjust && lot.status === 'available' && lot.qtyAvailable > 0 && (
                      <>
                        <Button
                          variant="ghost"
                          className="btn-sm"
                          onClick={() => setWritingOff(lot.id)}
                        >
                          Write off
                        </Button>
                        <Button
                          variant="ghost"
                          className="btn-sm"
                          onClick={() => applyStatus(lot, 'quarantined', 'Quarantined from stock screen')}
                        >
                          Quarantine
                        </Button>
                      </>
                    )}
                    {canAdjust && lot.status === 'quarantined' && (
                      <Button
                        variant="ghost"
                        className="btn-sm"
                        onClick={() => applyStatus(lot, 'available', 'Released from quarantine')}
                      >
                        Release
                      </Button>
                    )}
                  </div>

                  {writingOff === lot.id && (
                    <div className="lot-writeoff">
                      <FormField
                        id={`reason-${lot.id}`}
                        label="Reason for writing off (required)"
                        value={writeOffReason}
                        onChange={setWriteOffReason}
                      />
                      <div className="btn-row">
                        <Button
                          variant="danger"
                          className="btn-sm"
                          loading={saving}
                          disabled={writeOffReason.trim().length < 3}
                          onClick={() => applyStatus(lot, 'written_off', writeOffReason)}
                        >
                          Confirm write-off
                        </Button>
                        <Button
                          variant="outline"
                          className="btn-sm"
                          onClick={() => {
                            setWritingOff(null);
                            setWriteOffReason('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
