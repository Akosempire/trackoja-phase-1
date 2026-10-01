import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './tests/resume', workers: 2, timeout: 60000,
  webServer: { command: 'npx vite --host 127.0.0.1 --port 4182 --strictPort', url: 'http://127.0.0.1:4182/tests/visual/resume.html', reuseExistingServer: false },
  projects: [
    { name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
});
