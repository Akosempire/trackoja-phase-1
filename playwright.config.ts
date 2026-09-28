import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    channel: process.platform === 'win32' ? 'msedge' : 'chromium',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
  },
});
