import { useMemo, useState, type ReactNode } from 'react';
import { BarcodeScanner } from '../../../components/BarcodeScanner';
import { ScanIcon, SearchIcon } from '../../../components/icons';
import { cn, inputClass } from '../../../components/kit';
import { useToast } from '../../../components/ui/Toast';
import { findByCode } from '../../../utils/restock';
import type { Product } from '../../../types';

/** Label + control, stacked. */
export function Labelled({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ink', className)}>
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

/** Tabs across the top of every restock screen. */
export const RESTOCK_TABS = [
  { to: '/inventory/restock', label: 'Overview' },
  { to: '/inventory/receive', label: 'Receive stock' },
  { to: '/inventory/suppliers', label: 'Suppliers' },
  { to: '/inventory/count', label: 'Stock count' },
  { to: '/inventory/transfers', label: 'Transfers' },
  { to: '/inventory/low-stock', label: 'Low stock' },
];

/**
 * Search or scan to add a product. Typing filters by name, SKU or barcode; Enter
 * or a scan picks an exact barcode/SKU match.
 */
export function ProductPicker({ products, onPick, placeholder = 'Search or scan a product', exclude = [] }: {
  products: Product[]; onPick: (p: Product) => void; placeholder?: string; exclude?: string[];
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return products.filter((p) => !exclude.includes(p.id) && (p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || (p.barcode ?? '').toLowerCase() === s)).slice(0, 8);
  }, [q, products, exclude]);
  const pick = (p: Product) => { onPick(p); setQ(''); };
  const byCode = (code: string) => {
    const p = findByCode(products, code);
    if (p) pick(p); else toast.error('No product with that code', { description: code });
  };
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"><SearchIcon width={16} height={16} /></span>
          <input className={cn(inputClass, 'pl-9')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches.length === 1) pick(matches[0]); else if (q.trim()) byCode(q); } }} />
        </div>
        <button type="button" onClick={() => setScan(true)} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-hover" aria-label="Scan a barcode">
          <ScanIcon width={18} height={18} /><span className="hidden sm:inline">Scan</span>
        </button>
      </div>
      {matches.length > 0 && (
        <ul className="absolute inset-x-0 top-11 z-20 m-0 list-none overflow-hidden rounded-lg border border-line bg-surface p-0 shadow-lg">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => pick(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-subtle">
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{p.name}</span><span className="block text-xs text-ink-3">{p.sku}</span></span>
                <span className="shrink-0 text-xs tabular-nums text-ink-3">{p.stockQty} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {scan && <BarcodeScanner onClose={() => setScan(false)} onDetect={(code) => { setScan(false); byCode(code); }} />}
    </div>
  );
}

/** A number box that keeps what's typed (so "1." isn't eaten) */
export function NumberBox({ value, onChange, label, step = 'any', min = 0, className, align = 'left' }: { value: string; onChange: (v: string) => void; label: string; step?: string; min?: number; className?: string; align?: 'left' | 'right' }) {
  // the width goes on a wrapper: inputClass is w-full
  return (
    <span className={cn('block min-w-0', className)}>
      <input type="number" inputMode="decimal" step={step} min={min} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, 'tabular-nums', align === 'right' && 'text-right')} />
    </span>
  );
}

/** "-₦360" rather than "₦-360"; "+₦1,900" for gains. */
export function signedMoney(value: number, format: (n: number) => string): string {
  if (!value) return format(0);
  return `${value < 0 ? '−' : '+'}${format(Math.abs(value))}`;
}
