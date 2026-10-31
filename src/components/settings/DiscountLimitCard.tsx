import { useEffect, useId, useState } from 'react';
import { useToast } from '../ui/Toast';
import { Card, btn, cn, inputClass } from '../kit';
import { StoreRulesService, parseDiscountLimit } from '../../services/storeRules.service';

/** Settings → Discount limit. Above it, a cashier needs a manager's PIN. */
export function DiscountLimitCard({ storeId, canUpdate }: { storeId: string; canUpdate: boolean }) {
  const toast = useToast();
  const id = useId();
  const [saved, setSaved] = useState<number | null | undefined>(undefined);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    StoreRulesService.getDiscountLimit(storeId)
      .then((v) => { setSaved(v); setText(v === null ? '' : String(v)); })
      .catch(() => setSaved(null));
  }, [storeId]);
  if (saved === undefined) return null;
  const parsed = parseDiscountLimit(text);
  const invalid = parsed === undefined;
  const dirty = !invalid && parsed !== saved;

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      const v = await StoreRulesService.setDiscountLimit(storeId, parsed);
      setSaved(v); setText(v === null ? '' : String(v));
      toast.success(v === null ? 'No discount limit' : `Discounts above ${v}% now need a manager's PIN`);
    } catch (e) { toast.error('Not saved', { description: e instanceof Error ? e.message : 'Try again.' }); }
    finally { setSaving(false); }
  };

  return (
    <Card aria-labelledby={`${id}-title`}>
      <form className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="m-0 text-[15px] font-semibold text-ink">Discount limit</h2>
          <p id={`${id}-hint`} className="m-0 mt-0.5 text-[13px] text-ink-3">
            The biggest discount a cashier can give on a sale. Anything above it needs a manager's or the owner's PIN. Leave empty for no limit.
          </p>
          {invalid && <p className="m-0 mt-1 text-[13px] text-danger" role="alert">Enter a number from 0 to 100.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor={`${id}-input`} className="sr-only">Discount limit in percent</label>
          <div className="relative w-28">
            <input id={`${id}-input`} inputMode="decimal" autoComplete="off" placeholder="No limit"
              className={cn(inputClass, 'h-11 pr-8 text-right', invalid && 'border-danger')}
              aria-describedby={`${id}-hint`} aria-invalid={invalid}
              value={text} disabled={!canUpdate || saving} onChange={(e) => setText(e.target.value)} />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-3" aria-hidden="true">%</span>
          </div>
          {canUpdate && <button type="submit" className={cn(btn('primary'), 'min-h-[44px]')} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>}
        </div>
      </form>
    </Card>
  );
}
