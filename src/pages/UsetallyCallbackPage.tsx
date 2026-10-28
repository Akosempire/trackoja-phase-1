import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Page, btn } from '../components/kit';
import { UsetallyService, consumeConnectState, describeCallbackProblem, readCallbackParams } from '../services/usetally.service';

/**
 * /settings/usetally/callback: Usetally sends the owner back here with a one-time
 * code (or ?error=access_denied). The state is checked against the one saved
 * before leaving, then usetally-connect swaps the code for the link key on the
 * server. The code is used once, even under React's double effects.
 */
type View = { kind: 'working' } | { kind: 'done'; business: string; warning: string | null } | { kind: 'error'; message: string };

export default function UsetallyCallbackPage() {
  const { search } = useLocation();
  const [view, setView] = useState<View>({ kind: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const { code, state, error } = readCallbackParams(search);
    // the code must not stay in the address bar or the browser history
    window.history.replaceState(null, '', window.location.pathname);
    const checked = consumeConnectState(state);
    if (error) { setView({ kind: 'error', message: describeCallbackProblem(error) }); return; }
    if (!checked.ok) { setView({ kind: 'error', message: describeCallbackProblem(checked.reason) }); return; }
    if (!code) { setView({ kind: 'error', message: describeCallbackProblem('no_code') }); return; }
    UsetallyService.connect(checked.storeId, code)
      .then((r) => setView({ kind: 'done', business: r.businessName, warning: r.warning }))
      .catch((e) => setView({ kind: 'error', message: e instanceof Error && e.message ? e.message : describeCallbackProblem('failed') }));
  }, [search]);

  return (
    <Page width="form">
      <Card className="mt-6">
        {view.kind === 'working' && (
          <div role="status">
            <h1 className="m-0 text-xl font-semibold text-ink">Connecting Usetally…</h1>
            <p className="m-0 mt-1 text-sm text-ink-2">This takes a few seconds.</p>
          </div>
        )}
        {view.kind === 'done' && (
          <div>
            <h1 className="m-0 text-xl font-semibold text-ink">Connected to {view.business}</h1>
            <p className="m-0 mt-1 text-sm text-ink-2">From now on, every completed sale is sent to Usetally as a paid invoice.</p>
            {view.warning && <p className="m-0 mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn-ink" role="alert">{view.warning}</p>}
            <Link to="/settings" className={`${btn('primary')} mt-4`}>Back to settings</Link>
          </div>
        )}
        {view.kind === 'error' && (
          <div role="alert">
            <h1 className="m-0 text-xl font-semibold text-ink">Usetally wasn't connected</h1>
            <p className="m-0 mt-1 text-sm text-ink-2">{view.message}</p>
            <Link to="/settings" className={`${btn('outline')} mt-4`}>Back to settings</Link>
          </div>
        )}
      </Card>
    </Page>
  );
}
