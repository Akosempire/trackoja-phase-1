import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const desktopTests = /(?:(?:foundation|platform|compatibility)\.visual|production)\.spec\.ts/;
const mobileTests = /(?:compatibility\.visual|production)\.spec\.ts/;
export default defineConfig({
  ...base,
  testDir: './tests',
  // Cold browser starts and production service-worker precaching take longer
  // than a single UI action. Individual visibility/layout assertions stay strict.
  timeout: 60_000,
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : [base.webServer!]),
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 4176 --strictPort',
      url: 'http://127.0.0.1:4176/login',
      reuseExistingServer: !process.env.CI,
    },
  ],
  // Baseline screenshots remain in the existing Edge suite. This matrix checks
  // behavior and layout across engines without comparing different font renderers.
  workers: 2,
  use: { ...base.use, channel: undefined, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testMatch: desktopTests, use: { ...devices['Desktop Chrome'] } },
    { name: 'chrome', testMatch: desktopTests, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', testMatch: desktopTests, use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'firefox', testMatch: desktopTests, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: desktopTests, use: { ...devices['Desktop Safari'] } },
    { name: 'android', testMatch: mobileTests, use: { ...devices['Pixel 7'] } },
    { name: 'iphone', testMatch: mobileTests, use: { ...devices['iPhone 13'] } },
    { name: 'ipad', testMatch: mobileTests, use: { ...devices['iPad (gen 7)'] } },
  ],
});
