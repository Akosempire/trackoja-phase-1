import { test, expect } from '@playwright/test';
for (const theme of ['light', 'dark']) test(`immediate ${theme} startup survives a failed bundle and offers Retry`, async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('trackoja-theme', value), theme);
  await page.clock.install();
  await page.route('**/assets/index-*.js', route => route.abort());
  await page.goto('http://127.0.0.1:4184/login');
  await expect(page.locator('#boot-message')).toContainText('Opening your workspace');
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(theme === 'dark' ? 'rgb(11, 11, 11)' : 'rgb(255, 255, 255)');
  await page.clock.fastForward(20001);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('#boot-message')).toContainText('could not finish loading');
  await page.unroute('**/assets/index-*.js');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
