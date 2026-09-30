import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/tests/visual/foundation.html',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    channel: process.platform === 'win32' ? 'msedge' : 'chromium',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
  },
});
