import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { ProductService } from '../../services/product.service';
import { VariantService } from '../../services/variant.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Page, PageHeader, btn, cn, inputClass } from '../../components/kit';
import { code128Svg, isCode128B } from '../../utils/code128';
import { variantLabel } from '../../utils/variants';
import { formatMoney } from '../../utils/format';

/**
 * /inventory/labels?ids=a,b: barcode labels (name, price, Code 128) for a
 * 58 mm or 80 mm label roll, or an A4 sheet of 24. Products with sizes or
 * colours get a label per variant. Products without a barcode get one from
 * their SKU first, so the label scans at checkout.
 */
type Line = { key: string; name: string; price: number; code: string; copies: number };
const SIZES = {
  roll58: { label: '58 mm roll', w: 50, h: 30, page: '58mm auto', cols: 1 },
  roll80: { label: '80 mm roll', w: 70, h: 40, page: '80mm auto', cols: 1 },
  a4: { label: 'A4 sheet (24)', w: 70, h: 37, page: 'A4', cols: 3 },
} as const;
type Size = keyof typeof SIZES;

export default function LabelsPage() {
  const [params] = useSearchParams();
  const { hasPermission } = usePermissions();
  const ids = useMemo(() => (params.get('ids') ?? '').split(',').filter((x) => /^[0-9A-Za-z-]{1,64}$/.test(x)).slice(0, 100), [params]);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<Size>('roll58');
  const [showPrice, setShowPrice] = useState(true);
  const canUpdate = hasPermission('product:update');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const codes = canUpdate ? await VariantService.ensureBarcodes(ids).catch(() => ({} as Record<string, string>)) : {};
        const out: Line[] = [];
        for (const id of ids) {
          const p = await ProductService.getProduct(id);
          const variants = p.variantOptions?.length ? await VariantService.forProduct(id) : [];
          if (variants.length) {
            for (const v of variants) {
              const code = v.barcode || v.sku || '';
              out.push({ key: v.id, name: `${p.name} – ${variantLabel(v.size, v.colour)}`, price: v.sellingPrice ?? p.sellingPrice, code, copies: Math.max(1, Math.min(50, Math.round(v.stockQty) || 1)) });
            }
          } else {
            const code = codes[id] || p.barcode || p.sku;
            out.push({ key: id, name: p.name, price: p.sellingPrice, code, copies: 1 });
          }
        }
        if (alive) setLines(out);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load these products');
      }
    })();
    return () => { alive = false; };
  }, [ids, canUpdate]);

  if (!ids.length) return <Page width="form"><Card><p className="m-0 text-sm text-ink-2">Pick products first. <Link to="/inventory/products">Go to products</Link></p></Card></Page>;
  if (error) return <Page width="form"><Card><p className="m-0 text-sm text-danger" role="alert">{error}</p></Card></Page>;
  if (!lines) return <PageLoader />;

  const s = SIZES[size];
  const printable = lines.filter((l) => isCode128B(l.code));
  const labels = printable.flatMap((l) => Array.from({ length: l.copies }, (_, i) => ({ ...l, n: i })));
  const set = (key: string, copies: number) => setLines((prev) => prev && prev.map((l) => (l.key === key ? { ...l, copies: Math.max(0, Math.min(500, copies)) } : l)));

  return (
    <Page>
      <style>{`
        @media print {
          @page { size: ${s.page}; margin: ${size === 'a4' ? '10mm 0' : '0'}; }
          body * { visibility: hidden !important; }
          #label-sheet, #label-sheet * { visibility: visible !important; }
          #label-sheet { position: absolute; left: 0; top: 0; padding: 0 !important; background: #fff !important; box-shadow: none !important; border: 0 !important; }
        }
      `}</style>
      <PageHeader title="Print labels" subtitle={`${labels.length} label${labels.length === 1 ? '' : 's'}`}
        actions={<><Link className={btn('outline')} to="/inventory/products">Done</Link><Button onClick={() => window.print()} disabled={!labels.length}>Print</Button></>} />

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-6">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="m-0 mb-3 text-[15px] font-semibold text-ink">Label size</h2>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Label size">
              {(Object.keys(SIZES) as Size[]).map((k) => (
                <button key={k} type="button" aria-pressed={size === k} onClick={() => setSize(k)}
                  className={cn('rounded-lg border px-2 py-2.5 text-[13px] font-semibold', size === k ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong text-ink-2')}>{SIZES[k].label}</button>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Show the price</label>
          </Card>
          <Card padded={false} className="overflow-hidden">
            <h2 className="m-0 px-4 pb-2 pt-4 text-[15px] font-semibold text-ink">How many of each</h2>
            <ul className="m-0 list-none divide-y divide-line p-0">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{l.name}</span>
                    <span className={cn('block truncate text-xs', isCode128B(l.code) ? 'text-ink-3' : 'text-danger')}>{isCode128B(l.code) ? l.code : 'No printable barcode: add one on the product'}</span>
                  </span>
                  <div className="w-20 shrink-0">
                    <input aria-label={`Labels for ${l.name}`} className={cn(inputClass, 'h-9 text-center')} inputMode="numeric" value={l.copies}
                      onChange={(e) => set(l.key, Number(e.target.value.replace(/\D/g, '')) || 0)} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 overflow-x-auto rounded-xl bg-tray p-4">
          <div id="label-sheet" className="mx-auto bg-white" style={{ width: size === 'a4' ? '210mm' : `${s.w}mm`, display: 'grid', gridTemplateColumns: `repeat(${s.cols}, ${s.w}mm)`, justifyContent: 'center', rowGap: size === 'a4' ? 0 : '2mm' }}>
            {labels.map((l) => (
              <div key={`${l.key}-${l.n}`} style={{ width: `${s.w}mm`, height: `${s.h}mm`, padding: '2mm 3mm', boxSizing: 'border-box', breakInside: 'avoid', pageBreakAfter: size === 'a4' ? 'auto' : 'always', color: '#000', fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: '0.2mm dashed #d0d5dd' }}>
                <div style={{ fontSize: size === 'roll58' ? '8pt' : '9pt', fontWeight: 700, lineHeight: 1.15, maxHeight: '2.3em', overflow: 'hidden' }}>{l.name}</div>
                {showPrice && <div style={{ fontSize: size === 'roll58' ? '10pt' : '12pt', fontWeight: 700, marginTop: '0.5mm' }}>{formatMoney(l.price)}</div>}
                <div style={{ flex: 1, minHeight: 0, marginTop: '1mm' }} dangerouslySetInnerHTML={{ __html: code128Svg(l.code, { height: 40 }).replace('<svg ', '<svg style="width:100%;height:100%" ') }} />
                <div style={{ fontSize: '7pt', textAlign: 'center', letterSpacing: '0.04em' }}>{l.code}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}
