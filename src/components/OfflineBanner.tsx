import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { OfflineSalesService } from '../services/offlineSales.service';
import { useToast } from './ui/Toast';
import { offlineBannerText } from '../utils/offline-status';

/**
 * Always visible while offline or while sales are waiting: "Offline – 2 sales
 * waiting to sync". Back online, waiting sales sync by themselves (and again
 * every 30 seconds until they go through), with a toast when they do.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const { profile } = useAuth();
  const toast = useToast();
  const storeId = profile?.currentStoreId;
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!storeId) return;
    const refresh = () => setPendingCount(OfflineSalesService.getPendingSales(storeId).length);
    refresh();
    return OfflineSalesService.subscribe(refresh);
  }, [storeId]);

  const sync = useCallback(async (manual = false) => {
    if (!storeId || busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const { synced, remaining } = await OfflineSalesService.flushPendingSales(storeId);
      if (synced > 0) toastRef.current.success(`${synced} sale${synced === 1 ? '' : 's'} synced`, remaining ? { description: `${remaining} still waiting` } : undefined);
      else if (manual && remaining > 0) toastRef.current.error('Sales not synced yet', { description: "We'll keep trying while you're online." });
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [storeId]);

  // back online (or opened with sales waiting): sync now, then retry every 30s
  useEffect(() => {
    if (!online || !storeId || pendingCount === 0) return;
    void sync();
    const timer = window.setInterval(() => { void sync(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [online, storeId, pendingCount > 0, sync]);

  const text = offlineBannerText(online, pendingCount);
  if (!text) return null;

  return (
    <div role="status" aria-live="polite" className={`offline-banner flex flex-wrap items-center justify-center gap-x-2 px-4 py-2 text-center text-[13px] font-medium ${online ? 'bg-brand-soft text-brand-ink' : 'bg-warn-soft text-warn-ink'}`}>
      <span>{text}</span>
      {online && pendingCount > 0 && (
        <button type="button" className="inline-flex min-h-[32px] items-center font-semibold underline disabled:opacity-60" onClick={() => sync(true)} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </div>
  );
}
