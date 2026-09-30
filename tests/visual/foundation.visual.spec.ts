import { expect, test } from '@playwright/test';

for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`shared React controls at ${width}px ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://127.0.0.1:4175/tests/visual/foundation.html');
      await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
      await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const original = await page.locator('main').boundingBox();
      for (const state of ['populated', 'loading', 'empty', 'error']) {
        await page.getByRole('radio', { name: state, exact: true }).click();
        const current = await page.locator('main').boundingBox();
        expect(current?.x).toBe(original?.x);
        expect(current?.width).toBe(original?.width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
      const row = await page.locator('.control-row').boundingBox();
      expect(row!.height).toBeLessThan(130); // No vertical 240px flex basis.
      const field = await page.getByRole('searchbox').boundingBox();
      const search = await page.getByRole('button', { name: 'Search', exact: true }).boundingBox();
      if (width > 600) expect(Math.abs(field!.y + field!.height - search!.y - search!.height)).toBeLessThan(2);
      if (width <= 900) {
        const option = await page.getByRole('radio', { name: 'populated', exact: true }).boundingBox();
        expect(option!.height).toBeGreaterThanOrEqual(44);
        const scan = await page.getByRole('button', { name: 'Scan', exact: true }).boundingBox();
        expect(Math.abs(scan!.x + scan!.width / 2 - width / 2)).toBeLessThan(2);
        const labelSize = await page.locator('.bottom-nav-label').first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
        expect(labelSize).toBeGreaterThanOrEqual(12);
        const face = await page.locator('.bottom-nav-scan-face').boundingBox();
        expect(face!.height).toBeGreaterThanOrEqual(48);
        expect(Math.abs(face!.height - face!.width)).toBeLessThan(2);
        const scanLabel = await page.locator('.bottom-nav-scan .bottom-nav-label').boundingBox();
        expect(scanLabel!.y + scanLabel!.height).toBeLessThanOrEqual(900);
      }
      await page.getByRole('button', { name: 'Edit contact', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Billing contact' })).toBeVisible();
      const dialog = await page.getByRole('dialog', { name: 'Billing contact' }).boundingBox();
      expect(dialog!.x).toBeGreaterThanOrEqual(0);
      expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Edit contact', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('dialog', { name: 'Navigation', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
      if ([390, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`foundation-${theme}.png`), fullPage: true });
    });
  }
}

test('segmented controls support arrow navigation and retries restore data', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/tests/visual/foundation.html');
  const first = page.getByRole('radio', { name: 'populated', exact: true });
  await first.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'empty', exact: true })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'empty', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('alert')).toContainText('Transactions could not load');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Transactions' })).toContainText('₦22,500');
});
