import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/startup', workers: 2, timeout: 60000,
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4184 --strictPort', url: 'http://127.0.0.1:4184/login', reuseExistingServer: false },
  use: { serviceWorkers: 'block' },
  projects: [
    { name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
