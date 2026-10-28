import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ProductService } from '../../services/product.service';
import { StockLotService, type StockLot, type StockLotStatus, type StockLotType } from '../../services/stockLot.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Empty, Page, PageHeader, Pill, Stat, cn, inputClass } from '../../components/kit';
import { formatMoney } from '../../utils/format';
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

const STATUS_TONE: Record<StockLotStatus, 'success' | 'warn' | 'danger' | 'neutral'> = {
  available: 'success',
  quarantined: 'warn',
  expired: 'danger',
  depleted: 'neutral',
  written_off: 'danger',
};

const STATUS_LABEL: Record<StockLotStatus, string> = {
  available: 'Available',
  quarantined: 'Quarantined',
  expired: 'Expired',
  depleted: 'Sold out',
  written_off: 'Written off',
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
  const notSellable = lots.length - openLots.length;
  const expiringSoon = openLots.filter((l) => {
    const left = daysUntil(l.expiryDate);
    return left !== null && left <= 30;
  }).length;
  const tracksExpiry = config.showExpiry || lots.some((l) => l.expiryDate);
  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const lineItem = experience.terminology.lineItem.toLowerCase();

  const expiryText = (lot: StockLot) => {
    const left = daysUntil(lot.expiryDate);
    if (!lot.expiryDate || left === null) return null;
    if (left < 0) return { text: `expired ${Math.abs(left)}d ago`, tone: 'text-danger' };
    if (left === 0) return { text: 'expires today', tone: 'text-danger' };
    return { text: `expires in ${left}d`, tone: left <= 30 ? 'text-warn-ink' : '' };
  };

  return (
    <Page>
      <PageHeader title={config.title} subtitle={config.hint} />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      {lots.length > 0 && (
        <section className={cn('mb-4 grid grid-cols-2 gap-3 lg:mb-6 lg:gap-4', tracksExpiry ? 'lg:grid-cols-3' : 'lg:grid-cols-2')} aria-label="Stock summary">
          <Stat label="Sellable" value={openLots.length} hint={`of ${lots.length} received`} />
          <Stat label="Not sellable" value={notSellable} tone={notSellable ? 'warn' : undefined} hint="Sold out, held or expired" />
          {tracksExpiry && (
            <div className="col-span-2 lg:col-span-1">
              <Stat label="Expiring in 30 days" value={expiringSoon} tone={expiringSoon ? 'danger' : undefined} hint="Sell these first" />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 lg:col-start-3 lg:row-start-1">
          {canAdjust ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                receive();
              }}
              aria-labelledby="receive-stock-title"
            >
              <Card className="lg:sticky lg:top-6">
                <div className="mb-4">
                  <h2 id="receive-stock-title" className="m-0 text-[15px] font-semibold text-ink">Receive stock</h2>
                  <p className="m-0 mt-0.5 text-[13px] text-ink-3">Record what just arrived.</p>
                </div>
                <label className="mb-4 block">
                  <span className={label}>{experience.terminology.lineItem}</span>
                  <select
                    className={inputClass}
                    value={form.productId}
                    onChange={(e) => setForm({ ...form, productId: e.target.value })}
                    required
                  >
                    <option value="">Select a {lineItem}…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    id="lot-qty"
                    label={`Quantity (${experience.stock.defaultUnit})`}
                    value={config.quantityFixedToOne ? '1' : form.quantity}
                    onChange={(v) => setForm({ ...form, quantity: v })}
                    disabled={config.quantityFixedToOne}
                    inputMode="decimal"
                    required
                  />
                  <FormField
                    id="lot-cost"
                    label="Cost per unit (optional)"
                    value={form.costPerUnit}
                    onChange={(v) => setForm({ ...form, costPerUnit: v })}
                    inputMode="decimal"
                    placeholder="₦"
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

                <Button type="submit" loading={saving} disabled={!form.productId} className="mt-1 w-full">
                  Receive stock
                </Button>
              </Card>
            </form>
          ) : (
            <p className="m-0 rounded-lg bg-tray px-4 py-3 text-[13px] text-ink-2" role="note">
              You do not have permission to adjust stock. Ask the owner to grant it.
            </p>
          )}
        </div>

        <div className="min-w-0 lg:col-span-2 lg:row-start-1">
          {lots.length === 0 ? (
            <Empty
              title="No stock received yet"
              body={<>Add a {lineItem} first, then record what you received.</>}
            />
          ) : (
            <Card padded={false} className="overflow-hidden" aria-labelledby="lots-title">
              <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                <h2 id="lots-title" className="m-0 text-[15px] font-semibold text-ink">
                  {openLots.length} in stock
                  {notSellable ? <span className="font-normal text-ink-3"> · {notSellable} not sellable</span> : ''}
                </h2>
              </div>
              <ul className="m-0 list-none divide-y divide-line p-0">
                {lots.map((lot) => {
                  const expiry = expiryText(lot);
                  const sellable = lot.status === 'available' && lot.qtyAvailable > 0;
                  const used = lot.qtyReceived > 0 ? Math.min(lot.qtyAvailable / lot.qtyReceived, 1) : 0;
                  return (
                    <li key={lot.id} className={cn('px-4 py-3 sm:px-5', !sellable && 'bg-subtle/60')}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className={cn('m-0 truncate text-sm font-medium', sellable ? 'text-ink' : 'text-ink-2')}>{lot.productName}</p>
                            {lot.identifier && <span className="shrink-0 rounded bg-tray px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{lot.identifier}</span>}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-tray" aria-hidden="true">
                              <span className={cn('block h-full rounded-full', sellable ? 'bg-brand' : 'bg-line-strong')} style={{ width: `${Math.round(used * 100)}%` }} />
                            </span>
                            <p className="m-0 min-w-0 truncate text-xs tabular-nums text-ink-3">
                              {lot.qtyAvailable} of {lot.qtyReceived} {lot.unitOfMeasure}
                              {expiry && <span className={expiry.tone}> · {expiry.text}</span>}
                              {lot.costPerUnit ? ` · ${formatMoney(lot.costPerUnit)} each` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
                          <Pill tone={STATUS_TONE[lot.status] ?? 'neutral'}>{STATUS_LABEL[lot.status] ?? lot.status.replace('_', ' ')}</Pill>
                          {canAdjust && lot.status === 'available' && lot.qtyAvailable > 0 && (
                            <>
                              <Button
                                variant="ghost"
                                className="btn-sm"
                                onClick={() => applyStatus(lot, 'quarantined', 'Quarantined from stock screen')}
                              >
                                Quarantine
                              </Button>
                              <Button
                                variant="ghost"
                                className="btn-sm text-danger hover:text-danger"
                                onClick={() => setWritingOff(lot.id)}
                              >
                                Write off
                              </Button>
                            </>
                          )}
                          {canAdjust && lot.status === 'quarantined' && (
                            <Button
                              variant="outline"
                              className="btn-sm"
                              onClick={() => applyStatus(lot, 'available', 'Released from quarantine')}
                            >
                              Release
                            </Button>
                          )}
                        </div>
                      </div>

                      {writingOff === lot.id && (
                        <div className="mt-3 rounded-lg border border-line bg-subtle p-4">
                          <p className="m-0 mb-3 text-[13px] text-ink-2">
                            Writing off removes the remaining {lot.qtyAvailable} {lot.unitOfMeasure} from stock. This cannot be undone.
                          </p>
                          <FormField
                            id={`reason-${lot.id}`}
                            label="Reason for writing off (required)"
                            value={writeOffReason}
                            onChange={setWriteOffReason}
                            placeholder="e.g. Damaged in transit"
                          />
                          <div className="flex flex-wrap gap-2">
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
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
