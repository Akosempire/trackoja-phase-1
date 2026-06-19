import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ProductService } from '../../services/product.service';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Product } from '../../types';

type ExpiryGroup = 'expired' | 'soon30' | 'soon90' | 'ok';

interface GroupedProduct {
  product: Product;
  expiryDate: Date;
  group: ExpiryGroup;
  daysLeft: number;
}

const GROUP_CONFIG: Record<ExpiryGroup, { label: string; color: string; description: string }> = {
  expired:  { label: 'Expired',              color: 'expiry-red',   description: 'Past expiry date' },
  soon30:   { label: 'Expiring within 30 days', color: 'expiry-amber', description: 'Urgent — remove or use first' },
  soon90:   { label: 'Expiring within 90 days', color: 'expiry-yellow', description: 'Check stock rotation' },
  ok:       { label: 'OK',                   color: 'expiry-green', description: 'Safe' },
};

const GROUP_ORDER: ExpiryGroup[] = ['expired', 'soon30', 'soon90', 'ok'];

function classify(expiryDate: Date, now: Date): { group: ExpiryGroup; daysLeft: number } {
  const ms = expiryDate.getTime() - now.getTime();
  const daysLeft = Math.floor(ms / 86400000);
  if (daysLeft < 0) return { group: 'expired', daysLeft };
  if (daysLeft <= 30) return { group: 'soon30', daysLeft };
  if (daysLeft <= 90) return { group: 'soon90', daysLeft };
  return { group: 'ok', daysLeft };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ExpiryAlertsPage() {
  const { profile } = useAuth();
  const storeId = profile?.currentStoreId;
  const navigate = useNavigate();

  const [groups, setGroups] = useState<Record<ExpiryGroup, GroupedProduct[]>>({
    expired: [], soon30: [], soon90: [], ok: [],
  });
  const [loading, setLoading] = useState(true);
  const [showOk, setShowOk] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    ProductService.getProducts(storeId)
      .then((products) => {
        const now = new Date();
        const result: Record<ExpiryGroup, GroupedProduct[]> = { expired: [], soon30: [], soon90: [], ok: [] };

        for (const product of products) {
          const rawDate = product.attributes?.expiryDate;
          if (!rawDate) continue;
          const expiryDate = new Date(rawDate);
          if (isNaN(expiryDate.getTime())) continue;
          const { group, daysLeft } = classify(expiryDate, now);
          result[group].push({ product, expiryDate, group, daysLeft });
        }

        for (const g of GROUP_ORDER) {
          result[g].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
        }
        setGroups(result);
      })
      .finally(() => setLoading(false));
  }, [storeId]);

  if (loading) return <PageLoader />;

  const alertCount = groups.expired.length + groups.soon30.length + groups.soon90.length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expiry Alerts</h1>
          <p className="page-subtitle">
            {alertCount > 0
              ? `${alertCount} product${alertCount === 1 ? '' : 's'} need attention`
              : 'All products are within safe expiry dates'}
          </p>
        </div>
      </div>

      {alertCount === 0 && groups.ok.length === 0 && (
        <div className="empty-state">
          No products have expiry dates recorded. Add expiry dates when creating or editing products.
        </div>
      )}

      {GROUP_ORDER.filter((g) => g !== 'ok').map((group) => {
        const cfg = GROUP_CONFIG[group];
        const items = groups[group];
        if (items.length === 0) return null;
        return (
          <div key={group} style={{ marginBottom: 20 }}>
            <p className={`expiry-section-label ${cfg.color}`}>
              {cfg.label} ({items.length}) — {cfg.description}
            </p>
            <div className="expiry-list">
              {items.map(({ product, daysLeft }) => (
                <div
                  key={product.id}
                  className={`expiry-row ${cfg.color}`}
                  onClick={() => navigate(`/inventory/products/${product.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/inventory/products/${product.id}`)}
                >
                  <div className="expiry-row-info">
                    <span className="expiry-product-name">{product.name}</span>
                    {product.sku && <span className="expiry-sku">{product.sku}</span>}
                  </div>
                  <div className="expiry-row-date">
                    <span className="expiry-date-str">{formatDate(product.attributes!.expiryDate!)}</span>
                    <span className="expiry-days-badge">
                      {daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {groups.ok.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowOk((v) => !v)}
          >
            {showOk ? 'Hide' : 'Show'} {groups.ok.length} safe product{groups.ok.length === 1 ? '' : 's'}
          </button>
          {showOk && (
            <div className="expiry-list" style={{ marginTop: 8 }}>
              {groups.ok.map(({ product, daysLeft }) => (
                <div
                  key={product.id}
                  className="expiry-row expiry-green"
                  onClick={() => navigate(`/inventory/products/${product.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/inventory/products/${product.id}`)}
                >
                  <div className="expiry-row-info">
                    <span className="expiry-product-name">{product.name}</span>
                    {product.sku && <span className="expiry-sku">{product.sku}</span>}
                  </div>
                  <div className="expiry-row-date">
                    <span className="expiry-date-str">{formatDate(product.attributes!.expiryDate!)}</span>
                    <span className="expiry-days-badge">{daysLeft}d left</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
