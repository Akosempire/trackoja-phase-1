import { useState, useSyncExternalStore } from 'react';
import { pendingUpdate, subscribeToUpdate } from '../utils/app-update-state';
import { Button } from './ui/Button';
export function AppUpdateBanner() {
  const update = useSyncExternalStore(subscribeToUpdate, pendingUpdate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (!update) return null;
  return <div className="alert alert-info" role="status"><span>{error ? 'The update could not load. Try again when connected.' : 'An update is ready. Save unfinished work before updating.'}</span><Button disabled={busy} onClick={async () => { setBusy(true); try { await update(); } catch { setError(true); } finally { setBusy(false); } }}>{busy ? 'Updating…' : 'Update now'}</Button></div>;
}
