import { defineConfig, devices } from '@playwright/test'

// Production canary config — used only by .github/workflows/prod-smoke.yml.
// No webServer and no build: it points at the deployed site as a visitor would.
// The PR suite (playwright.config.ts) runs against a seeded local backend.
export default defineConfig({
  testDir: 'e2e-prod',
  retries: 2, // a transient network blip should not page anyone
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.PROD_URL ?? 'https://noahsabaj.github.io/ww3watch/',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium' }],
})
