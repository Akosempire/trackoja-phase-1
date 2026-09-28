import { registerSW } from 'virtual:pwa-register';

/** Keep already-open dashboards on the current deployed bundle. */
export function registerAppWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // Older workers cached authenticated Supabase GET responses without partitioning
  // by account. Drop that legacy cache as the new worker takes over.
  if ('caches' in window) void caches.delete('supabase-data');

  registerSW({
    immediate: true,
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
