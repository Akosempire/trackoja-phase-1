import {
  HERO_LOW_STOCK,
  HERO_STATS,
  HERO_TRANSACTIONS,
} from './landingContent';

/**
 * The hero product visual: a TrackOja mobile dashboard rendered as real interface,
 * with three small supporting cards floating around it. Figures are internally
 * consistent (27 sales at an average of ₦6,833 totals ₦184,500).
 */
export function PhonePreview() {
  return (
    <div className="lp-hero-visual">
      <div className="lp-phone" data-reveal>
        <div className="lp-phone-frame">
          <span className="lp-phone-speaker" aria-hidden="true" />
          <div className="lp-phone-screen">
            <div className="lp-app-bar">
              <div className="lp-app-bar-text">
                <p className="lp-app-store">Adeyemi Stores</p>
                <p className="lp-app-meta">Ikeja · Today</p>
              </div>
              <span className="lp-app-avatar" aria-hidden="true">
                AO
              </span>
            </div>

            <div className="lp-app-summary">
              <p className="lp-app-label">Sales today</p>
              <p className="lp-app-total">{HERO_STATS.salesToday}</p>
              <p className="lp-app-sub">
                {HERO_STATS.salesCount} sales · avg {HERO_STATS.averageSale}
              </p>
            </div>

            <div className="lp-app-actions" aria-hidden="true">
              <span className="lp-app-action lp-app-action-primary">New sale</span>
              <span className="lp-app-action">Add product</span>
              <span className="lp-app-action">Reports</span>
            </div>

            <p className="lp-app-section">Recent transactions</p>
            <div className="lp-app-list">
              {HERO_TRANSACTIONS.map((tx) => (
                <div className="lp-app-row" key={tx.id}>
                  <div className="lp-app-row-text">
                    <p className="lp-app-row-title">Sale {tx.id}</p>
                    <p className="lp-app-row-meta">
                      {tx.method} · {tx.time}
                    </p>
                  </div>
                  <p className="lp-app-row-value">{tx.amount}</p>
                </div>
              ))}
            </div>

            <p className="lp-app-section">
              Low stock
              <span className="lp-app-count">{HERO_STATS.lowStockCount}</span>
            </p>
            <div className="lp-app-list">
              {HERO_LOW_STOCK.map((item) => (
                <div className="lp-app-row" key={item.name}>
                  <div className="lp-app-row-text">
                    <p className="lp-app-row-title">{item.name}</p>
                  </div>
                  <span className="lp-pill lp-pill-warn">{item.left}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lp-app-tabbar" aria-hidden="true">
            <span className="lp-app-tab lp-app-tab-active">Home</span>
            <span className="lp-app-tab-scan" />
            <span className="lp-app-tab">Sell</span>
            <span className="lp-app-tab">More</span>
          </div>
        </div>
      </div>

      <div className="lp-float lp-float-payment" data-reveal>
        <span className="lp-pill lp-pill-ok">Payment received</span>
        <p className="lp-float-value">₦12,400</p>
        <p className="lp-float-meta">Cash · sale #1042</p>
      </div>

      <div className="lp-float lp-float-stock" data-reveal>
        <span className="lp-pill lp-pill-warn">Low stock</span>
        <p className="lp-float-value">{HERO_STATS.lowStockCount} items</p>
        <p className="lp-float-meta">At or below reorder level</p>
      </div>

      <div className="lp-float lp-float-average" data-reveal>
        <span className="lp-pill lp-pill-info">Average sale</span>
        <p className="lp-float-value">{HERO_STATS.averageSale}</p>
        <p className="lp-float-meta">Across {HERO_STATS.salesCount} sales today</p>
      </div>
    </div>
  );
}
