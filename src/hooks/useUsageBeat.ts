import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { AccountService } from '../services/account.service';
import { usageArea } from '../utils/usageArea';

/**
 * Counts active time per screen area: only while the tab is visible and the
 * person did something in the last 2 minutes. Sent every minute and when the
 * page is hidden. Nothing about what's on screen is sent.
 */
const TICK = 15, IDLE = 120_000, FLUSH_AT = 60;

export function useUsageBeat(storeId: string | null | undefined, enabled: boolean) {
  const { pathname } = useLocation();
  const area = useRef<string | null>(usageArea(pathname));
  const store = useRef(storeId);
  const pending = useRef(new Map<string, number>());
  const lastActive = useRef(Date.now());

  useEffect(() => { area.current = usageArea(pathname); lastActive.current = Date.now(); }, [pathname]);
  useEffect(() => { store.current = storeId; }, [storeId]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      const sid = store.current;
      const items = [...pending.current];
      pending.current.clear();
      if (!sid) return;
      for (const [a, s] of items) if (s > 0) AccountService.addUsage(sid, a, s);
    };
    const active = () => { lastActive.current = Date.now(); };
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !area.current || Date.now() - lastActive.current > IDLE) return;
      const m = pending.current;
      m.set(area.current, (m.get(area.current) ?? 0) + TICK);
      if ([...m.values()].reduce((x, y) => x + y, 0) >= FLUSH_AT) flush();
    }, TICK * 1000);
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, active, { passive: true }));
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, active));
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [enabled]);
}
