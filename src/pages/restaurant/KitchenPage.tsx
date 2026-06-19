import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SaleService } from '../../services/sale.service';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Sale, OrderStatus } from '../../types';

const STATUS_ORDER: OrderStatus[] = ['new', 'preparing', 'ready', 'served'];

const STATUS_CONFIG: Record<OrderStatus, { label: string; emoji: string; next: OrderStatus | null; actionLabel: string; colorClass: string }> = {
  new:       { label: 'New',       emoji: '🆕', next: 'preparing', actionLabel: 'Start preparing', colorClass: 'kitchen-new' },
  preparing: { label: 'Preparing', emoji: '👨‍🍳', next: 'ready',     actionLabel: 'Mark ready',      colorClass: 'kitchen-preparing' },
  ready:     { label: 'Ready',     emoji: '✅', next: 'served',    actionLabel: 'Mark served',     colorClass: 'kitchen-ready' },
  served:    { label: 'Served',    emoji: '🍽️', next: null,         actionLabel: '',                colorClass: 'kitchen-served' },
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: '🪑 Dine-in',
  takeaway: '🥡 Takeaway',
  delivery: '🛵 Delivery',
};

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Kitchen</h1>
          <p className="page-subtitle">{active.length} active order{active.length === 1 ? '' : 's'} today</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {active.length === 0 && (
        <div className="empty-state">No active orders right now. Orders placed from checkout will appear here.</div>
      )}

      {byStatus.map(({ status, cfg, orders: statusOrders }) =>
        statusOrders.length === 0 ? null : (
          <div key={status} style={{ marginBottom: 20 }}>
            <p className="kitchen-section-label">
              {cfg.emoji} {cfg.label} ({statusOrders.length})
            </p>
            <div className="kitchen-grid">
              {statusOrders.map((order) => (
                <div key={order.id} className={`kitchen-card ${cfg.colorClass}`}>
                  <div className="kitchen-card-header">
                    <span className="kitchen-order-num">{order.saleNumber}</span>
                    <span className="kitchen-time">{formatTime(order.createdAt)}</span>
                  </div>
                  <div className="kitchen-meta">
                    {ORDER_TYPE_LABELS[order.orderType ?? ''] ?? order.orderType}
                    {order.tableNumber && <span> · Table {order.tableNumber}</span>}
                  </div>
                  {order.items && order.items.length > 0 && (
                    <ul className="kitchen-items">
                      {order.items.map((item) => (
                        <li key={item.id}>
                          <span className="kitchen-qty">×{item.quantity}</span> {item.productName}
                        </li>
                      ))}
                    </ul>
                  )}
                  {cfg.next && (
                    <button
                      type="button"
                      className="kitchen-advance-btn"
                      disabled={advancing === order.id}
                      onClick={() => advance(order)}
                    >
                      {advancing === order.id ? 'Updating…' : cfg.actionLabel}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {served.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className="kitchen-section-label" style={{ opacity: 0.5 }}>
            🍽️ Served today ({served.length})
          </p>
          <div className="kitchen-served-list">
            {served.map((o) => (
              <div key={o.id} className="kitchen-served-row">
                <span>{o.saleNumber}</span>
                <span>{ORDER_TYPE_LABELS[o.orderType ?? ''] ?? o.orderType}</span>
                {o.tableNumber && <span>Table {o.tableNumber}</span>}
                <span>{formatTime(o.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
