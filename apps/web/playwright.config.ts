import { defineConfig } from '@playwright/test';

/**
 * E2E configuration for critical journeys (PRD §16, §52):
 * procure-to-pay, quote-to-cash, hire-to-pay, asset lifecycle.
 * Journeys are added alongside their vertical slices; the harness is ready now.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
