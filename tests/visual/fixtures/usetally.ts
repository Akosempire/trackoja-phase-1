// Settings → Usetally card. ?usetally=none shows the "Connect" state.
type Mock = (svc: string, key: string, value: unknown) => void;
export default function (mock: Mock) {
  const none = new URLSearchParams(location.search).get('usetally') === 'none';
  mock('UsetallyService', 'getStatus', none
    ? { status: 'none', businessName: null, businessCurrency: null, storeCurrency: 'NGN', keyHint: null, connectedAt: null, revokedAt: null, lastSyncAt: null, lastError: null, pending: 0, failed: 0, sent: 0 }
    : { status: 'active', businessName: 'Ada Supermarket Ltd', businessCurrency: 'NGN', storeCurrency: 'NGN', keyHint: 'x9Qa', connectedAt: '2026-10-28T18:02:00Z', revokedAt: null, lastSyncAt: '2026-10-28T20:41:00Z', lastError: 'Usetally did not answer in time', pending: 2, failed: 1, sent: 148 });
}
