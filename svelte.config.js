import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

// The CSP's connect-src is derived from the Supabase URL this build targets,
// rather than hardcoding a wildcard. In production that is strictly TIGHTER than
// the old `https://*.supabase.co` (one project origin, not every Supabase
// project), and it is what lets the e2e suite build against a local fixture
// stack on 127.0.0.1 instead of asserting against live production data.
const supabaseOrigin = new URL(
  process.env.PUBLIC_SUPABASE_URL || 'https://qusjbpknlduuklnfciws.supabase.co',
).origin
const supabaseSocket = supabaseOrigin.replace(/^http/, 'ws') // realtime

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Static SPA on GitHub Pages. fallback: every route serves the same shell and
    // the client router takes over (the app is a single dynamic route).
    // GitHub Pages serves 404.html for unmatched paths; the deploy workflow also
    // copies it to index.html so the root returns 200.
    adapter: adapter({ fallback: '404.html' }),
    // Set BASE_PATH=/ww3watch when deploying to the GitHub project page
    // (noahsabaj.github.io/ww3watch). Empty for a custom domain or root deploy.
    paths: { base: process.env.BASE_PATH ?? '' },
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
        'img-src': ['*', 'data:', 'blob:'],
        'connect-src': ['self', supabaseOrigin, supabaseSocket],
        'worker-src': ['self'],
      },
    },
  }
}

export default config
