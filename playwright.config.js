import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 900 } },
  webServer: { command: 'node scripts/serve.mjs 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
