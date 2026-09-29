import { useState } from 'react';
import { supabase } from '../../config/supabase';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import { Disclosure } from '../ui/Disclosure';
import { useToast } from '../ui/Toast';

export function TrialExtension({ entitlementId, onSaved }: { entitlementId: string; onSaved: () => Promise<void> }) {
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function extend() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('extend_product_trial', {
        p_entitlement_id: entitlementId, p_days: Number(days), p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success('Trial extended');
      await onSaved();
    } catch (error) {
      console.error('Trial extension failed', error);
      toast.error('Could not extend the trial. Check the duration and your permissions, then retry.');
    } finally { setBusy(false); }
  }
  return <Disclosure summary="Extend this trial">
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void extend(); }}>
      <FormField id={`trial-days-${entitlementId}`} label="Additional days (1–365)" type="number" value={days} onChange={setDays} required />
      <FormField id={`trial-reason-${entitlementId}`} label="Reason for extension" value={reason} onChange={setReason} required hint="At least 10 characters. This action is recorded in the audit log." />
      <div className="form-actions"><Button type="submit" loading={busy} disabled={!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 365 || reason.trim().length < 10}>Extend trial</Button></div>
    </form>
  </Disclosure>;
}
