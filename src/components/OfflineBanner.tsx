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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, storeId]);

  if (online && pendingCount === 0) return null;

  return (
    <div className={`offline-banner ${online ? 'offline-banner-info' : 'offline-banner-warn'}`}>
      {!online && <span>You're offline. New sales will be saved and synced automatically.</span>}
      {pendingCount > 0 && (
        <span>
          {' '}
          {pendingCount} sale{pendingCount === 1 ? '' : 's'} waiting to sync
          {online && (
            <button type="button" className="offline-banner-link" onClick={sync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
