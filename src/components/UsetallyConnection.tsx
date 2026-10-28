import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { Card, CardHead, Pill } from './kit';
import { UsetallyService, type UsetallyLinkStatus } from '../services/usetally.service';

/**
 * Settings → Connected apps: link this store to a Usetally business so every
 * completed sale arrives there as a paid invoice (docs/USETALLY_CONNECT.md).
 * Only shown to people who can change the store (store:update).
 */
function when(iso: string | null): string {
  if (!iso) return 'not yet';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'not yet' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function UsetallyConnection({ storeId, storeName }: { storeId: string; storeName: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<UsetallyLinkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'sync' | 'retry' | 'disconnect' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    UsetallyService.getStatus(storeId)
      .then((s) => { setStatus(s); setError(null); })
      .catch((e) => setError(/get_usetally_link_status/.test(String(e?.message)) ? 'Connecting Usetally needs a database update first.' : 'Could not load the Usetally connection.'));
  }, [storeId]);
  useEffect(load, [load]);

  const connect = () => { window.location.assign(UsetallyService.startConnect(storeId, storeName)); };

  async function act(kind: 'sync' | 'retry' | 'disconnect') {
    setBusy(kind);
    try {
      if (kind === 'disconnect') {
        await UsetallyService.disconnect(storeId);
        toast.success('Usetally disconnected', { description: 'New sales stay in TrackOja only.' });
        setConfirming(false);
      } else {
        const r = kind === 'sync' ? await UsetallyService.syncNow(storeId) : await UsetallyService.retryFailed(storeId);
        toast.success(r.sent ? `${r.sent} sale${r.sent === 1 ? '' : 's'} sent to Usetally` : 'Nothing waiting to send',
          r.failed ? { description: `${r.failed} could not be sent. Check them in Usetally's currency and try again.` } : undefined);
      }
    } catch (e) {
      toast.error('That did not work', { description: e instanceof Error ? e.message : 'Try again.' });
    } finally {
      setBusy(null);
      load();
    }
  }

  const active = status?.status === 'active';
  const wrongCurrency = active && status?.businessCurrency && status.businessCurrency !== status.storeCurrency;

  return (
    <Card aria-labelledby="usetally-title">
      <CardHead
        title={<span id="usetally-title">Usetally</span>}
        hint="Send every sale to Usetally as a paid invoice, so profit, tax and reports include the shop"
        action={status && <Pill tone={active ? 'success' : 'neutral'}>{active ? 'Connected' : status.status === 'revoked' ? 'Disconnected' : 'Not connected'}</Pill>}
      />
      {error && <p className="m-0 mb-3 text-sm text-danger" role="alert">{error}</p>}

      {!status && !error && <p className="m-0 text-sm text-ink-3">Loading…</p>}

      {status && !active && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ul className="m-0 list-none space-y-1 p-0 text-[13px] text-ink-2">
            <li>Sales arrive in Usetally as paid invoices with receipts. Credit sales stay as balance due.</li>
            <li>Usetally can add this store's products to invoices and lower stock when they are paid.</li>
            <li>Usetally never takes or holds your money.</li>
          </ul>
          <Button onClick={connect} className="shrink-0 self-start sm:self-auto">Connect Usetally</Button>
        </div>
      )}

      {status && active && (
        <div className="flex flex-col gap-4">
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div><dt className="text-[12px] text-ink-3">Business</dt><dd className="m-0 truncate font-medium text-ink">{status.businessName}</dd></div>
            <div><dt className="text-[12px] text-ink-3">Last sent</dt><dd className="m-0 font-medium text-ink">{when(status.lastSyncAt)}</dd></div>
            <div><dt className="text-[12px] text-ink-3">Waiting</dt><dd className="m-0 font-medium tabular-nums text-ink">{status.pending}</dd></div>
            <div><dt className="text-[12px] text-ink-3">Failed</dt><dd className={`m-0 font-medium tabular-nums ${status.failed ? 'text-danger' : 'text-ink'}`}>{status.failed}</dd></div>
          </dl>
          {wrongCurrency && (
            <p className="m-0 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn-ink" role="alert">
              This store sells in {status.storeCurrency}, but the Usetally business records {status.businessCurrency}. Sales can't be sent until they match.
            </p>
          )}
          {status.lastError && status.failed > 0 && <p className="m-0 text-[13px] text-ink-3">Last problem: {status.lastError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => act('sync')} loading={busy === 'sync'} disabled={busy !== null}>Send now</Button>
            {status.failed > 0 && <Button variant="outline" onClick={() => act('retry')} loading={busy === 'retry'} disabled={busy !== null}>Retry failed</Button>}
            {!confirming ? (
              <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy !== null}>Disconnect</Button>
            ) : (
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                Stop sending sales to Usetally?
                <Button variant="danger" onClick={() => act('disconnect')} loading={busy === 'disconnect'} disabled={busy !== null && busy !== 'disconnect'}>Disconnect</Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy !== null}>Keep</Button>
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
