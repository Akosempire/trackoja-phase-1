import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { StoreService } from '../services/store.service';
import { StoreContextManager } from '../utils/store-context';
import type { Store } from '../types';

// Persistent global store switcher. Rendered in AppLayout so it is available
// on every authenticated page. Switching stores updates the user's
// current_store_id (which drives the STORE_SWITCHED audit log entry - see
// database/011_audit_log_triggers.sql) and the local StoreContextManager state
// used for RLS-scoped queries.
export function StoreSwitcher() {
  const { user, profile, refreshProfile } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!user) return;
    StoreService.getUserStores(user.id)
      .then(setStores)
      .catch((err) => console.error('Load stores error:', err));
  }, [user]);

  const handleChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const storeId = e.target.value;
    if (!user || !profile || storeId === profile.currentStoreId) return;

    const nextStore = stores.find((s) => s.id === storeId);
    if (!nextStore) return;

    setSwitching(true);
    try {
      await StoreService.setCurrentStore(user.id, storeId);
      StoreContextManager.switchStore(nextStore, user.id);
      await refreshProfile();
    } catch (err) {
      console.error('Switch store error:', err);
    } finally {
      setSwitching(false);
    }
  };

  if (stores.length === 0) return null;

  return (
    <select
      className="form-input"
      style={{ width: 'auto', height: 36, fontSize: 13, padding: '0 10px' }}
      value={profile?.currentStoreId ?? ''}
      onChange={handleChange}
      disabled={switching || stores.length < 2}
      aria-label="Switch store"
    >
      {stores.map((store) => (
        <option key={store.id} value={store.id}>
          {store.name}
        </option>
      ))}
    </select>
  );
}
