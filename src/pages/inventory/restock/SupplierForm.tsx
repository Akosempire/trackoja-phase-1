import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useToast } from '../../../components/ui/Toast';
import { inputClass } from '../../../components/kit';
import { RestockService, type SupplierBalance } from '../../../services/restock.service';
import { Labelled } from './shared';

/** Add or edit a supplier. */
export function SupplierForm({ storeId, supplier, onClose, onSaved }: { storeId: string; supplier: SupplierBalance | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: supplier?.name ?? '', contactName: supplier?.contactName ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '',
    address: supplier?.address ?? '', paymentTerms: supplier?.paymentTerms ?? '', notes: supplier?.notes ?? '', status: supplier?.status ?? 'active',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  async function save() {
    setBusy(true); setError(null);
    try {
      await RestockService.saveSupplier(storeId, { id: supplier?.id, ...f, status: f.status as 'active' | 'inactive' });
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Not saved'); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={onClose} title={supplier ? 'Edit supplier' : 'Add supplier'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
        <Labelled label="Business name"><input autoFocus className={inputClass} {...field('name')} placeholder="e.g. Dangote Foods" /></Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Contact person"><input className={inputClass} {...field('contactName')} /></Labelled>
          <Labelled label="Phone"><input className={inputClass} inputMode="tel" {...field('phone')} /></Labelled>
        </div>
        <Labelled label="Email"><input type="email" className={inputClass} {...field('email')} /></Labelled>
        <Labelled label="Address"><input className={inputClass} {...field('address')} /></Labelled>
        <Labelled label="Payment terms" hint="e.g. Pay within 30 days"><input className={inputClass} {...field('paymentTerms')} /></Labelled>
        <Labelled label="Notes"><textarea className={`${inputClass} h-auto min-h-[72px] py-2`} {...field('notes')} /></Labelled>
        {supplier && (
          <Labelled label="Status">
            <select className={inputClass} {...field('status')}><option value="active">Active</option><option value="inactive">Inactive (hide from lists)</option></select>
          </Labelled>
        )}
      </div>
    </Dialog>
  );
}
