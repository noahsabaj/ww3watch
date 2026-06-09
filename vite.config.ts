import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { SvelteKitPWA } from '@vite-pwa/sveltekit'

// Must match kit.paths.base in svelte.config.js (e.g. /ww3watch on a GitHub
// project page). Empty for a custom domain or root deploy.
const base = process.env.BASE_PATH ?? ''

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'WW3Watch',
        short_name: 'WW3Watch',
        description: 'Real-time global conflict news aggregator',
        theme_color: '#0a0a0b',
        background_color: '#0a0a0b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: `${base}/`,
        scope: `${base}/`,
        icons: [
          { src: 'pwa-192x192.png',          sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',           sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    // Dummy values so server modules that read these at import (src/lib/server/env.ts)
    // load under vitest. Tests mock the actual network/LLM/DB calls.
    env: {
      SUPABASE_URL: 'http://localhost',
      SUPABASE_SECRET_KEY: 'test-secret',
      LLM_BASE_URL: 'http://localhost/v1',
      LLM_API_KEY: 'test-key',
      LLM_MODEL: 'test-model',
    },
  }
})
