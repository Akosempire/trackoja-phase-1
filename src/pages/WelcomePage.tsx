import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { AuthFrame, authSubmitClass } from '../components/AuthLayout';
import { cn } from '../components/kit';

/** Small product vignettes built from the kit, so the slides match the app in both themes. */
function Vignette({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} className="flex h-full w-full items-center justify-center rounded-xl bg-subtle p-4">
      <div className="w-full max-w-[300px] rounded-xl border border-line bg-surface p-4 text-left shadow-card">{children}</div>
    </div>
  );
}

function Row({ title, meta, value, tone }: { title: string; meta: string; value: string; tone?: 'warn' | 'success' | 'brand' }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="m-0 truncate text-[13px] font-medium text-ink">{title}</p>
        <p className="m-0 text-xs text-ink-3">{meta}</p>
      </div>
      <span className={cn('shrink-0 text-[13px] font-semibold tabular-nums',
        !tone && 'text-ink', tone === 'warn' && 'rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn-ink',
        tone === 'success' && 'rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-ink',
        tone === 'brand' && 'rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-ink')}>{value}</span>
    </div>
  );
}

const SLIDES = [
  {
    illustration: (
      <Vignette label="A checkout with three items paid by transfer">
        <p className="m-0 text-xs font-medium text-ink-3">Cart · 3 items</p>
        <div className="divide-y divide-line">
          <Row title="Peak Milk Sachet" meta="4 × ₦700" value="₦2,800" />
          <Row title="Golden Penny Semovita" meta="2 × ₦4,200" value="₦8,400" />
          <Row title="Indomie Chicken" meta="1 carton" value="₦9,500" />
        </div>
        <div className="mt-2 flex h-10 items-center justify-center rounded-md bg-brand text-[13px] font-semibold text-white">Charge ₦20,700</div>
      </Vignette>
    ),
    title: 'Sell in seconds',
    description:
      'Ring up sales from your phone. Search products or scan barcodes with your camera, then accept cash, card, transfer, or customer credit.',
  },
  {
    illustration: (
      <Vignette label="A stock list flagging two items running low">
        <p className="m-0 text-xs font-medium text-ink-3">Stock</p>
        <div className="divide-y divide-line">
          <Row title="Golden Penny Semovita 1kg" meta="Reorder at 5" value="3 left" tone="warn" />
          <Row title="Peak Milk Sachet" meta="Reorder at 10" value="18 left" tone="success" />
          <Row title="Indomie Chicken (carton)" meta="Reorder at 4" value="2 left" tone="warn" />
        </div>
      </Vignette>
    ),
    title: 'Stay on top of stock',
    description:
      'Organize products into categories, track stock levels in real time, and get alerted automatically when items are running low.',
  },
  {
    illustration: (
      <Vignette label="A team list with an owner, a manager and a cashier">
        <p className="m-0 text-xs font-medium text-ink-3">Team</p>
        <div className="divide-y divide-line">
          <Row title="Ada Obi" meta="All stores" value="Owner" tone="brand" />
          <Row title="Tunde Bello" meta="Ikeja branch" value="Manager" />
          <Row title="Chioma Eze" meta="Ikeja branch" value="Cashier" />
        </div>
      </Vignette>
    ),
    title: 'Run your whole team',
    description:
      'Invite staff with the right roles and permissions, and watch revenue, transactions, and stock on one live dashboard.',
  },
];

const WELCOME_SEEN_KEY = 'tk_welcome_seen';

export default function WelcomePage() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  const finish = (path: string) => {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
    navigate(path, { replace: true });
  };

  const handleNext = () => {
    if (isLast) {
      finish('/signup');
    } else {
      setIndex((i) => i + 1);
    }
  };

  return (
    <AuthFrame panel={false}>
      <main className="w-full max-w-[440px]">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink-3">{index + 1} of {SLIDES.length}</span>
            <button type="button" className="h-9 rounded-md px-3 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink" onClick={() => finish('/login')}>
              Skip
            </button>
          </div>

          <div className="h-[300px]">{slide.illustration}</div>

          <div className="mt-6 text-center">
            <h1 className="m-0 text-2xl font-semibold leading-8 tracking-tight text-ink">{slide.title}</h1>
            <p className="m-0 mx-auto mt-2 max-w-[340px] text-sm leading-[22px] text-ink-2">{slide.description}</p>
          </div>

          <div className="my-5 flex items-center justify-center gap-1">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                className="inline-flex h-8 items-center justify-center px-1"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => setIndex(i)}
              >
                <span aria-hidden="true" className={cn('block h-2 rounded-full transition-all', i === index ? 'w-6 bg-brand' : 'w-2 bg-line-strong')} />
              </button>
            ))}
          </div>

          <Button onClick={handleNext} className={authSubmitClass}>{isLast ? 'Get started' : 'Next'}</Button>
        </div>

        <p className="m-0 mt-5 text-center text-sm text-ink-2">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand no-underline hover:underline" onClick={() => localStorage.setItem(WELCOME_SEEN_KEY, '1')}>
            Sign in
          </Link>
        </p>
      </main>
    </AuthFrame>
  );
}
