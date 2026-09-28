import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const styles = [
  'src/styles/tokens.css',
  'src/styles/theme.css',
  'src/styles/waya.css',
  'src/styles/waya-components.css',
  'src/styles/dashboard.css',
  'src/styles/reports.css',
];

async function mountLayout(page: Page, theme: 'light' | 'dark') {
  await page.setContent(`<!doctype html><html data-theme="${theme}"><body>
    <main class="app-main"><div class="page reports-page dash">
      <nav class="route-back-bar"><a class="route-back-link" href="#">← <span>Back to dashboard</span></a></nav>
      <header class="page-header"><div><h1 class="page-title">Reports</h1><p class="page-subtitle">Today · 28 September 2026</p></div><div class="btn-row"><button class="btn btn-outline btn-sm">Export</button><button class="btn btn-primary btn-sm">Record a sale</button></div></header>
      <div class="report-period-bar"><div class="segmented-control" role="radiogroup"><button class="is-active">Today</button><button>Last 7 days</button><button>Last 30 days</button><button>This month</button></div><p class="report-period-label">28 September 2026 · Completed transactions only</p></div>
      <section class="report-panel"><h2>Sales summary</h2><div class="metric-grid"><div><span>Revenue</span><strong>₦22,500</strong></div><div><span>Transactions</span><strong>5</strong></div></div></section>
      <section class="report-grid"><article class="report-panel"><h2>Sales by payment method</h2><div class="state-block is-compact"><p class="state-title">No completed sales</p><p class="state-body">Record a sale to see payment totals.</p><div class="state-actions"><button class="btn btn-primary btn-sm">Record a sale</button></div></div></article><article class="report-panel"><h2>Top products</h2><p>Products rank here after completed sales.</p></article></section>
      <form class="card page-form"><div class="form-group"><label class="form-label">Billing email</label><input class="form-input" value="billing@example.com"></div><div class="form-actions"><button class="btn btn-primary">Save billing email</button><button class="btn btn-outline">Cancel</button></div></form>
    </div></main></body></html>`);
  for (const file of styles) await page.addStyleTag({ path: path.join(root, file) });
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
      expect(box?.width).toBeLessThanOrEqual(1120);
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
