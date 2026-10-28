import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ProductService } from '../../services/product.service';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Empty, Page, PageHeader, Pill, Stat, cn } from '../../components/kit';
import { stockQuantity } from '../../utils/business-activity';
import type { Product } from '../../types';

type ExpiryGroup = 'expired' | 'soon30' | 'soon90' | 'ok';

interface GroupedProduct {
  product: Product;
  expiryDate: Date;
  group: ExpiryGroup;
  daysLeft: number;
}

const GROUP_CONFIG: Record<ExpiryGroup, { label: string; tone: 'danger' | 'warn' | 'neutral' | 'success'; description: string }> = {
  expired:  { label: 'Expired',                 tone: 'danger',  description: 'Past expiry date' },
  soon30:   { label: 'Expiring within 30 days', tone: 'warn',    description: 'Urgent — remove or use first' },
  soon90:   { label: 'Expiring within 90 days', tone: 'neutral', description: 'Check stock rotation' },
  ok:       { label: 'OK',                      tone: 'success', description: 'Safe' },
};

const TONE_DOT = { danger: 'bg-danger', warn: 'bg-warn', neutral: 'bg-ink-3', success: 'bg-success' } as const;

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
  const tracked = alertCount + groups.ok.length;

  const open = (product: Product) => navigate(`/inventory/products/${product.id}`);

  const rows = (items: GroupedProduct[], group: ExpiryGroup) => (
    <ul className="m-0 list-none divide-y divide-line p-0">
      {items.map(({ product, daysLeft }) => (
        <li key={product.id}>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none sm:px-5"
            onClick={() => open(product)}
          >
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sm font-medium', group === 'expired' ? 'text-ink-2' : 'text-ink')}>{product.name}</span>
              <span className="block truncate text-xs text-ink-3">
                {product.sku && <>SKU {product.sku} · </>}
                {product.trackInventory ? `${stockQuantity(product.stockQty, product.unit)} in stock` : 'Stock not tracked'}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-right">
              <span className="text-[13px] tabular-nums text-ink-2">{formatDate(product.attributes!.expiryDate!)}</span>
              <Pill tone={group === 'soon90' ? 'neutral' : GROUP_CONFIG[group].tone}>
                {daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
              </Pill>
            </span>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="hidden shrink-0 text-ink-3 sm:block"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Page>
      <PageHeader
        title="Expiry Alerts"
        subtitle={alertCount > 0
          ? `${alertCount} product${alertCount === 1 ? '' : 's'} need attention`
          : 'All products are within safe expiry dates'}
      />

      {tracked === 0 ? (
        <Empty
          title="No expiry dates recorded"
          body="Add an expiry date when creating or editing a pharmacy product to monitor it here."
        />
      ) : (
        <>
          <section className="mb-4 grid grid-cols-2 gap-3 lg:mb-6 lg:grid-cols-4 lg:gap-4" aria-label="Expiry summary">
            <Stat label="Expired" value={groups.expired.length} tone={groups.expired.length ? 'danger' : undefined} hint="Remove from shelves" />
            <Stat label="Within 30 days" value={groups.soon30.length} tone={groups.soon30.length ? 'warn' : undefined} hint="Sell or return first" />
            <Stat label="Within 90 days" value={groups.soon90.length} hint="Watch rotation" />
            <Stat label="Safe" value={groups.ok.length} tone={groups.ok.length ? 'success' : undefined} hint="More than 90 days" />
          </section>

          <div className="flex flex-col gap-4 lg:gap-6">
            {GROUP_ORDER.filter((g) => g !== 'ok').map((group) => {
              const cfg = GROUP_CONFIG[group];
              const items = groups[group];
              if (items.length === 0) return null;
              return (
                <Card key={group} padded={false} className={cn('overflow-hidden', group === 'expired' && 'border-danger/40')} aria-labelledby={`expiry-${group}`}>
                  <div className={cn('flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5', group === 'expired' && 'bg-danger-soft/60', group === 'soon30' && 'bg-warn-soft/60')}>
                    <div className="min-w-0">
                      <h2 id={`expiry-${group}`} className="m-0 flex items-center gap-2 text-[15px] font-semibold text-ink">
                        <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[cfg.tone])} aria-hidden="true" />
                        {cfg.label}
                      </h2>
                      <p className="m-0 mt-0.5 text-[13px] text-ink-2">{cfg.description}</p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-2">{items.length}</span>
                  </div>
                  {rows(items, group)}
                </Card>
              );
            })}

            {groups.ok.length > 0 && (
              <div>
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink-2 transition-colors hover:bg-hover hover:text-ink"
                  aria-expanded={showOk}
                  onClick={() => setShowOk((v) => !v)}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                    className={cn('transition-transform', showOk && 'rotate-90')}><path d="m9 6 6 6-6 6" /></svg>
                  {showOk ? 'Hide' : 'Show'} {groups.ok.length} safe product{groups.ok.length === 1 ? '' : 's'}
                </button>
                {showOk && (
                  <Card padded={false} className="mt-2 overflow-hidden" aria-label="Safe products">
                    {rows(groups.ok, 'ok')}
                  </Card>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
