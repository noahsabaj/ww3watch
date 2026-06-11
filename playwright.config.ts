import { defineConfig, devices } from '@playwright/test'

// Smoke suite against a REAL production build served the way GitHub Pages
// serves it (single-page fallback; deploy.yml copies 404.html → index.html,
// replicated here). Data comes from the live Supabase backend via the
// publishable key — tests assert presence/behavior, never exact content.
export default defineConfig({
  testDir: 'e2e',
  retries: 2,
  workers: 1,
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
