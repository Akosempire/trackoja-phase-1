import { expect, test } from '@playwright/test';
const origin = 'http://127.0.0.1:4175';
for (const theme of ['light', 'dark']) {
  test(`public login and recovery navigation (${theme})`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // No customer login or remote data is needed for browser compatibility checks.
    await page.route('**/*.supabase.co/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Isolated browser test"}' }));
    await page.goto(`${origin}/login`);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
    expect(await page.getByLabel('Email address').evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/forgot-password/);
    await expect(page.getByLabel('Email address')).toBeVisible();
    expect(errors).toEqual([]);
  });
  test(`install guide, decimal fields and camera fallback (${theme})`, async ({ page }, testInfo) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }));
    await page.goto(`${origin}/tests/visual/compatibility.html`);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole('button', { name: 'Install app', exact: true }).click();
    const guide = page.getByRole('dialog', { name: 'Install TrackOja', exact: true });
    await expect(guide).toBeVisible();
    if (['iphone', 'ipad'].includes(testInfo.project.name)) await expect(guide).toContainText('Add to Home Screen');
    await guide.getByRole('button', { name: 'Done' }).click();
    await expect(guide).not.toBeVisible();
    const amount = page.getByLabel('Amount', { exact: true });
    await amount.fill('22.50'); expect(await amount.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true);
    await amount.fill('-1'); expect(await amount.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
    await page.getByRole('button', { name: 'Open scanner' }).click();
    const scanner = page.getByRole('dialog', { name: 'Scan barcode', exact: true });
    await expect(scanner).toBeVisible();
    await scanner.getByLabel('Barcode', { exact: true }).fill('1234567890123');
    await scanner.getByRole('button', { name: 'Use code' }).click();
    await expect(page.getByLabel('Detected barcode')).toHaveText('1234567890123');
    await expect(scanner).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
