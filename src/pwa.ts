import { registerSW } from 'virtual:pwa-register';

/** Keep already-open dashboards on the current deployed bundle. */
export function registerAppWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

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
