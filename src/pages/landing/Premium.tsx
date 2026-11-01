import '@fontsource-variable/bricolage-grotesque';
import { Link } from 'react-router-dom';
import { btn, cn } from '../../components/kit';

/**
 * The landing page's two signature pieces:
 *  - the hero, where a till receipt prints itself (the page's one animation)
 *  - "A day in the shop": the features told as the day really goes,
 *    from opening the till to counting the drawer at night.
 * Everything shown is something TrackOja does today.
 */

export const NIGHT = '#0D1A2E';
const SAFFRON = '#F5B53D';

/** Headline face for the landing page only; the app itself stays in Figtree. */
export const display = 'lp-display';

export function LandingStyles() {
  return (
    <style>{`
      .lp-display { font-family: 'Bricolage Grotesque Variable', var(--font-display); font-optical-sizing: auto; letter-spacing: -0.035em; }
      .lp-receipt { -webkit-mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 14px 100%; mask: conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 14px 100%; padding-bottom: 14px; }
      @keyframes lp-feed { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
      @keyframes lp-line { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      @keyframes lp-chip { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
      .lp-feed { animation: lp-feed 2.6s steps(26, end) .3s both; }
      .lp-line { animation: lp-line .35s ease-out both; }
      .lp-chip { animation: lp-chip .5s cubic-bezier(.2,.9,.3,1) both; }
      @media (prefers-reduced-motion: reduce) { .lp-feed, .lp-line, .lp-chip { animation: none !important; } }
    `}</style>
  );
}

const RECEIPT_ITEMS = [
  { name: 'Rice 50kg', qty: '1 × 62,000', total: '62,000' },
  { name: 'Peak Milk Sachet', qty: '4 × 700', total: '2,800' },
  { name: 'Golden Penny Semovita', qty: '2 × 4,200', total: '8,400' },
];

function Receipt() {
  return (
    <div className="relative mx-auto w-full max-w-[340px] lg:mx-0 lg:ml-auto" role="img"
      aria-label="A sample TrackOja receipt: rice, Peak Milk and Semovita, ₦73,200 paid by transfer, and the stock updated">
      {/* the till slot */}
      <div className="relative z-10 mx-[-14px] h-3 rounded-full bg-[#06101F] shadow-[inset_0_2px_3px_rgba(0,0,0,.6)]" aria-hidden="true" />
      <div className="lp-feed relative -mt-1.5">
        <div className="lp-receipt bg-white px-6 pt-6 font-mono text-[12.5px] leading-[1.55] text-[#2B2F36] shadow-[0_30px_60px_-20px_rgba(0,0,0,.55)]">
          <p className="m-0 text-center font-sans text-[15px] font-bold text-[#111827]">Mama Nkechi Provisions</p>
          <p className="m-0 text-center">Allen Avenue, Ikeja</p>
          <p className="m-0 mt-1 text-center text-[#6B7280]">Receipt 0412 · Cashier: Tunde</p>
          <div className="my-3 border-t border-dashed border-[#9CA3AF]" />
          {RECEIPT_ITEMS.map((it, i) => (
            <div key={it.name} className="lp-line" style={{ animationDelay: `${0.9 + i * 0.45}s` }}>
              <p className="m-0 font-sans text-[13px] font-semibold text-[#111827]">{it.name}</p>
              <p className="m-0 flex justify-between"><span>{it.qty}</span><span>{it.total}</span></p>
            </div>
          ))}
          <div className="my-3 border-t border-dashed border-[#9CA3AF]" />
          <p className="lp-line m-0 flex justify-between font-sans text-[16px] font-bold text-[#111827]" style={{ animationDelay: '2.4s' }}><span>Total</span><span>₦73,200</span></p>
          <p className="lp-line m-0 flex justify-between" style={{ animationDelay: '2.6s' }}><span>Paid by transfer</span><span>73,200</span></p>
          <p className="m-0 mt-3 pb-2 text-center text-[#6B7280]">Thank you. Come again!</p>
        </div>
      </div>
      {/* what happened behind the counter */}
      <div className="lp-chip absolute -left-4 -bottom-7 hidden rounded-xl bg-[#14263F] px-3.5 py-2.5 text-[13px] text-white shadow-[0_12px_30px_-10px_rgba(0,0,0,.7)] ring-1 ring-white/10 sm:block lg:-left-24" style={{ animationDelay: '3.1s' }}>
        <p className="m-0 text-white/60">Stock updated</p>
        <p className="m-0 font-semibold tabular-nums">Peak Milk Sachet 18 → 14</p>
      </div>
      <div className="lp-chip absolute -right-3 top-24 rounded-xl px-3.5 py-2 text-[13px] font-semibold text-[#2A1B00] shadow-[0_12px_30px_-10px_rgba(0,0,0,.6)] sm:-right-10" style={{ animationDelay: '3.4s', background: SAFFRON }}>
        +₦73,200 today
      </div>
    </div>
  );
}

export function PremiumHero({ container }: { container: string }) {
  return (
    <section className="relative overflow-hidden text-white" style={{ background: NIGHT }}>
      {/* a faint grid, like the squares of a shop's ledger book */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.07]"
        style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '44px 44px', maskImage: 'radial-gradient(ellipse 70% 60% at 70% 40%, #000, transparent)' }} />
      <div className={cn(container, 'relative grid items-center gap-14 pb-20 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] lg:gap-10 lg:pb-28 lg:pt-24')}>
        <div>
          <p className="m-0 text-[15px] text-white/70">For supermarkets, pharmacies, boutiques, restaurants and every shop in between</p>
          <h1 className={cn(display, 'm-0 mt-5 text-[46px] font-bold leading-[0.98] sm:text-[64px] lg:text-[78px]')}>
            The till that keeps your stock honest.
          </h1>
          <p className="m-0 mt-6 max-w-[34rem] text-[17px] leading-[1.6] text-white/75 sm:text-[18px]">
            Scan or tap to sell, take cash, transfer or card, and watch your stock count itself down. At closing, count the drawer and see straight away if anything is short, and who was on the till.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link className={cn(btn('primary', 'lg'), 'px-6')} to="/signup">Open your shop on TrackOja</Link>
            <a className="inline-flex h-12 items-center rounded-lg px-5 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/25 no-underline hover:bg-white/10" href="#day">See a day in the shop</a>
          </div>
          <p className="m-0 mt-7 text-[14px] text-white/55">Works on the phone, tablet or computer you already have.</p>
        </div>
        <Receipt />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- a day in the shop

const DAY = [
  {
    time: '7:30 am',
    title: 'Open the till',
    copy: 'Count the float into the drawer and open the till. Every sale from here is tied to this shift and the person on it.',
    detail: [['Float counted', '₦20,000'], ['Cashier', 'Tunde']],
  },
  {
    time: '12:40 pm',
    title: 'Sell, fast',
    copy: 'Scan a barcode or tap a product. Take cash, transfer, card or a mix, and the receipt is ready. Each staff member sells with their own PIN.',
    detail: [['Cart', '3 items'], ['Paid by transfer', '₦73,200']],
  },
  {
    time: '3:15 pm',
    title: 'Restock before you run out',
    copy: 'Peak Milk is running low, so it shows on your list. When the supplier delivers, record it: stock goes up and you see what you owe.',
    detail: [['Peak Milk Sachet', '4 left'], ['Delivery recorded', '+48']],
  },
  {
    time: '9:00 pm',
    title: 'Close and count',
    copy: 'Count the drawer at closing. TrackOja shows what should be there, what you counted, and the difference, so a short drawer never goes unnoticed.',
    detail: [['Expected', '₦184,500'], ['Counted', '₦184,000'], ['Short', '₦500']],
  },
];

export function DayInTheShop({ container }: { container: string }) {
  return (
    <section id="day" className="scroll-mt-16 bg-surface py-20 sm:py-28">
      <div className={container}>
        <h2 className={cn(display, 'm-0 max-w-[16ch] text-[38px] font-bold leading-[1.02] text-ink sm:text-[54px]')}>A day in the shop, from first sale to last count.</h2>
        <p className="m-0 mt-5 max-w-[36rem] text-[17px] leading-[1.6] text-ink-2">This is what a day with TrackOja looks like for a shop like yours.</p>

        <ol className="m-0 mt-14 grid list-none gap-y-12 p-0 lg:mt-20 lg:grid-cols-4 lg:gap-x-8">
          {DAY.map((d, i) => (
            <li key={d.time} className="relative min-w-0 lg:pt-10">
              {/* the day's line, with a mark for each moment */}
              <span aria-hidden="true" className={cn('absolute left-0 top-[11px] hidden h-px bg-line-strong lg:block', i === DAY.length - 1 ? 'w-6' : 'w-[calc(100%+2rem)]')} />
              <span aria-hidden="true" className={cn('absolute left-0 top-[6px] hidden size-[11px] rounded-full ring-4 ring-surface lg:block', i === DAY.length - 1 ? 'bg-[#111827]' : 'bg-brand')} />
              <p className={cn(display, 'm-0 text-[28px] font-semibold leading-none text-ink tabular-nums')}>{d.time}</p>
              <h3 className="m-0 mt-4 text-[18px] font-semibold text-ink">{d.title}</h3>
              <p className="m-0 mt-2 text-[15px] leading-[1.6] text-ink-2">{d.copy}</p>
              <dl className="m-0 mt-5 border-t border-dashed border-line-strong pt-3 font-mono text-[12.5px]">
                {d.detail.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 py-0.5">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className={cn('m-0 font-semibold tabular-nums', k === 'Short' ? 'text-danger' : 'text-ink')}>{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>

        <div className="mt-16 grid gap-6 border-t border-line pt-10 sm:grid-cols-3">
          {[
            ['Mistakes need a manager', 'Voids, refunds, discounts and price changes wait for a manager’s PIN, so nothing quietly disappears.'],
            ['Yesterday in your inbox', 'Every morning, owners and managers get yesterday’s sales by email, so you know how the shop did even when you weren’t there.'],
            ['Your books, done', 'Connect Usetally and every sale becomes a paid invoice with a receipt, ready for your profit and tax.'],
          ].map(([t, c]) => (
            <div key={t}>
              <h3 className="m-0 text-[16px] font-semibold text-ink">{t}</h3>
              <p className="m-0 mt-1.5 text-[15px] leading-[1.6] text-ink-2">{c}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function NightCta({ container }: { container: string }) {
  return (
    <section className="relative overflow-hidden text-white" style={{ background: NIGHT }}>
      <div className={cn(container, 'flex flex-col items-start gap-8 py-20 sm:py-24 lg:flex-row lg:items-end lg:justify-between')}>
        <h2 className={cn(display, 'm-0 max-w-[18ch] text-[40px] font-bold leading-[1.02] sm:text-[58px]')}>Open tomorrow with every sale counted.</h2>
        <div className="flex flex-wrap gap-3">
          <Link className={cn(btn('primary', 'lg'), 'px-6')} to="/signup">Open your shop on TrackOja</Link>
          <Link className="inline-flex h-12 items-center rounded-lg px-5 text-[15px] font-semibold text-white ring-1 ring-inset ring-white/25 no-underline hover:bg-white/10" to="/login">Sign in</Link>
        </div>
      </div>
    </section>
  );
}
