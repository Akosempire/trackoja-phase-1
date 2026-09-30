import { test, expect } from '@playwright/test';
for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) for (const theme of ['light', 'dark']) {
  test(`platform tasks ${width} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4175/tests/visual/platform.html?theme=${theme}`);
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    const initial = await page.locator('main').boundingBox();
    for (const tab of ['Plans', 'Subscriptions', 'Payments', 'Overview']) {
      await page.getByRole('radio', { name: tab, exact: true }).click();
      await expect(page.getByRole('radio', { name: tab, exact: true })).toHaveAttribute('aria-checked', 'true');
      expect((await page.locator('main').boundingBox())?.width).toBe(initial?.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    if ([390, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`billing-${theme}.png`), fullPage: true });
    for (const area of ['support', 'developer']) {
      await page.goto(`http://127.0.0.1:4175/tests/visual/platform.html?theme=${theme}&route=/platform/${area}`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    if ([390, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`developer-${theme}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
test('legacy billing tools reach the canonical destination', async ({ page }) => {
  for (const area of ['activation', 'settings', 'audit']) {
    await page.goto(`http://127.0.0.1:4175/tests/visual/platform.html?route=${encodeURIComponent('/platform/billing?section=' + area)}`);
    await expect(page.getByRole('heading', { name: new RegExp(`${area} destination`, 'i') })).toBeVisible();
  }
});

test('Overview stays selected when a product filter is retained', async ({ page }) => {
  await page.goto(`http://127.0.0.1:4175/tests/visual/platform.html?route=${encodeURIComponent('/platform/billing?section=plans&product=trackoja')}`);
  await page.getByRole('radio', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Overview', exact: true })).toHaveAttribute('aria-checked', 'true');
});

for (const width of [390, 1440]) test(`plan details use a dismissible dialog at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://127.0.0.1:4175/tests/visual/platform.html?data=populated&route=${encodeURIComponent('/platform/billing?section=plans')}`);
  const open = page.getByRole('button', { name: 'Open Standard plan details' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Standard', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('22,500');
  const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(open).toBeFocused();
});

for (const route of ['/platform/businesses', '/platform/billing?section=subscriptions', '/platform/audit']) test(`pagination advances and reverses ${route}`, async ({ page }) => {
  await page.goto(`http://127.0.0.1:4175/tests/visual/platform.html?data=paged&route=${encodeURIComponent(route)}`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
});
