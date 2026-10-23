import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  workers: 1, // python's http.server stalls on parallel module loads; the suite runs in about 15 s
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 900 } },
  webServer: { command: 'python3 -m http.server 4173', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
});
