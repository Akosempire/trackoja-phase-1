import { useBillingAvailability } from '../../hooks/useBillingAvailability';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ANNUAL_SAVINGS_LABEL,
  BUSINESS_TYPES,
  CAPABILITIES,
  COMPANY_NAME,
  CONTACT_EMAIL,
  NAV_LINKS,
  OTHER_BUSINESSES,
  OWNER_VIEW_ROWS,
  STAFF_VIEW_ROWS,
  STAFF_VIEW_TOTAL,
  STEPS,
  TEAM_ROLES,
  billingNote,
  monthsFree,
  priceFor,
  toPricingPlans,
  visiblePricingFeatures,
  type BillingCycle,
  type BusinessPreviewRow,
  type PricingPlan,
} from './landingContent';
import { SubscriptionService } from '../../services/subscription.service';
import { InstallAppAction } from '../../components/InstallAppAction';
import { btn, cn } from '../../components/kit';
import { APP_NAME } from '../../config/brand';
import {
  BrandLogo,
  IconArrowRight,
  IconCheck,
  IconClose,
  IconCustomers,
  IconMenu,
  IconReports,
  IconSales,
  IconStock,
} from './LandingIcons';

const CAPABILITY_ICONS = [IconSales, IconStock, IconCustomers, IconReports];

/** Loading placeholders: the same grid, filled with the same card shape. */
const PRICE_CARD_PLACEHOLDERS = [1, 2, 3, 4];
const PRICE_FEATURE_PLACEHOLDERS = [1, 2, 3, 4, 5];

/**
 * The pricing section's state. `unavailable` is a real answer, not an error
 * state to paper over: the page has no price list of its own to fall back on.
 */
type PricingState =
  | { status: 'loading' }
  | { status: 'ready'; plans: PricingPlan[] }
  | { status: 'unavailable'; cause: 'failed' | 'empty' };

const container = 'mx-auto w-full max-w-[1160px] px-4 sm:px-6 lg:px-8';
const sectionTitle = 'm-0 text-[26px] font-semibold leading-[34px] tracking-tight text-ink sm:text-[32px] sm:leading-10';
const sectionCopy = 'm-0 mt-3 text-[15px] leading-6 text-ink-2';
const surfaceCard = 'min-w-0 rounded-xl border border-line bg-surface shadow-card';
const footerLink = 'text-sm text-ink-2 no-underline hover:text-ink';

const TONE_TAG: Record<NonNullable<BusinessPreviewRow['tone']>, string> = {
  ok: 'bg-success-soft text-success-ink',
  warn: 'bg-warn-soft text-warn-ink',
  info: 'bg-brand-soft text-brand-ink',
};

function Tag({ tone, children }: { tone?: BusinessPreviewRow['tone']; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium tabular-nums',
      tone ? TONE_TAG[tone] : 'bg-tray text-ink-2')}>{children}</span>
  );
}

function PreviewRow({ label, meta, children }: { label: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="m-0 truncate text-[13px] font-medium text-ink">{label}</p>
        {meta && <p className="m-0 truncate text-xs text-ink-3">{meta}</p>}
      </div>
      {children}
    </div>
  );
}

function SectionHead({ eyebrow, title, copy, center }: { eyebrow?: string; title: string; copy?: string; center?: boolean }) {
  return (
    <div className={cn('mb-8 max-w-[640px] sm:mb-10', center && 'mx-auto text-center')}>
      {eyebrow && <p className="m-0 mb-2 text-[13px] font-semibold text-brand">{eyebrow}</p>}
      <h2 className={sectionTitle}>{title}</h2>
      {copy && <p className={sectionCopy}>{copy}</p>}
    </div>
  );
}

/** The hero's product preview, drawn from the same sample rows the page shows below. */
function HeroPreview() {
  return (
    <div role="img" aria-label={`Sample ${APP_NAME} screens: today's sales summary and a cashier's cart`} className="relative mx-auto w-full max-w-[460px] lg:mr-0">
      <div className="rounded-2xl border border-line bg-tray p-3 shadow-pop sm:p-4">
        <div className={cn(surfaceCard, 'p-4 sm:p-5')}>
          <div className="flex items-center justify-between">
            <p className="m-0 text-[13px] font-medium text-ink-2">Today</p>
            <Tag tone="ok">Live</Tag>
          </div>
          <p className="m-0 mt-2 text-[30px] font-semibold leading-9 tracking-tight tabular-nums text-ink">{OWNER_VIEW_ROWS[0].value}</p>
          <p className="m-0 text-xs text-ink-3">{OWNER_VIEW_ROWS[0].label}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {OWNER_VIEW_ROWS.slice(1).map((row) => (
              <div key={row.label} className="min-w-0 rounded-lg bg-subtle px-2.5 py-2">
                <p className="m-0 truncate text-[11px] text-ink-3">{row.label}</p>
                <p className={cn('m-0 mt-0.5 text-[15px] font-semibold tabular-nums', 'tone' in row && row.tone === 'warn' ? 'text-warn-ink' : 'text-ink')}>{row.value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={cn(surfaceCard, 'mt-3 p-4 sm:p-5')}>
          <p className="m-0 text-[13px] font-medium text-ink-2">Cart · {STAFF_VIEW_ROWS.length} items</p>
          <div className="divide-y divide-line">
            {STAFF_VIEW_ROWS.map((row) => (
              <PreviewRow key={row.label} label={row.label} meta={row.meta}>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{row.value}</span>
              </PreviewRow>
            ))}
          </div>
          <div className="mt-2 flex h-11 items-center justify-between rounded-md bg-brand px-4 text-sm font-semibold text-white">
            <span>Charge</span><span className="tabular-nums">{STAFF_VIEW_TOTAL}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { billing: availability } = useBillingAvailability();

  const [menuOpen, setMenuOpen] = useState(false);
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [activeBusinessId, setActiveBusinessId] = useState(BUSINESS_TYPES[0].id);
  const [pricing, setPricing] = useState<PricingState>({ status: 'loading' });

  const activeBusiness = useMemo(
    () => BUSINESS_TYPES.find((b) => b.id === activeBusinessId) ?? BUSINESS_TYPES[0],
    [activeBusinessId]
  );

  // The published catalogue is the only source of prices on this page. One read
  // on mount, and no fallback ladder: if it fails, saying prices are unavailable
  // beats showing a prospect numbers that no longer match what they are charged.
  useEffect(() => {
    let active = true;

    SubscriptionService.getPublishedPlans()
      .then((published) => {
        if (!active) return;
        setPricing(
          published.length === 0
            ? { status: 'unavailable', cause: 'empty' }
            : { status: 'ready', plans: toPricingPlans(published) }
        );
      })
      .catch(() => {
        if (active) setPricing({ status: 'unavailable', cause: 'failed' });
      });

    return () => {
      active = false;
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  /** Arrow-key support for the business type tabs. */
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = BUSINESS_TYPES.findIndex((b) => b.id === activeBusinessId);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + offset + BUSINESS_TYPES.length) % BUSINESS_TYPES.length;
    const nextId = BUSINESS_TYPES[next].id;
    setActiveBusinessId(nextId);
    document.getElementById(`lp-tab-${nextId}`)?.focus();
  };

  const priceGridCols = pricing.status === 'ready' && pricing.plans.length <= 3
    ? 'lg:grid-cols-3 lg:max-w-[960px]'
    : 'lg:grid-cols-4';

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-pop" href="#lp-main">
        Skip to content
      </a>

      {/* ------------------------------------------------------------ nav */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
        <div className={cn(container, 'flex h-16 items-center justify-between gap-4')}>
          <a className="rounded-md no-underline" href="#lp-top" aria-label={`${APP_NAME} home`}>
            <BrandLogo />
          </a>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className={btn('ghost', 'sm')}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <InstallAppAction className={btn('ghost')} label="Install app" />
            <Link className={btn('outline')} to="/login">
              Sign in
            </Link>
            <Link className={btn('primary')} to="/signup">
              Get started
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md text-ink hover:bg-hover lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <IconClose /> : <IconMenu />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-line bg-surface px-4 pb-5 pt-2 lg:hidden" id="lp-mobile-menu">
            <nav className="flex flex-col" aria-label="Mobile">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} className="flex h-12 items-center border-b border-line text-[15px] font-medium text-ink no-underline" onClick={closeMenu}>
                  {link.label}
                </a>
              ))}
              <Link className="flex h-12 items-center border-b border-line text-[15px] font-medium text-ink no-underline" to="/login" onClick={closeMenu}>
                Sign in
              </Link>
              <InstallAppAction className="flex h-12 w-full items-center border-0 border-b border-line bg-transparent p-0 text-left text-[15px] font-medium text-ink" label="Install app" />
            </nav>
            <Link className={cn(btn('primary', 'lg'), 'mt-4 w-full')} to="/signup" onClick={closeMenu}>
              Get started
            </Link>
          </div>
        )}
      </header>

      <main id="lp-main">
        <span id="lp-top" />

        {/* ---------------------------------------------------------- hero */}
        <section className="border-b border-line bg-surface">
          <div className={cn(container, 'grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:py-24')}>
            <div className="min-w-0">
              <p className="m-0 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand-ink">
                Point of sale and stock for small shops
              </p>
              <h1 className="m-0 mt-5 text-[36px] font-semibold leading-[42px] tracking-tight text-ink sm:text-5xl sm:leading-[56px] lg:text-[56px] lg:leading-[64px]">
                <span className="block">Sell faster.</span>
                <span className="block">Track stock.</span>
                <span className="block text-brand">Know your profit.</span>
              </h1>
              <p className="m-0 mt-5 max-w-[540px] text-base leading-7 text-ink-2 sm:text-[17px]">
                {APP_NAME} records every sale, updates stock as you sell, and shows how the day
                went, from the phone you already have. Set it up for your type of business in minutes.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link className={btn('primary', 'lg')} to="/signup">
                  Get started
                  <IconArrowRight width={18} />
                </Link>
                <a className={btn('outline', 'lg')} href="#how-it-works">
                  See how it works
                </a>
              </div>
              <ul className="m-0 mt-8 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-[13px] text-ink-2">
                {['Works on any phone', 'Cash, card and transfer', 'Owner and staff roles'].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <span className="text-success"><IconCheck width={16} /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <HeroPreview />
          </div>
        </section>

        {/* -------------------------------------------------- capabilities */}
        <section className="scroll-mt-16 py-16 sm:py-20" id="features">
          <div className={container}>
            <SectionHead eyebrow="Features" title="Everything you need to stay on top of business." />

            <div className="grid gap-4 md:grid-cols-2">
              {CAPABILITIES.map((capability, index) => {
                const Icon = CAPABILITY_ICONS[index] ?? IconSales;
                return (
                  <article className={cn(surfaceCard, 'flex flex-col p-5')} key={capability.title}>
                    <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand-ink" aria-hidden="true">
                      <Icon width={20} />
                    </span>
                    <h3 className="m-0 mt-4 text-[16px] font-semibold text-ink">{capability.title}</h3>
                    <p className="m-0 mt-1 text-sm leading-[22px] text-ink-2">{capability.copy}</p>

                    <div className="mt-4 divide-y divide-line rounded-lg bg-subtle px-3">
                      {capability.fragment.map((row) => (
                        <PreviewRow key={row.label} label={row.label} meta={row.meta}>
                          {row.value && <Tag tone={row.tone}>{row.value}</Tag>}
                        </PreviewRow>
                      ))}
                    </div>

                    {capability.note && <p className="m-0 mt-3 text-xs text-ink-3">{capability.note}</p>}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ business types */}
        <section className="scroll-mt-16 border-y border-line bg-surface py-16 sm:py-20" id="businesses">
          <div className={container}>
            <SectionHead
              eyebrow="Businesses"
              title="Built around your kind of business."
              copy="Choose your business type during setup and work with tools that reflect how you operate."
            />

            <div
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
              role="tablist"
              aria-label="Business types"
              onKeyDown={handleTabKeyDown}
            >
              {BUSINESS_TYPES.map((type) => {
                const selected = type.id === activeBusinessId;
                return (
                  <button
                    key={type.id}
                    id={`lp-tab-${type.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`lp-panel-${type.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={cn('h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                      selected ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover hover:text-ink')}
                    onClick={() => setActiveBusinessId(type.id)}
                  >
                    {type.tabLabel}
                  </button>
                );
              })}
            </div>

            <div
              className="mt-6 grid gap-6 rounded-2xl bg-tray p-4 focus-visible:outline-2 focus-visible:outline-brand sm:p-6 lg:grid-cols-2 lg:items-center lg:gap-10 lg:p-10"
              id={`lp-panel-${activeBusiness.id}`}
              role="tabpanel"
              aria-labelledby={`lp-tab-${activeBusiness.id}`}
              tabIndex={0}
              key={activeBusiness.id}
            >
              <div className="min-w-0">
                <h3 className="m-0 text-xl font-semibold text-ink">{activeBusiness.heading}</h3>
                <p className="m-0 mt-2 text-[15px] leading-6 text-ink-2">{activeBusiness.workflow}</p>
                <p className="m-0 mt-4 text-[13px] text-ink-3">
                  You can change your business type later in Settings.
                </p>
              </div>

              <div className={cn(surfaceCard, 'p-4 sm:p-5')}>
                <p className="m-0 text-[13px] font-medium text-ink-2">{activeBusiness.previewTitle}</p>
                <div className="divide-y divide-line">
                  {activeBusiness.rows.map((row) => (
                    <PreviewRow key={row.label} label={row.label} meta={row.meta}>
                      {row.value && <Tag>{row.value}</Tag>}
                      {!row.value && row.tone && (
                        <Tag tone={row.tone}>{row.tone === 'ok' ? 'Ready' : row.tone === 'warn' ? 'Due' : 'New'}</Tag>
                      )}
                    </PreviewRow>
                  ))}
                </div>
              </div>
            </div>

            <p className="m-0 mt-6 text-sm leading-6 text-ink-2">
              <span className="font-semibold text-ink">Also set up on {APP_NAME}:</span>{' '}
              {OTHER_BUSINESSES.join(' · ')}, and a flexible option for any other business.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------- how it works */}
        <section className="scroll-mt-16 py-16 sm:py-20" id="how-it-works">
          <div className={container}>
            <SectionHead eyebrow="How it works" title="From setup to your next sale." />

            <ol className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
              {STEPS.map((step, index) => (
                <li className={cn(surfaceCard, 'p-5 sm:p-6')} key={step.title}>
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white" aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3 className="m-0 mt-4 text-[16px] font-semibold leading-6 text-ink">{step.title}</h3>
                  <p className="m-0 mt-1.5 text-sm leading-[22px] text-ink-2">{step.detail}</p>
                </li>
              ))}
            </ol>

            <p className="m-0 mt-6 rounded-xl border border-brand-line bg-brand-soft px-5 py-4 text-sm leading-6 text-brand-ink">
              <strong className="font-semibold">No setup fee on Standard.</strong> Standard customers add and update their own
              products. You are not charged for onboarding when you manage your catalogue yourself.
            </p>
          </div>
        </section>

        {/* --------------------------------------------- owner and team */}
        <section className="scroll-mt-16 border-y border-line bg-surface py-16 sm:py-20" id="team">
          <div className={container}>
            <SectionHead eyebrow="Your team" title="Give your team the tools they need. Keep the full picture in view." />

            <div className="grid gap-4 lg:grid-cols-2">
              <article className="min-w-0 rounded-2xl bg-tray p-4 sm:p-6">
                <Tag tone="info">Owner</Tag>
                <h3 className="m-0 mt-3 text-[16px] font-semibold text-ink">Business overview</h3>
                <div className={cn(surfaceCard, 'mt-4 p-4 sm:p-5')}>
                  <p className="m-0 text-[13px] font-medium text-ink-2">Today</p>
                  <div className="divide-y divide-line">
                    {OWNER_VIEW_ROWS.map((row) => (
                      <PreviewRow key={row.label} label={row.label}>
                        <Tag tone={'tone' in row ? row.tone : undefined}>{row.value}</Tag>
                      </PreviewRow>
                    ))}
                  </div>
                  <p className="m-0 mt-2 border-t border-line pt-3 text-xs text-ink-3">
                    Sales, stock, staff activity, and reports together in one view.
                  </p>
                </div>
              </article>

              <article className="min-w-0 rounded-2xl bg-tray p-4 sm:p-6">
                <Tag tone="ok">Cashier</Tag>
                <h3 className="m-0 mt-3 text-[16px] font-semibold text-ink">Checkout</h3>
                <div className={cn(surfaceCard, 'mt-4 p-4 sm:p-5')}>
                  <p className="m-0 text-[13px] font-medium text-ink-2">Cart · 3 items</p>
                  <div className="divide-y divide-line">
                    {STAFF_VIEW_ROWS.map((row) => (
                      <PreviewRow key={row.label} label={row.label} meta={row.meta}>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{row.value}</span>
                      </PreviewRow>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-line pt-3 text-sm">
                    <span className="text-ink-2">Total</span>
                    <strong className="font-semibold tabular-nums text-ink">{STAFF_VIEW_TOTAL}</strong>
                  </div>
                </div>
              </article>
            </div>

            <div className="mt-10">
              <p className="m-0 mb-4 text-[15px] font-semibold text-ink">Sign in as the role that fits the job.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {TEAM_ROLES.map((item) => (
                  <div className="rounded-xl border border-line p-4" key={item.role}>
                    <p className="m-0 text-sm font-semibold text-ink">{item.role}</p>
                    <p className="m-0 mt-1 text-[13px] leading-5 text-ink-2">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- pricing */}
        <section className="scroll-mt-16 py-16 sm:py-20" id="pricing">
          <div className={container}>
            <SectionHead
              center
              eyebrow="Pricing"
              title="A plan for the way your business works"
              copy="Start on your own or get hands-on help as your operations grow."
            />

            <div className="mb-8 flex flex-col items-center gap-2">
              <div className="inline-flex gap-0.5 rounded-lg bg-tray p-1" role="group" aria-label="Billing period">
                {(['monthly', 'annual'] as const).map((cycle) => (
                  <button
                    key={cycle}
                    type="button"
                    className={cn('inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
                      billing === cycle ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
                    aria-pressed={billing === cycle}
                    onClick={() => setBilling(cycle)}
                  >
                    {cycle === 'monthly' ? 'Monthly' : 'Annual'}
                    {cycle === 'annual' && (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-ink">{ANNUAL_SAVINGS_LABEL}</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="m-0 text-[13px] text-ink-3" aria-live="polite">
                {billingNote(billing)}
              </p>
            </div>

            {pricing.status === 'loading' && (
              <>
                <p className="sr-only" role="status">
                  Loading published plans
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
                  {PRICE_CARD_PLACEHOLDERS.map((card) => (
                    <article className={cn(surfaceCard, 'flex flex-col gap-3 p-5')} key={card}>
                      <span className="block h-5 w-24 animate-pulse rounded bg-tray" />
                      <span className="block h-4 w-full animate-pulse rounded bg-tray" />
                      <span className="block h-8 w-32 animate-pulse rounded bg-tray" />
                      <ul className="m-0 list-none space-y-2 p-0">
                        {PRICE_FEATURE_PLACEHOLDERS.map((line) => (
                          <li key={line}>
                            <span className="block h-3.5 w-full animate-pulse rounded bg-tray" />
                          </li>
                        ))}
                      </ul>
                      <span className="block h-10 w-full animate-pulse rounded-md bg-tray" />
                    </article>
                  ))}
                </div>
              </>
            )}

            {pricing.status === 'ready' && (
              <div className={cn('mx-auto grid gap-4 sm:grid-cols-2', priceGridCols)}>
                {pricing.plans.map((plan) => {
                  const price = priceFor(plan, billing);
                  const saving = monthsFree(plan.monthlyPrice, plan.annualPrice);
                  return (
                    <article
                      className={cn(surfaceCard, 'relative flex flex-col p-5 sm:p-6', plan.featured && 'border-brand ring-2 ring-brand/20')}
                      key={plan.id}
                    >
                      {plan.featured && <span className="absolute right-4 top-4 inline-flex h-6 items-center rounded-full bg-brand px-2.5 text-xs font-semibold text-white">Recommended</span>}
                      <h3 className="m-0 pr-28 text-[17px] font-semibold text-ink">{plan.name}</h3>
                      {plan.description && <p className="m-0 mt-1 text-[13px] leading-5 text-ink-2">{plan.description}</p>}

                      <p className="m-0 mt-5 flex flex-wrap items-baseline gap-1">
                        <span className="text-[28px] font-semibold leading-9 tracking-tight tabular-nums text-ink">{price.amount}</span>
                        {price.suffix && <span className="text-sm text-ink-3">{price.suffix}</span>}
                      </p>
                      <p className="m-0 mt-1 text-[13px] text-ink-3">
                        {plan.userLimit}
                        {billing === 'annual' && saving > 0 && (
                          <span className="font-medium text-success-ink"> · save {saving} months</span>
                        )}
                      </p>

                      <ul className="m-0 mt-5 flex-1 list-none space-y-2.5 border-t border-line p-0 pt-5">
                        {visiblePricingFeatures(plan.features).map((feature) => (
                          <li key={feature.key ?? feature.label} className="flex gap-2 text-[13px] leading-5 text-ink-2">
                            <span className="mt-px shrink-0 text-success" aria-hidden="true">
                              <IconCheck width={16} />
                            </span>
                            <span>{feature.label}</span>
                          </li>
                        ))}
                      </ul>

                      {plan.onboardingNote && (
                        <p className="m-0 mt-4 rounded-lg bg-subtle px-3 py-2 text-xs leading-5 text-ink-2">{plan.onboardingNote}</p>
                      )}

                      {plan.ctaHref.startsWith('mailto:') ? (
                        <a className={cn(btn('outline'), 'mt-5 w-full')} href={plan.ctaHref}>
                          {plan.ctaLabel}
                        </a>
                      ) : (
                        <Link className={cn(btn(plan.featured ? 'primary' : 'outline'), 'mt-5 w-full')} to={plan.ctaHref}>
                          {availability?.trialEnabled && availability.paymentSystem !== 'LIVE' ? 'Start Free Trial' : plan.ctaLabel}
                        </Link>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {pricing.status === 'unavailable' && (
              <p className="m-0 mx-auto max-w-[640px] rounded-xl border border-line bg-surface px-5 py-4 text-center text-sm leading-6 text-ink-2" role="status">
                {pricing.cause === 'failed' ? (
                  <>
                    We could not load our plans, so no price is shown here. We would rather say
                    that than quote a figure that may be out of date. Email{' '}
                    <a className="font-medium text-brand" href={`mailto:${CONTACT_EMAIL}`}>
                      {CONTACT_EMAIL}
                    </a>{' '}
                    and we will confirm current pricing.
                  </>
                ) : (
                  <>
                    No plans are published right now, so there is no pricing on this page. Please
                    check back shortly.
                  </>
                )}
              </p>
            )}
          </div>
        </section>

        {/* --------------------------------------------------- final CTA */}
        <section className="pb-16 sm:pb-20">
          <div className={container}>
            <div className="rounded-2xl bg-brand px-6 py-12 text-center sm:px-12 sm:py-16">
              <h2 className="m-0 text-[26px] font-semibold leading-[34px] tracking-tight text-white sm:text-[32px] sm:leading-10">A clearer way to run every day.</h2>
              <p className="m-0 mx-auto mt-3 max-w-[480px] text-[15px] leading-6 text-white/85">
                Bring your sales, stock, customers, and team into one place.
              </p>
              <Link className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white px-5 text-[15px] font-semibold text-brand no-underline transition-colors hover:bg-white/90" to="/signup">
                Get started with {APP_NAME}
                <IconArrowRight width={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* -------------------------------------------------------- footer */}
      <footer className="border-t border-line bg-surface">
        <div className={cn(container, 'grid grid-cols-3 gap-x-4 gap-y-10 py-12 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]')}>
          <div className="col-span-3 max-w-[360px] lg:col-span-1">
            <BrandLogo size="sm" />
            <p className="m-0 mt-4 text-sm leading-[22px] text-ink-2">
              {APP_NAME} is a business management platform for small and growing businesses. Record
              sales, track stock, keep customer records, and manage your team from your phone.
            </p>
          </div>

          <nav className="flex flex-col gap-2.5" aria-label="Product">
            <p className="m-0 mb-1 text-[13px] font-semibold text-ink">Product</p>
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className={footerLink}>
                {link.label}
              </a>
            ))}
          </nav>

          <nav className="flex flex-col gap-2.5" aria-label="Account">
            <p className="m-0 mb-1 text-[13px] font-semibold text-ink">Account</p>
            <Link className={footerLink} to="/signup">
              Get started
            </Link>
            <Link className={footerLink} to="/login">
              Sign in
            </Link>
            <Link className={footerLink} to="/forgot-password">
              Reset password
            </Link>
          </nav>

          <div className="flex flex-col gap-2.5">
            <p className="m-0 mb-1 text-[13px] font-semibold text-ink">Legal</p>
            <Link className={footerLink} to="/privacy">
              Privacy
            </Link>
            <Link className={footerLink} to="/terms">
              Terms
            </Link>
          </div>
        </div>

        <div className={cn(container, 'flex flex-col gap-1 border-t border-line py-6 text-[13px] text-ink-3 sm:flex-row sm:justify-between')}>
          <p className="m-0">By {COMPANY_NAME}.</p>
          <p className="m-0">© {new Date().getFullYear()} {APP_NAME}</p>
        </div>
      </footer>
    </div>
  );
}
