import { registerSW } from 'virtual:pwa-register';
import { offerAppUpdate } from './utils/app-update-state';

/** Discover updates without reloading an active form when the app resumes. */
export function registerAppWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // Older workers cached authenticated Supabase GET responses without partitioning
  // by account. Drop that legacy cache as the new worker takes over.
  if ('caches' in window) void caches.delete('supabase-data');

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => offerAppUpdate(() => updateSW(true)),
    onRegisteredSW: (_workerUrl, registration) => {
      if (!registration) return;
      const checkForUpdate = () => {
        if (document.visibilityState === 'visible') {
          void registration.update().catch(() => { /* Offline clients retry later. */ });
        }
      };
      window.addEventListener('focus', checkForUpdate);
      document.addEventListener('visibilitychange', checkForUpdate);
      window.setInterval(checkForUpdate, 15 * 60 * 1000);
    },
  });
}
