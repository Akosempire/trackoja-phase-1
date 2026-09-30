import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/owners', fullyParallel: true, workers: 2, timeout: 60_000,
  reporter: [['list']],
  webServer: { command: 'npx vite --config tests/visual/owner.vite.config.ts --host 127.0.0.1 --port 4180 --strictPort', url: 'http://127.0.0.1:4180/tests/visual/owner.html', reuseExistingServer: false },
  use: { screenshot: 'only-on-failure' },
  projects: [
    { name: 'edge', use: { browserName: 'chromium', channel: process.platform === 'win32' ? 'msedge' : 'chromium' } },
    { name: 'firefox', grep: /populated 375px dark|empty 1440px light/, use: { browserName: 'firefox' } },
    { name: 'webkit', grep: /populated 375px dark|empty 1440px light/, use: { browserName: 'webkit' } },
  ],
});
