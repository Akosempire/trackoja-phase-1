import { expect, test } from '@playwright/test';
for (const role of ['merchant', 'platform']) for (const state of ['empty', 'populated']) for (const width of [320, 375, 390, 430, 768, 1024, 1440]) for (const theme of ['light', 'dark']) {
  test(`${role} ${state} ${width}px ${theme}`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://127.0.0.1:4180/tests/visual/owner.html?role=${role}&state=${state}&theme=${theme}`);
    const revenue = page.locator('.dashboard-revenue');
    await expect(revenue).toContainText(state === 'empty' ? 'No revenue in this period' : '₦67,500');
    await page.getByRole('radio', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Today', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(revenue).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const main = await page.locator('.owner-dashboard-main').boundingBox();
    const panel = await revenue.boundingBox(); const side = await page.locator('.owner-dashboard-side').boundingBox();
    expect(main!.width).toBeLessThanOrEqual(1120);
    if (width === 1440) { expect(side!.x).toBeGreaterThan(panel!.x + panel!.width); expect(Math.abs(side!.y - panel!.y)).toBeLessThan(2); }
    else expect(side!.y).toBeGreaterThanOrEqual(panel!.y + panel!.height);
    expect(errors).toEqual([]);
    if (info.project.name === 'edge' && width !== 768) await page.screenshot({ path: info.outputPath(`${role}-${state}-${width}-${theme}.png`), fullPage: true });
  });
}
