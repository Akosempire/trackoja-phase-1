import { useEffect, useMemo, useState } from 'react';
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
  type BillingCycle,
  type PricingPlan,
} from './landingContent';
import { SubscriptionService } from '../../services/subscription.service';
import { PhonePreview } from './PhonePreview';
import { InstallAppAction } from '../../components/InstallAppAction';
import { useRevealOnScroll } from './useRevealOnScroll';
import {
  IconArrowRight,
  IconCheck,
  IconClose,
  IconCustomers,
  IconMenu,
  IconReports,
  IconSales,
  IconStock,
  TrackOjaLogo,
} from './LandingIcons';
import '../../styles/landing.css';

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

export default function LandingPage() {
  useRevealOnScroll();

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

  // useRevealOnScroll observes the [data-reveal] nodes that exist on mount, so
  // cards that arrive with the fetch would stay at opacity 0. Reveal them here
  // as they mount; the section head and toggle keep their scroll reveal.
  useEffect(() => {
    document
      .querySelectorAll<HTMLElement>('#pricing .lp-price-grid [data-reveal]')
      .forEach((node) => node.classList.add('is-revealed'));
  }, [pricing]);

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

  return (
    <div className="lp">
      <a className="skip-link" href="#lp-main">
        Skip to content
      </a>

      {/* ------------------------------------------------------------ nav */}
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <a className="lp-nav-brand" href="#lp-top" aria-label="TrackOja home">
            <TrackOjaLogo />
          </a>

          <nav className="lp-nav-links" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="lp-nav-link">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="lp-nav-actions">
            <InstallAppAction className="lp-btn lp-btn-quiet" label="Install app" />
            <Link className="lp-btn lp-btn-quiet" to="/login">
              Sign in
            </Link>
            <Link className="lp-btn lp-btn-primary" to="/signup">
              Get started
            </Link>
          </div>

          <button
            type="button"
            className="lp-menu-button"
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <IconClose /> : <IconMenu />}
          </button>
        </div>

        {menuOpen && (
          <div className="lp-mobile-menu" id="lp-mobile-menu">
            <nav className="lp-mobile-links" aria-label="Mobile">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} className="lp-mobile-link" onClick={closeMenu}>
                  {link.label}
                </a>
              ))}
              <Link className="lp-mobile-link" to="/login" onClick={closeMenu}>
                Sign in
              </Link>
              <InstallAppAction className="lp-mobile-link" label="Install app" />
            </nav>
            <Link className="lp-btn lp-btn-primary lp-mobile-cta" to="/signup" onClick={closeMenu}>
              Get started
            </Link>
          </div>
        )}
      </header>

      <main id="lp-main">
        <span id="lp-top" />

        {/* ---------------------------------------------------------- hero */}
        <section className="lp-hero">
          <div className="lp-container">
            <div className="lp-hero-copy" data-reveal>
              <p className="lp-eyebrow">Business management that fits the way you work</p>
              <h1 className="lp-h1">Run your business, all in one place.</h1>
              <p className="lp-lede">
                Manage sales, products, customers, stock, and your team from your phone. Set up
                TrackOja for your type of business and stay on top of every day.
              </p>
              <div className="lp-hero-actions">
                <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/signup">
                  Get started
                  <IconArrowRight />
                </Link>
                <a className="lp-btn lp-btn-outline lp-btn-lg" href="#how-it-works">
                  See how it works
                </a>
              </div>
            </div>

            <PhonePreview />
          </div>
        </section>

        {/* -------------------------------------------------- capabilities */}
        <section className="lp-section" id="features">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <h2 className="lp-h2">Everything you need to stay on top of business.</h2>
            </div>

            <div className="lp-grid lp-grid-4">
              {CAPABILITIES.map((capability, index) => {
                const Icon = CAPABILITY_ICONS[index] ?? IconSales;
                return (
                  <article className="lp-card" key={capability.title} data-reveal>
                    <span className="lp-card-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <h3 className="lp-card-title">{capability.title}</h3>
                    <p className="lp-card-copy">{capability.copy}</p>

                    <div className="lp-fragment">
                      {capability.fragment.map((row) => (
                        <div className="lp-fragment-row" key={row.label}>
                          <div className="lp-fragment-text">
                            <p className="lp-fragment-title">{row.label}</p>
                            <p className="lp-fragment-meta">{row.meta}</p>
                          </div>
                          {row.value && (
                            <span className={`lp-tag${row.tone ? ` lp-tag-${row.tone}` : ''}`}>
                              {row.value}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {capability.note && <p className="lp-card-note">{capability.note}</p>}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ business types */}
        <section className="lp-section lp-section-tint" id="businesses">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <h2 className="lp-h2">Built around your kind of business.</h2>
              <p className="lp-section-copy">
                Choose your business type during setup and work with tools that reflect how you
                operate.
              </p>
            </div>

            <div className="lp-biz" data-reveal>
              <div
                className="lp-tabs"
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
                      className={`lp-tab${selected ? ' is-active' : ''}`}
                      onClick={() => setActiveBusinessId(type.id)}
                    >
                      {type.tabLabel}
                    </button>
                  );
                })}
              </div>

              <div
                className="lp-tab-panel"
                id={`lp-panel-${activeBusiness.id}`}
                role="tabpanel"
                aria-labelledby={`lp-tab-${activeBusiness.id}`}
                tabIndex={0}
                key={activeBusiness.id}
              >
                <div className="lp-biz-text">
                  <h3 className="lp-card-title">{activeBusiness.heading}</h3>
                  <p className="lp-biz-workflow">{activeBusiness.workflow}</p>
                  <p className="lp-biz-note">
                    You can change your business type later in Settings.
                  </p>
                </div>

                <div className="lp-preview">
                  <p className="lp-preview-title">{activeBusiness.previewTitle}</p>
                  <div className="lp-preview-list">
                    {activeBusiness.rows.map((row) => (
                      <div className="lp-preview-row" key={row.label}>
                        <div className="lp-fragment-text">
                          <p className="lp-fragment-title">{row.label}</p>
                          <p className="lp-fragment-meta">{row.meta}</p>
                        </div>
                        {row.value && <span className="lp-tag">{row.value}</span>}
                        {!row.value && row.tone && (
                          <span className={`lp-tag lp-tag-${row.tone}`}>
                            {row.tone === 'ok' ? 'Ready' : row.tone === 'warn' ? 'Due' : 'New'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="lp-biz-others">
                <span className="lp-biz-others-label">Also set up on TrackOja:</span>{' '}
                {OTHER_BUSINESSES.join(' · ')} — and a flexible option for any other business.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- how it works */}
        <section className="lp-section" id="how-it-works">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <h2 className="lp-h2">From setup to your next sale.</h2>
            </div>

            <ol className="lp-steps">
              {STEPS.map((step, index) => (
                <li className="lp-step" key={step.title} data-reveal>
                  <span className="lp-step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3 className="lp-card-title">{step.title}</h3>
                  <p className="lp-card-copy">{step.detail}</p>
                </li>
              ))}
            </ol>

            <p className="lp-callout" data-reveal>
              <strong>No setup fee on Standard.</strong> Standard customers add and update their own
              products — you are not charged for onboarding when you manage your catalogue yourself.
            </p>
          </div>
        </section>

        {/* --------------------------------------------- owner and team */}
        <section className="lp-section lp-section-tint" id="team">
          <div className="lp-container">
            <div className="lp-section-head" data-reveal>
              <h2 className="lp-h2">
                Give your team the tools they need. Keep the full picture in view.
              </h2>
            </div>

            <div className="lp-team">
              <article className="lp-team-card" data-reveal>
                <span className="lp-team-label">Owner</span>
                <h3 className="lp-team-title">Business overview</h3>
                <div className="lp-preview">
                  <p className="lp-preview-title">Today</p>
                  <div className="lp-preview-list">
                    {OWNER_VIEW_ROWS.map((row) => (
                      <div className="lp-preview-row" key={row.label}>
                        <p className="lp-fragment-title">{row.label}</p>
                        <span className={`lp-tag${row.tone ? ` lp-tag-${row.tone}` : ''}`}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="lp-preview-foot">
                    Sales, stock, staff activity, and reports together in one view.
                  </p>
                </div>
              </article>

              <article className="lp-team-card" data-reveal>
                <span className="lp-team-label lp-team-label-staff">Cashier</span>
                <h3 className="lp-team-title">Checkout</h3>
                <div className="lp-preview">
                  <p className="lp-preview-title">Cart · 3 items</p>
                  <div className="lp-preview-list">
                    {STAFF_VIEW_ROWS.map((row) => (
                      <div className="lp-preview-row" key={row.label}>
                        <div className="lp-fragment-text">
                          <p className="lp-fragment-title">{row.label}</p>
                          <p className="lp-fragment-meta">{row.meta}</p>
                        </div>
                        <span className="lp-tag">{row.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="lp-preview-total">
                    <span>Total</span>
                    <strong>{STAFF_VIEW_TOTAL}</strong>
                  </div>
                </div>
              </article>
            </div>

            <div className="lp-roles" data-reveal>
              <p className="lp-roles-title">Sign in as the role that fits the job.</p>
              <div className="lp-grid lp-grid-4">
                {TEAM_ROLES.map((item) => (
                  <div className="lp-role" key={item.role}>
                    <p className="lp-role-name">{item.role}</p>
                    <p className="lp-role-detail">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- pricing */}
        <section className="lp-section" id="pricing">
          <div className="lp-container">
            <div className="lp-section-head lp-section-head-center" data-reveal>
              <p className="lp-eyebrow">Pricing</p>
              <h2 className="lp-h2">A plan for the way your business works</h2>
              <p className="lp-section-copy">
                Start on your own or get hands-on help as your operations grow.
              </p>
            </div>

            <div className="lp-billing" data-reveal>
              <div className="lp-toggle" role="group" aria-label="Billing period">
                <button
                  type="button"
                  className={`lp-toggle-option${billing === 'monthly' ? ' is-active' : ''}`}
                  aria-pressed={billing === 'monthly'}
                  onClick={() => setBilling('monthly')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={`lp-toggle-option${billing === 'annual' ? ' is-active' : ''}`}
                  aria-pressed={billing === 'annual'}
                  onClick={() => setBilling('annual')}
                >
                  Annual
                  <span className="lp-toggle-badge">{ANNUAL_SAVINGS_LABEL}</span>
                </button>
              </div>
              <p className="lp-billing-note" aria-live="polite">
                {billingNote(billing)}
              </p>
            </div>

            {pricing.status === 'loading' && (
              <>
                <p className="sr-only" role="status">
                  Loading published plans
                </p>
                <div className="lp-grid lp-grid-4 lp-price-grid" aria-hidden="true">
                  {PRICE_CARD_PLACEHOLDERS.map((card) => (
                    <article className="lp-price-card" key={card}>
                      <span className="skeleton skeleton-text is-short" />
                      <span className="skeleton skeleton-text" />
                      <span className="skeleton skeleton-text is-short" />
                      <ul className="lp-price-features">
                        {PRICE_FEATURE_PLACEHOLDERS.map((line) => (
                          <li key={line}>
                            <span className="skeleton skeleton-text" />
                          </li>
                        ))}
                      </ul>
                      <span className="skeleton skeleton-card" />
                    </article>
                  ))}
                </div>
              </>
            )}

            {pricing.status === 'ready' && (
              <div className="lp-grid lp-grid-4 lp-price-grid">
                {pricing.plans.map((plan) => {
                  const price = priceFor(plan, billing);
                  const saving = monthsFree(plan.monthlyPrice, plan.annualPrice);
                  return (
                    <article
                      className={`lp-price-card${plan.featured ? ' is-featured' : ''}`}
                      key={plan.id}
                      data-reveal
                    >
                      {plan.featured && <span className="lp-price-flag">Recommended</span>}
                      <h3 className="lp-price-name">{plan.name}</h3>
                      <p className="lp-price-desc">{plan.description}</p>

                      <p className="lp-price-amount">
                        <span className="lp-price-value">{price.amount}</span>
                        {price.suffix && <span className="lp-price-suffix">{price.suffix}</span>}
                      </p>
                      <p className="lp-price-meta">
                        {plan.userLimit}
                        {billing === 'annual' && saving > 0 && (
                          <span className="lp-price-save"> · save {saving} months</span>
                        )}
                      </p>

                      <ul className="lp-price-features">
                        {plan.features.map((feature) => (
                          <li key={feature.key ?? feature.label}>
                            <span className="lp-check" aria-hidden="true">
                              <IconCheck />
                            </span>
                            <span>{feature.label}</span>
                            {feature.upcoming && <span className="lp-soon">Upcoming</span>}
                          </li>
                        ))}
                      </ul>

                      {plan.onboardingNote && (
                        <p className="lp-price-onboarding">{plan.onboardingNote}</p>
                      )}

                      {plan.ctaHref.startsWith('mailto:') ? (
                        <a className="lp-btn lp-btn-outline lp-price-cta" href={plan.ctaHref}>
                          {plan.ctaLabel}
                        </a>
                      ) : (
                        <Link className="lp-btn lp-btn-primary lp-price-cta" to={plan.ctaHref}>
                          {plan.ctaLabel}
                        </Link>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {pricing.status === 'unavailable' && (
              <p className="lp-callout" role="status">
                {pricing.cause === 'failed' ? (
                  <>
                    We could not load our plans, so no price is shown here — we would rather say
                    that than quote a figure that may be out of date. Email{' '}
                    <a className="lp-footer-link" href={`mailto:${CONTACT_EMAIL}`}>
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

            <p className="lp-compare" data-reveal>
              <span className="lp-compare-label">Compare all features</span>
              <span className="lp-soon">Detailed pricing page coming soon</span>
            </p>
          </div>
        </section>

        {/* --------------------------------------------------- final CTA */}
        <section className="lp-final">
          <div className="lp-container lp-final-inner" data-reveal>
            <h2 className="lp-h2">A clearer way to run every day.</h2>
            <p className="lp-lede">
              Bring your sales, stock, customers, and team into one place.
            </p>
            <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/signup">
              Get started with TrackOja
              <IconArrowRight />
            </Link>
          </div>
        </section>
      </main>

      {/* -------------------------------------------------------- footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <TrackOjaLogo />
            <p className="lp-footer-copy">
              TrackOja is a business management platform for small and growing businesses. Record
              sales, track stock, keep customer records, and manage your team from your phone.
            </p>
          </div>

          <nav className="lp-footer-col" aria-label="Product">
            <p className="lp-footer-heading">Product</p>
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="lp-footer-link">
                {link.label}
              </a>
            ))}
          </nav>

          <nav className="lp-footer-col" aria-label="Account">
            <p className="lp-footer-heading">Account</p>
            <Link className="lp-footer-link" to="/signup">
              Get started
            </Link>
            <Link className="lp-footer-link" to="/login">
              Sign in
            </Link>
            <Link className="lp-footer-link" to="/forgot-password">
              Reset password
            </Link>
          </nav>

          <div className="lp-footer-col">
            <p className="lp-footer-heading">Legal</p>
            <Link className="lp-footer-link" to="/privacy">
              Privacy
            </Link>
            <Link className="lp-footer-link" to="/terms">
              Terms
            </Link>
          </div>
        </div>

        <div className="lp-container lp-footer-base">
          <p>By {COMPANY_NAME}.</p>
          <p>© {new Date().getFullYear()} TrackOja</p>
        </div>
      </footer>
    </div>
  );
}
