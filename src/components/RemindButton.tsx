import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { StoreService } from '../services/store.service';
import { VariantService } from '../services/variant.service';
import { btn, cn } from './kit';
import { reminderMessage, whatsappLink } from '../utils/whatsapp';

/** Store name for messages, fetched once per page. */
export function useStoreName(): string {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  useEffect(() => {
    if (!profile?.currentStoreId) return;
    StoreService.getStore(profile.currentStoreId).then((s) => setName(s.name)).catch(() => {});
  }, [profile?.currentStoreId]);
  return name;
}

/**
 * "Remind on WhatsApp": opens WhatsApp with a polite note about what they owe,
 * and records the reminder in the activity log. Nothing is sent by TrackOja.
 */
export function RemindButton({ customer, storeName, size = 'md', className }: {
  customer: { id: string; name: string; phone?: string | null; balance: number }; storeName: string; size?: 'sm' | 'md'; className?: string;
}) {
  if (customer.balance <= 0) return null;
  const href = whatsappLink(customer.phone ?? null, reminderMessage({ customerName: customer.name, storeName: storeName || 'our shop', amount: customer.balance }));
  return (
    <a className={cn(btn('outline', size), className)} href={href} target="_blank" rel="noopener noreferrer"
      onClick={() => { void VariantService.logReminder(customer.id).catch(() => undefined); }}>
      Remind on WhatsApp
    </a>
  );
}
