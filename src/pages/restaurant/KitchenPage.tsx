import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SaleService } from '../../services/sale.service';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Empty, Page, PageHeader, btn, cn } from '../../components/kit';
import type { Sale, OrderStatus } from '../../types';

const STATUS_ORDER: OrderStatus[] = ['new', 'preparing', 'ready', 'served'];

type Tone = 'brand' | 'warn' | 'success' | 'neutral';

const STATUS_CONFIG: Record<OrderStatus, { label: string; hint: string; next: OrderStatus | null; actionLabel: string; tone: Tone; action: 'primary' | 'soft' | 'outline' }> = {
  new:       { label: 'New',       hint: 'Waiting to start', next: 'preparing', actionLabel: 'Start preparing', tone: 'brand',   action: 'soft' },
  preparing: { label: 'Preparing', hint: 'On the fire',      next: 'ready',     actionLabel: 'Mark ready',      tone: 'warn',    action: 'primary' },
  ready:     { label: 'Ready',     hint: 'Waiting to go out', next: 'served',   actionLabel: 'Mark served',     tone: 'success', action: 'outline' },
  served:    { label: 'Served',    hint: '',                 next: null,        actionLabel: '',                tone: 'neutral', action: 'outline' },
};

const TONE_BAR: Record<Tone, string> = { brand: 'bg-brand', warn: 'bg-warn', success: 'bg-success', neutral: 'bg-line-strong' };
const TONE_DOT: Record<Tone, string> = { brand: 'bg-brand', warn: 'bg-warn', success: 'bg-success', neutral: 'bg-ink-3' };

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function waitLabel(minutes: number): string {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function KitchenPage() {
  const { profile } = useAuth();
  const storeId = profile?.currentStoreId;

  const [orders, setOrders] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    const data = await SaleService.getKitchenOrders(storeId);
    setOrders(data);
  }, [storeId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));

    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const advance = async (sale: Sale) => {
    if (!sale.orderStatus) return;
    const cfg = STATUS_CONFIG[sale.orderStatus];
    if (!cfg.next) return;
    setAdvancing(sale.id);
    try {
      await SaleService.advanceOrderStatus(sale.id, cfg.next);
      await load();
    } finally {
      setAdvancing(null);
    }
  };

  if (loading) return <PageLoader />;

  const active = orders.filter((o) => o.orderStatus !== 'served');
  const served = orders.filter((o) => o.orderStatus === 'served');

  const byStatus = STATUS_ORDER.slice(0, 3).map((status) => ({
    status,
    cfg: STATUS_CONFIG[status],
    orders: active.filter((o) => o.orderStatus === status),
  }));

  const typeLabel = (order: Sale) => ORDER_TYPE_LABELS[order.orderType ?? ''] ?? order.orderType;

  return (
    <Page width="wide">
      <PageHeader
        title="Kitchen"
        subtitle={`${active.length} active order${active.length === 1 ? '' : 's'} today`}
        actions={
          <button type="button" className={btn('outline')} onClick={load}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
            Refresh
          </button>
        }
      />

      {active.length === 0 ? (
        <Empty title="Kitchen is clear" body="New restaurant orders will appear here as soon as they are placed." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3 lg:items-start lg:gap-5">
          {byStatus.map(({ status, cfg, orders: statusOrders }) => (
            <section key={status} aria-labelledby={`kitchen-${status}`}
              className={cn('min-w-0 lg:rounded-2xl lg:bg-tray lg:p-3', statusOrders.length === 0 && 'hidden lg:block')}>
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <h2 id={`kitchen-${status}`} className="m-0 flex items-center gap-2 text-base font-semibold text-ink">
                  <span className={cn('size-2.5 rounded-full', TONE_DOT[cfg.tone])} aria-hidden="true" />
                  {cfg.label}
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface px-2 text-[13px] font-semibold tabular-nums text-ink-2 shadow-card">
                    {statusOrders.length}
                  </span>
                </h2>
                <span className="text-[13px] text-ink-3">{cfg.hint}</span>
              </div>

              {statusOrders.length === 0 ? (
                <p className="m-0 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-3">No orders here</p>
              ) : (
                <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-1">
                  {statusOrders.map((order) => {
                    const waited = minutesSince(order.createdAt);
                    const late = status !== 'ready' && waited >= 20;
                    return (
                      <li key={order.id} className="min-w-0">
                        <Card padded={false} className="relative overflow-hidden">
                          <span className={cn('absolute inset-x-0 top-0 h-1', TONE_BAR[cfg.tone])} aria-hidden="true" />
                          <div className="p-4 pt-5 sm:p-5 sm:pt-6">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="m-0 text-2xl font-semibold leading-8 tabular-nums tracking-tight text-ink">#{order.saleNumber}</p>
                                <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
                                  <span className="font-medium">{typeLabel(order)}</span>
                                  {order.tableNumber && (
                                    <span className="inline-flex h-6 items-center rounded-md bg-tray px-2 text-[13px] font-semibold text-ink">Table {order.tableNumber}</span>
                                  )}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className={cn('m-0 text-base font-semibold tabular-nums', late ? 'text-danger' : 'text-ink')}>{waitLabel(waited)}</p>
                                <p className="m-0 mt-0.5 text-xs tabular-nums text-ink-3">{formatTime(order.createdAt)}</p>
                              </div>
                            </div>

                            {order.items && order.items.length > 0 && (
                              <ul className="m-0 mt-4 list-none divide-y divide-line border-y border-line p-0">
                                {order.items.map((item) => (
                                  <li key={item.id} className="flex items-baseline gap-3 py-2.5">
                                    <span className="w-9 shrink-0 text-lg font-bold tabular-nums text-ink">{item.quantity}×</span>
                                    <span className="min-w-0 text-[17px] font-medium leading-6 text-ink">{item.productName}</span>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {cfg.next && (
                              <button
                                type="button"
                                className={cn(btn(cfg.action, 'lg'), 'mt-4 w-full')}
                                disabled={advancing === order.id}
                                onClick={() => advance(order)}
                              >
                                {advancing === order.id ? 'Updating…' : cfg.actionLabel}
                              </button>
                            )}
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {served.length > 0 && (
        <section className="mt-8" aria-labelledby="kitchen-served">
          <h2 id="kitchen-served" className="m-0 mb-3 px-1 text-[15px] font-semibold text-ink-2">
            Served today <span className="tabular-nums text-ink-3">({served.length})</span>
          </h2>
          <Card padded={false} className="overflow-hidden">
            <ul className="m-0 list-none divide-y divide-line p-0">
              {served.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5">
                  <span className="w-20 shrink-0 font-semibold tabular-nums text-ink">#{o.saleNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {typeLabel(o)}
                    {o.tableNumber && <span> · Table {o.tableNumber}</span>}
                    {o.items?.length ? <span className="hidden text-ink-3 sm:inline"> · {o.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}</span> : null}
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-ink-3">{formatTime(o.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </Page>
  );
}
