import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { Card, cn, inputClass } from './kit';
import { VariantService } from '../services/variant.service';
import { combine, parseValues, variantLabel, variantProblems, type VariantDraft, type VariantOption } from '../utils/variants';
import { formatMoney } from '../utils/format';

/**
 * Product → Sizes and colours. Up to two options (e.g. Size, Colour); every
 * combination becomes a variant with its own SKU, barcode, price and stock.
 * Saving sets the product's stock to the variants' total.
 */
export function VariantsEditor({ productId, baseSku, basePrice, initialOptions, trackInventory, readOnly, onSaved }: {
  productId: string; baseSku: string; basePrice: number; initialOptions: VariantOption[]; trackInventory: boolean; readOnly?: boolean; onSaved?: (total: number) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(initialOptions.length > 0);
  const [names, setNames] = useState<[string, string]>([initialOptions[0]?.name ?? 'Size', initialOptions[1]?.name ?? 'Colour']);
  const [texts, setTexts] = useState<[string, string]>([initialOptions[0]?.values.join(', ') ?? '', initialOptions[1]?.values.join(', ') ?? '']);
  const [rows, setRows] = useState<VariantDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    VariantService.forProduct(productId).then((list) => {
      setRows(list.map((v) => ({ id: v.id, size: v.size, colour: v.colour, sku: v.sku ?? '', barcode: v.barcode ?? '', price: v.sellingPrice === null ? '' : String(v.sellingPrice), stock: String(v.stockQty) })));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [productId]);

  const options: VariantOption[] = useMemo(() => [
    { name: names[0].trim() || 'Size', values: parseValues(texts[0]) },
    { name: names[1].trim() || 'Colour', values: parseValues(texts[1]) },
  ], [names, texts]);
  // the table follows the options; values already filled in are kept
  useEffect(() => { if (loaded) setRows((prev) => combine(options, baseSku, prev)); }, [options, baseSku, loaded]);

  const problems = variantProblems(rows);
  const total = rows.reduce((s, r) => s + (Number(r.stock) || 0), 0);
  const set = (i: number, patch: Partial<VariantDraft>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setSaving(true);
    try {
      const n = await VariantService.save(productId, options, rows);
      toast.success(n ? `${n} size/colour combination${n === 1 ? '' : 's'} saved` : 'Sizes and colours removed', trackInventory && n ? { description: `Stock is now ${total} in total.` } : undefined);
      onSaved?.(total);
    } catch (e) {
      toast.error('Not saved', { description: e instanceof Error ? e.message : 'Try again.' });
    } finally { setSaving(false); }
  }

  const head = (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="variants-title" className="m-0 text-[15px] font-semibold leading-[22px] text-ink">Sizes and colours</h2>
        <p className="mt-0.5 text-[13px] text-ink-3">For products sold in different sizes, colours or styles. Each one gets its own stock and barcode.</p>
      </div>
    </div>
  );

  if (!open) {
    return (
      <Card aria-labelledby="variants-title">
        {head}
        {!readOnly && <Button type="button" variant="outline" className="btn-sm" onClick={() => setOpen(true)}>Add sizes or colours</Button>}
      </Card>
    );
  }

  return (
    <Card aria-labelledby="variants-title">
      {head}
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
            <input aria-label={`Option ${i + 1} name`} className={cn(inputClass, 'h-9 font-semibold')} value={names[i]} maxLength={20}
              onChange={(e) => setNames((p) => (i === 0 ? [e.target.value, p[1]] : [p[0], e.target.value]))} />
            <input aria-label={`${names[i]} values`} className={cn(inputClass, 'h-9')} value={texts[i]}
              placeholder={i === 0 ? 'e.g. S, M, L, XL' : 'e.g. Red, Blue (optional)'}
              onChange={(e) => setTexts((p) => (i === 0 ? [e.target.value, p[1]] : [p[0], e.target.value]))} />
            <p className="m-0 text-[11.5px] text-ink-3">Separate with commas</p>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-subtle text-left text-[12px] text-ink-3">
              <tr><th className="px-3 py-2 font-medium">Variant</th><th className="px-2 py-2 font-medium">SKU</th><th className="px-2 py-2 font-medium">Barcode</th><th className="px-2 py-2 font-medium">Price</th>{trackInventory && <th className="px-2 py-2 font-medium">Stock</th>}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const label = variantLabel(r.size, r.colour);
                return (
                  <tr key={`${r.size}|${r.colour}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{label}</td>
                    <td className="px-2 py-1.5"><input aria-label={`${label} SKU`} className={cn(inputClass, 'h-9 min-w-[140px] px-2.5')} value={r.sku} onChange={(e) => set(i, { sku: e.target.value })} /></td>
                    <td className="px-2 py-1.5"><input aria-label={`${label} barcode`} className={cn(inputClass, 'h-9 min-w-[110px] px-2.5')} value={r.barcode} inputMode="numeric" placeholder="Optional" onChange={(e) => set(i, { barcode: e.target.value })} /></td>
                    <td className="px-2 py-1.5"><input aria-label={`${label} price`} className={cn(inputClass, 'h-9 w-[96px] px-2.5')} value={r.price} inputMode="decimal" placeholder="Same" onChange={(e) => set(i, { price: e.target.value })} /></td>
                    {trackInventory && <td className="px-2 py-1.5"><input aria-label={`${label} stock`} className={cn(inputClass, 'h-9 w-[72px] px-2.5')} value={r.stock} inputMode="decimal" onChange={(e) => set(i, { stock: e.target.value })} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-[12.5px] text-ink-3">
          {rows.length ? `${rows.length} combination${rows.length === 1 ? '' : 's'}${trackInventory ? ` · ${total} in stock in total` : ''}. Leave a price blank to use ${formatMoney(basePrice)}.` : 'Add values above to make the combinations.'}
        </p>
        {!readOnly && (
          <div className="flex gap-2">
            {rows.length === 0 && initialOptions.length === 0 && <Button type="button" variant="ghost" className="btn-sm" onClick={() => setOpen(false)}>Cancel</Button>}
            <Button type="button" className="btn-sm" loading={saving} disabled={problems.length > 0} onClick={save}>Save sizes and colours</Button>
          </div>
        )}
      </div>
      {problems.length > 0 && <p className="m-0 mt-2 text-[13px] text-danger" role="alert">{problems[0]}</p>}
    </Card>
  );
}
