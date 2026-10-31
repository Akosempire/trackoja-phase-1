import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from './ui/Button';

/**
 * A short guided tour: a spotlight on one part of the screen at a time (any
 * element marked data-tour="…") with a card explaining it. Steps whose part
 * isn't on screen for this person (their role can't see it, or it sits in the
 * phone menu) fall back to the phone menu button or a centred card, so it works
 * for every role and screen size.
 *
 * Opens by itself once, on the Overview, per person on this device. "Take the
 * tour" (Support and More) replays it via startTour().
 */
export interface TourStep { anchor?: string; mobile?: string; title: string; body: string }

export const TOUR_STEPS: TourStep[] = [
  { title: 'Welcome to TrackOja 👋', body: 'A one-minute look at how to run your shop here. Use the buttons or arrow keys, and skip whenever you like.' },
  { anchor: 'nav:/inventory/products', mobile: 'menu', title: 'Add your products', body: 'Start here. Add each product with its price and how many you have. You can also import a whole list from Excel.' },
  { anchor: 'nav:/till', mobile: 'menu', title: 'Open the till', body: 'At the start of the day, open the till and count the cash in the drawer. At closing time you count again and see if anything is missing.' },
  { anchor: 'scan', title: 'Sell', body: 'Tap Scan or POS to sell. Scan a barcode or tap a product, take cash, transfer or POS, and the receipt is ready.' },
  { anchor: 'nav:/inventory/restock', mobile: 'menu', title: 'Restock', body: 'When goods arrive from a supplier, record them here. Stock goes up and you see what you owe. Low stock shows here too.' },
  { anchor: 'nav:/staff', mobile: 'menu', title: 'Add your staff', body: 'Invite cashiers and managers, and give each a PIN so every sale shows who made it.' },
  { anchor: 'nav:/dashboard', title: 'Check how you did', body: 'Overview shows today’s sales, what’s running low and what needs attention. Reports go deeper.' },
  { anchor: 'nav:/support', mobile: 'nav:/more', title: 'Need help?', body: 'Message our team from Support any time. You can take this tour again from there.' },
];

const PAD = 8;
const EVENT = 'trackoja:tour';
const doneKey = (userId: string) => `trackoja:tour-done:${userId}`;

const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};
const find = (key?: string): HTMLElement | null =>
  key ? ([...document.querySelectorAll(`[data-tour="${CSS.escape(key)}"]`)].find(visible) as HTMLElement | undefined) ?? null : null;

/** Steps that make sense for this person on this screen. */
export function planTour(steps: TourStep[], present: (key: string) => boolean): TourStep[] {
  return steps.filter((s) => !s.anchor || present(s.anchor) || (s.mobile ? present(s.mobile) : false));
}

/** Replays the tour from anywhere (Support, More). */
export function startTour(): void { window.dispatchEvent(new Event(EVENT)); }

export function Tour({ userId }: { userId: string }) {
  const { pathname } = useLocation();
  const [step, setStep] = useState<number | null>(null);
  const [steps, setSteps] = useState<TourStep[]>(TOUR_STEPS);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);

  const open = useCallback(() => { setSteps(planTour(TOUR_STEPS, (k) => Boolean(find(k)))); setStep(0); }, []);
  const close = useCallback(() => {
    setStep(null); setBox(null);
    try { localStorage.setItem(doneKey(userId), '1'); } catch { /* storage blocked: it may show again */ }
  }, [userId]);

  // first time on the Overview: open once
  useEffect(() => {
    if (pathname !== '/dashboard') return;
    let seen = false;
    try { seen = localStorage.getItem(doneKey(userId)) === '1'; } catch { seen = false; }
    if (seen) return;
    const t = window.setTimeout(open, 1200);
    return () => window.clearTimeout(t);
  }, [pathname, userId, open]);

  useEffect(() => {
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, [open]);

  const current = step == null ? null : steps[step];
  const direct = current?.anchor ? find(current.anchor) : null;
  const target = direct ?? (current?.mobile ? find(current.mobile) : null);
  const viaMenu = Boolean(current?.anchor && !direct && target && current.mobile === 'menu');

  useLayoutEffect(() => {
    if (!current) return;
    if (!target) { setBox(null); return; }
    const r0 = target.getBoundingClientRect();
    if (r0.top < 72 || r0.bottom > window.innerHeight - 180) target.scrollIntoView({ block: 'center' });
    const measure = () => { const r = target.getBoundingClientRect(); setBox({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 }); };
    measure();
    const id = window.setInterval(measure, 150);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.clearInterval(id); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [current, target]);

  useEffect(() => {
    if (step == null) return;
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setStep((s) => (s != null && s < steps.length - 1 ? s + 1 : s));
      else if (e.key === 'ArrowLeft') setStep((s) => (s != null && s > 0 ? s - 1 : s));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, steps.length, close]);

  if (!current || step == null) return null;
  const last = step === steps.length - 1;
  const vw = window.innerWidth, vh = window.innerHeight;
  const W = Math.min(340, vw - 24);
  let pos: React.CSSProperties;
  if (!box) pos = { left: (vw - W) / 2, top: Math.max(24, vh / 2 - 130) };
  else {
    const left = Math.min(Math.max(12, box.x + box.w / 2 - W / 2), vw - W - 12);
    if (box.y + box.h + 12 + 210 < vh) pos = { left, top: box.y + box.h + 12 };
    else if (box.y - 12 - 210 > 0) pos = { left, bottom: vh - box.y + 12 };
    else pos = { left: Math.min(box.x + box.w + 12, vw - W - 12), top: Math.max(12, Math.min(box.y, vh - 230)) };
  }

  return (
    <div className="fixed inset-0 z-[80]" role="presentation">
      <svg className="absolute inset-0 size-full" aria-hidden="true" onClick={close}>
        <defs>
          <mask id="tour-hole">
            <rect width="100%" height="100%" fill="white" />
            {box && <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="12" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(16 24 40 / .55)" mask="url(#tour-hole)" />
      </svg>
      {box && <div aria-hidden="true" className="pointer-events-none absolute rounded-xl ring-2 ring-brand transition-all duration-200 motion-reduce:transition-none" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}

      <div ref={card} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
        className="absolute rounded-2xl bg-surface p-5 shadow-card-interactive ring-1 ring-line outline-none" style={{ width: W, ...pos }}>
        <div className="flex items-start gap-3">
          <p className="m-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3" aria-live="polite">Step {step + 1} of {steps.length}</p>
          <button type="button" onClick={close} aria-label="Close the tour" className="-mr-2 -mt-2 inline-flex size-11 items-center justify-center rounded-md text-lg leading-none text-ink-3 hover:bg-hover hover:text-ink">×</button>
        </div>
        <h2 id="tour-title" className="m-0 mt-1 text-[17px] font-semibold text-ink">{current.title}</h2>
        <p id="tour-body" className="m-0 mt-1.5 text-sm leading-relaxed text-ink-2">
          {current.body}
          {viaMenu && <span className="mt-1.5 block text-ink-3">On your phone, it’s in the menu (☰).</span>}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-brand' : 'w-1.5 bg-line-strong'}`} />)}
          </div>
          {step > 0
            ? <Button variant="outline" className="h-11 min-w-11" onClick={() => setStep(step - 1)} aria-label="Previous step">←</Button>
            : <Button variant="ghost" className="h-11" onClick={close}>Skip</Button>}
          <Button className="h-11" onClick={() => (last ? close() : setStep(step + 1))}>{last ? 'Done' : step === 0 ? 'Show me' : 'Next →'}</Button>
        </div>
      </div>
    </div>
  );
}
