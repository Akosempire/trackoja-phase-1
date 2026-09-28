import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const styles = [
  'src/styles/theme.css',
  'src/styles/app.css',
  'src/styles/tokens.css',
  'src/styles/waya.css',
  'src/styles/waya-components.css',
  'src/styles/mobile.css',
  'src/styles/dashboard.css',
  'src/styles/reports.css',
  'src/styles/platform-overview.css',
];

async function mountLayout(page: Page, theme: 'light' | 'dark') {
  await page.setContent(`<!doctype html><html data-theme="${theme}"><body>
    <main class="app-main"><div class="page reports-page dash">
      <nav class="route-back-bar"><a class="route-back-link" href="#">← <span>Back to dashboard</span></a></nav>
      <header class="page-header"><div><h1 class="page-title">Reports</h1><p class="page-subtitle">Today · 28 September 2026</p></div><div class="btn-row"><button class="btn btn-outline btn-sm">Export</button><button class="btn btn-primary btn-sm">Record a sale</button></div></header>
      <div class="report-period-bar"><div class="segmented-control" role="radiogroup"><button class="is-active">Today</button><button>Last 7 days</button><button>Last 30 days</button><button>This month</button></div><p class="report-period-label">28 September 2026 · Completed transactions only</p></div>
      <section class="report-panel"><div class="section-head"><h2 class="section-title">Sales summary</h2></div><div class="report-revenue"><span class="report-revenue-label">Total revenue</span><strong class="report-revenue-value">₦22,500</strong></div><div class="metric-strip"><div class="metric"><span class="metric-label">Transactions</span><span class="metric-value">5</span></div><div class="metric"><span class="metric-label">Average sale</span><span class="metric-value">₦4,500</span></div></div></section>
      <section class="report-grid"><article class="report-panel"><h2>Sales by payment method</h2><div class="state-block is-compact"><p class="state-title">No completed sales</p><p class="state-body">Record a sale to see payment totals.</p><div class="state-actions"><button class="btn btn-primary btn-sm">Record a sale</button></div></div></article><article class="report-panel"><h2>Top products</h2><p>Products rank here after completed sales.</p></article></section>
      <form class="card page-form"><div class="form-group"><label class="form-label">Billing email</label><input class="form-input" value="billing@example.com"></div><div class="form-actions"><button class="btn btn-primary">Save billing email</button><button class="btn btn-outline">Cancel</button></div></form>
    </div></main></body></html>`);
  for (const file of styles) await page.addStyleTag({ path: path.join(root, file) });
}

for (const viewport of [
  { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
  { name: 'mobile-dark', width: 390, height: 900, theme: 'dark' },
] as const) {
  test(`platform overview ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(`<!doctype html><html data-theme="${viewport.theme}"><body>
      <main class="page plat-page"><div class="platform-overview">
        <header class="plat-page-head"><div class="plat-page-head-text"><h1 class="plat-page-title">Overview</h1><p class="plat-page-desc">Signed in as platform owner.</p></div><button class="btn btn-ghost btn-sm">Refresh</button></header>
        <div class="overview-metrics"><article class="ui-metric"><header><h2>Businesses</h2></header><strong class="overview-metric-value">8</strong><p>6 new in 30 days</p></article><article class="ui-metric"><header><h2>Active access</h2></header><strong class="overview-metric-value">0</strong><p>Current product subscriptions</p></article><article class="ui-metric"><header><h2>Revenue</h2></header><strong class="overview-metric-value">₦0</strong><p>Last 30 days · sandbox excluded</p></article><article class="ui-metric"><header><h2>Failed payments</h2></header><strong class="overview-metric-value">0</strong><p>Last 30 days</p></article></div>
        <div class="overview-panels"><section class="overview-panel"><div class="section-head"><div class="section-head-text"><h2 class="section-title">Needs attention</h2></div></div><ul class="attention-list"><li class="attention-item is-warning"><span class="attention-dot"></span><div class="attention-body"><p class="attention-title">2 expiring within 30 days</p><p class="attention-meta">Soonest in 28 days.</p></div><div class="attention-action"><button class="btn btn-outline btn-sm">Review</button></div></li></ul></section><section class="overview-panel"><div class="section-head"><div class="section-head-text"><h2 class="section-title">Subscription state</h2></div></div><dl class="overview-status-list"><div><dt>Paying businesses</dt><dd>0</dd></div><div><dt>Businesses on trial</dt><dd>8</dd></div><div><dt>Trialing subscriptions</dt><dd>8</dd></div><div><dt>Expiring within 30 days</dt><dd>2</dd></div></dl></section><section class="overview-panel"><div class="section-head"><div class="section-head-text"><h2 class="section-title">Recent activity</h2></div></div><ol class="timeline"><li class="timeline-item"><span class="timeline-dot is-success"></span><div class="timeline-body"><p class="timeline-title">Login</p><p class="timeline-meta">Account owner · just now</p></div></li></ol></section><section class="overview-panel"><div class="section-head"><div class="section-head-text"><h2 class="section-title">Product access</h2></div></div><dl class="overview-status-list"><div><dt>TrackOja</dt><dd>0 active · 8 trialing</dd></div></dl></section></div>
      </div></main></body></html>`);
    for (const file of styles) await page.addStyleTag({ path: path.join(root, file) });
    const cards = page.locator('.overview-metrics .ui-metric');
    await expect(cards).toHaveCount(4);
    const panel = await page.locator('.platform-overview').boundingBox();
    expect(panel?.width).toBeLessThanOrEqual(1120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect(page).toHaveScreenshot(`platform-overview-${viewport.name}.png`, { fullPage: true, animations: 'disabled' });
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'mobile', width: 390, height: 1000 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${viewport.name} ${theme} layout`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mountLayout(page, theme);
      const content = page.locator('.page');
      await expect(content).toBeVisible();
      const box = await content.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(1168);
      const formInput = await page.locator('.page-form .form-input').boundingBox();
      const formButton = await page.locator('.page-form .btn').first().boundingBox();
      expect(formInput?.height).toBe(formButton?.height);
      await expect(page.locator('.report-panel').first()).toHaveCSS('border-top-width', '1px');
      const buttons = page.locator('.page-header .btn');
      if (viewport.width >= 600) {
        const first = await buttons.nth(0).boundingBox();
        const second = await buttons.nth(1).boundingBox();
        expect(first?.y).toBe(second?.y);
        expect(first?.height).toBe(second?.height);
      }
      await expect(page).toHaveScreenshot(`${viewport.name}-${theme}.png`, { fullPage: true, animations: 'disabled' });
    });
  }
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 900 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`merchant dashboard ${viewport.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.setContent(`<!doctype html><html data-theme="${theme}"><body>
        <div class="app-shell"><aside class="side-nav">Workspace</aside><div class="app-main"><div class="app-content">
          <main class="page dash">
            <header class="page-header"><div><h1 class="page-title">Akos Store</h1><p class="page-subtitle">How are sales and stock today?</p></div></header>
            <div class="btn-row dash-actions"><button class="btn btn-primary">Record a sale</button><button class="btn btn-outline">Add product</button></div>
            <div class="kpi-grid">
              <article class="kpi-card"><span class="kpi-head"><span class="kpi-label">Sales today</span></span><strong class="kpi-value">₦22,500</strong><span class="kpi-foot">5 sales</span></article>
              <article class="kpi-card"><span class="kpi-head"><span class="kpi-label">Transactions</span></span><strong class="kpi-value">5</strong><span class="kpi-foot" aria-hidden="true">&nbsp;</span></article>
              <article class="kpi-card"><span class="kpi-head"><span class="kpi-label">Low stock</span></span><strong class="kpi-value">2</strong><span class="kpi-foot" aria-hidden="true">&nbsp;</span></article>
              <article class="kpi-card"><span class="kpi-head"><span class="kpi-label">Unavailable items</span></span><strong class="kpi-value">0</strong><span class="kpi-foot" aria-hidden="true">&nbsp;</span></article>
            </div>
            <div class="dash-panels"><section class="card dash-panel"><div class="section-head"><h2 class="section-title">Recent activity</h2></div><div class="list"><div class="list-item"><div><p class="list-item-title">Sale recorded</p><p class="list-item-subtitle">Order 124 · just now</p></div><span class="badge badge-success">Success</span></div></div></section><section class="card dash-panel"><div class="section-head"><h2 class="section-title">Stock attention</h2><a class="btn btn-ghost btn-sm" href="#">View products</a></div><div class="list"><div class="list-item"><div><p class="list-item-title">Rice</p><p class="list-item-subtitle">Reorder at 5 bags</p></div><span class="badge badge-warning">2 left</span></div></div></section></div>
          </main>
        </div></div></div></body></html>`);
      for (const file of styles) await page.addStyleTag({ path: path.join(root, file) });
      const frame = await page.locator('.app-main').boundingBox();
      const card = await page.locator('.kpi-card').first().boundingBox();
      const lastCard = await page.locator('.kpi-card').last().boundingBox();
      expect(frame).not.toBeNull();
      expect(card).not.toBeNull();
      expect(card!.x - frame!.x).toBeGreaterThanOrEqual(viewport.width < 600 ? 16 : 24);
      expect(frame!.x + frame!.width - (lastCard!.x + lastCard!.width)).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await expect(page.locator('.kpi-card').first()).toHaveCSS('border-top-width', '1px');
      await expect(page.locator('.kpi-value').first()).toHaveCSS('font-family', /Inter/);
      const values = await page.locator('.kpi-value').all();
      const valueBoxes = await Promise.all(values.map((value) => value.boundingBox()));
      expect(valueBoxes[0]?.y).toBe(valueBoxes[1]?.y);
      expect(valueBoxes[2]?.y).toBe(valueBoxes[3]?.y);
      await expect(page).toHaveScreenshot(`merchant-dashboard-${viewport.name}-${theme}.png`, { fullPage: true, animations: 'disabled' });
    });
  }
}

for (const width of [730, 390]) {
  test(`platform read-only explanations wrap as prose at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(`<!doctype html><html data-theme="light"><body>
      <main class="page plat-page"><section class="card">
        <h2>Read-only</h2>
        <p class="is-locked">Integration writes would require <span class="mono">platform:manage_integrations</span>. A platform owner can manage access in Users &amp; roles.</p>
      </section></main>
    </body></html>`);
    for (const file of styles) await page.addStyleTag({ path: path.join(root, file) });

    const paragraph = page.locator('p.is-locked');
    const permission = paragraph.locator('.mono');
    await expect(paragraph).toHaveCSS('display', 'block');
    const permissionBox = await permission.boundingBox();
    expect(permissionBox?.width).toBeGreaterThan(150);
    expect(permissionBox?.height).toBeLessThan(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
