import { expect, test } from '@playwright/test';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';

test('built app reopens its cached sign-in screen when its server is unavailable', async ({ page }) => {
  // Give each test its own origin so stopping it cannot affect other projects.
  // Real connection loss avoids Playwright 1.63's WebKit setOffline regression:
  // https://github.com/microsoft/playwright/issues/42775
  const server = createServer((incoming, outgoing) => {
    const upstream = request(`http://127.0.0.1:4176${incoming.url}`, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stop = async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  };
  try {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Fresh browser context, no login credentials or account writes.
    await page.goto(`${origin}/login`);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; return true; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await stop();
    // A client without the service worker cannot reach this origin now.
    await expect(fetch(`${origin}/login`)).rejects.toThrow();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await stop();
  }
});
