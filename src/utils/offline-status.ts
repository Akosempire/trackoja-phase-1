/** The offline banner's words: "Offline – 2 sales waiting to sync" (null = no banner). */
export function offlineBannerText(online: boolean, pending: number): string | null {
  const waiting = `${pending} sale${pending === 1 ? '' : 's'} waiting to sync`;
  if (!online) return pending > 0 ? `Offline – ${waiting}` : 'Offline – new sales are saved on this device and sync when you reconnect';
  return pending > 0 ? waiting : null;
}
