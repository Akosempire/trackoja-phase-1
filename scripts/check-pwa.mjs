import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: false } });
const baseUrl = server.resolvedUrls.local[0];
let browser;

try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => console.error('Page error:', error.message));
  await page.goto(baseUrl);

  const installation = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const manifest = link ? await (await fetch(link.href)).json() : null;
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
    ]);
    return {
      manifest,
      workerActive: Boolean(registration?.active),
      registrations: (await navigator.serviceWorker.getRegistrations()).map((item) => item.scope),
      installButtons: document.querySelectorAll('.install-app-action').length,
    };
  });

  assert.equal(installation.manifest.name, 'TrackOja');
  assert.equal(installation.manifest.display, 'standalone');
  assert.equal(installation.manifest.start_url, '/auth/continue');
  assert(installation.manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert(installation.manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert(installation.workerActive, `Service worker did not activate: ${JSON.stringify(installation.registrations)}`);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Install app' }).click();
  await page.getByRole('heading', { name: 'Install TrackOja' }).waitFor();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => { window.__installPromptOpened = true; },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: 'Install app' }).click();
  await page.locator('.lp-mobile-menu .install-app-action').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__installPromptOpened), true);

  await page.reload();
  await page.context().setOffline(true);
  const offlineResponse = await page.goto(new URL('/auth/continue', baseUrl).href, { waitUntil: 'domcontentloaded' });
  assert.equal(offlineResponse?.status(), 200);
  console.log('PWA manifest, service worker, install actions, and offline app shell verified.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
