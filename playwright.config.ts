import { defineConfig, devices } from '@playwright/test'

// Smoke suite against a REAL production build served the way GitHub Pages
// serves it (single-page fallback; deploy.yml copies 404.html → index.html,
// replicated here). Data comes from a local Supabase stack seeded with
// supabase/seed.sql, so a red run means the change broke something.
export default defineConfig({
  testDir: 'e2e',
  // Every test reads the same seeded fixture and nothing writes to it (route
  // fakes and localStorage belong to each test's own browser context), so the
  // tests run side by side. Retries are CI's guard against a flaky runner;
  // locally a failure should show at once instead of waiting out three timeouts.
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npx sirv build --single --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
