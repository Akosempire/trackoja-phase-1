import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { OfflineSalesService } from '../services/offlineSales.service';

export function OfflineBanner() {
  const online = useOnlineStatus();
  const { profile } = useAuth();
  const storeId = profile?.currentStoreId;
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    const refresh = () => setPendingCount(OfflineSalesService.getPendingSales(storeId).length);
    refresh();
    return OfflineSalesService.subscribe(refresh);
  }, [storeId]);

  const sync = async () => {
    if (!storeId || syncing) return;
    setSyncing(true);
    try {
      await OfflineSalesService.flushPendingSales(storeId);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (online && storeId && pendingCount > 0) {
      sync();
    }
  }, [online, storeId]);

  if (online && pendingCount === 0) return null;

  return (
    <div role="status" className={`offline-banner px-4 py-2 text-center text-[13px] font-medium ${online ? 'bg-brand-soft text-brand-ink' : 'bg-warn-soft text-warn-ink'}`}>
      {!online && <span>You're offline. New sales will be saved and synced automatically.</span>}
      {pendingCount > 0 && (
        <span>
          {' '}
          {pendingCount} sale{pendingCount === 1 ? '' : 's'} waiting to sync
          {online && (
            <button type="button" className="ml-2 font-semibold underline disabled:opacity-60" onClick={sync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
