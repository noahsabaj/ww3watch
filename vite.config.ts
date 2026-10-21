import { copyFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import adapter from '@sveltejs/adapter-static'
import type { Adapter } from '@sveltejs/kit'
import { sveltekit } from '@sveltejs/kit/vite'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { generateSW } from 'workbox-build'

// Set BASE_PATH=/ww3watch when deploying to the GitHub project page
// (noahsabaj.github.io/ww3watch). Empty for a custom domain or root deploy.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`

// The CSP's connect-src is derived from the Supabase URL this build targets,
// rather than hardcoding a wildcard. In production that is strictly TIGHTER than
// the old `https://*.supabase.co` (one project origin, not every Supabase
// project), and it is what lets the e2e suite build against a local fixture
// stack on 127.0.0.1 instead of asserting against live production data.
// (An origin is a CSP host source; kit's types can't see that in a runtime string.)
const supabaseOrigin = new URL(
  process.env.PUBLIC_SUPABASE_URL || 'https://qusjbpknlduuklnfciws.supabase.co',
).origin as `${string}://${string}.${string}`
const supabaseSocket = supabaseOrigin.replace(/^http/, 'ws') as typeof supabaseOrigin // realtime

// Static SPA on GitHub Pages. fallback: every route serves the same shell and
// the client router takes over (the app is a single dynamic route).
// GitHub Pages serves 404.html for unmatched paths; the deploy workflow also
// copies it to index.html so the root returns 200.
const site = 'build'
const spa = adapter({ pages: site, fallback: '404.html' })

// The PWA: a Workbox service worker (sw.js) that precaches the shell and carries
// the alarm's push handlers, written over the finished site. It wraps the
// adapter because it must come after it — it precaches the prerendered pages
// adapter-static writes. @vite-pwa/sveltekit used to do this from a build hook;
// under SvelteKit 3 that hook still runs and silently writes no worker at all.
//
// sw.js and its scope (the site root) must never move. A reader's push
// subscription belongs to the registration they key, and an installed copy
// finds new versions only by re-fetching sw.js. The web app manifest is
// static/manifest.webmanifest; its relative start_url and scope resolve
// against its own URL, so they follow BASE_PATH without being generated.
const pwa: Adapter = {
  ...spa,
  async adapt(builder) {
    await spa.adapt(builder)
    const { count, size, warnings, filePaths } = await generateSW({
      globDirectory: site,
      swDest: `${site}/sw.js`,
      sourcemap: false,
      // autoUpdate: a new worker takes over at once, and the page reloads onto
      // it (src/routes/+layout.svelte).
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      // The alarm's push and notification-tap handlers (static/push-sw.js).
      importScripts: ['push-sw.js'],
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
      // og.png is a 1200×630 social-share card scraped by external crawlers —
      // it's never rendered in-app, so precaching it just bloats every install.
      // (source-samples.json needs no entry here: globPatterns above doesn't
      // match .json, which is why the sample evidence is a static asset rather
      // than a bundled module — it was 61% of the audit and almost nobody
      // opens it.) 404.html is the same shell as index.html, which is precached.
      globIgnores: ['**/og.png', '404.html'],
      // Pages are precached under the URLs the site links to: /about, not
      // /about.html, and the home page as the site root.
      manifestTransforms: [async (entries) => ({
        manifest: entries.map((e) => ({
          ...e,
          url: e.url === 'index.html' ? `${base}/` : e.url.replace(/\.html$/, ''),
        })),
      })],
      // Hashed file names: their URL already changes with their content.
      dontCacheBustURLsMatching: /^_app\/immutable\//,
      navigateFallback: `${base}/`,
      // Every page is one static file whatever its query string, so match the
      // precache ignoring all of it. Otherwise /feedback?article=… misses the
      // precached /feedback and the navigation fallback serves the home page
      // under that URL (a reload of Report showed the feed).
      ignoreURLParametersMatching: [/.*/],
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'supabase-rest',
            networkTimeoutSeconds: 3,
            cacheableResponse: { statuses: [0, 200] },
            // Bound the cache so stale REST URLs (e.g. an old select=* entry
            // after a column-list change) don't linger forever. Generous age:
            // ExpirationPlugin deletes on access, so a too-short age would
            // leave an offline user with nothing.
            expiration: { maxEntries: 16, maxAgeSeconds: 7 * 24 * 60 * 60 },
          },
        },
      ],
    })
    for (const warning of warnings) builder.log.warn(warning)
    builder.log.minor(`Service worker: precached ${count} files (${(size / 1024).toFixed(0)} KiB)`)
    // `vite preview` serves .svelte-kit/output, not the site; give it the same worker.
    for (const file of filePaths) await copyFile(file, join(builder.getClientDirectory(), basename(file)))
  },
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: pwa,
      paths: { base },
      // Defense-in-depth CSP (GitHub Pages can't send headers, so SvelteKit emits a
      // <meta> tag). mode auto hashes the framework's own inline bootstrap script,
      // which keeps script-src strict — a hand-written policy would have needed
      // 'unsafe-inline'. style attrs are used throughout, hence unsafe-inline for
      // styles; img-src * for reader article images; connect/wss for Supabase.
      csp: {
        mode: 'auto',
        directives: {
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          // @ts-expect-error '*' (any host) is valid CSP that kit's source type leaves out
          'img-src': ['*', 'data:', 'blob:'],
          'connect-src': ['self', supabaseOrigin, supabaseSocket],
          'worker-src': ['self'],
        },
      },
    }),
  ],
  test: {
    // scripts/ci/ holds the workflows' logic (PR/issue/chain handling); its tests
    // are the only thing standing between that logic and production.
    include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.{js,ts}'],
    // Dummy values so server modules that read these at import (src/lib/server/env.ts)
    // load under vitest. Tests mock the actual network/LLM/DB calls.
    env: {
      SUPABASE_URL: 'http://localhost',
      SUPABASE_SECRET_KEY: 'test-secret',
    },
  }
})
