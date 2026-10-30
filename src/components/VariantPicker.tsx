import { Dialog } from './ui/Dialog';
import { cn } from './kit';
import { formatMoney } from '../utils/format';
import { variantLabel } from '../utils/variants';
import type { Product, ProductVariant } from '../types';

/** Checkout: which size/colour of this product? Out-of-stock ones can't be picked. */
export function VariantPicker({ product, variants, onPick, onClose }: { product: Product; variants: ProductVariant[]; onPick: (v: ProductVariant) => void; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={product.name} description="Pick the size or colour">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {variants.map((v) => {
          const out = product.trackInventory && v.stockQty <= 0;
          return (
            <button key={v.id} type="button" disabled={out} onClick={() => onPick(v)}
              className={cn('flex min-h-[64px] flex-col items-start justify-center rounded-lg border px-3 py-2 text-left transition-colors',
                out ? 'cursor-not-allowed border-line opacity-50' : 'border-line-strong hover:border-brand hover:bg-brand-soft')}>
              <span className="text-sm font-semibold text-ink">{variantLabel(v.size, v.colour)}</span>
              <span className="mt-0.5 text-xs tabular-nums text-ink-3">
                {formatMoney(v.sellingPrice ?? product.sellingPrice)}{product.trackInventory ? ` · ${out ? 'out of stock' : `${v.stockQty} left`}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
