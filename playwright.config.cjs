'use strict';
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.cjs', fullyParallel: true,
  workers: 2, retries: process.env.CI ? 1 : 0, forbidOnly: Boolean(process.env.CI),
  timeout: 30_000, expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { browserName: 'chromium', headless: true, viewport: { width: 1280, height: 720 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});
