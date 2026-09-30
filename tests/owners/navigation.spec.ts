import { expect, test } from '@playwright/test';
for (const category of ['restaurant', 'tailor', 'fashion_store', 'fabric_textile', 'supermarket', 'pharmacy', 'electronics_gadget', 'beauty_cosmetics', 'building_materials', 'stationery', 'general_retail', 'other']) {
 test(`navigation ${category} populated 375px dark`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto(`http://127.0.0.1:4180/tests/visual/owner.html?shell=true&state=populated&theme=dark&category=${category}`);
  const bar = page.getByRole('navigation', { name: 'Primary', exact: true });
  await expect(bar.getByRole('link', { name: 'More', exact: true })).toBeVisible();
  await expect(bar.getByRole('button')).toHaveAccessibleName(category === 'restaurant' ? 'New order' : category === 'tailor' ? 'New job' : 'Scan a barcode');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape'); await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await bar.getByRole('link', { name: 'More', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out', exact: true }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 });
}
