import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

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
        'connect-src': ['self', 'https://*.supabase.co', 'wss://*.supabase.co'],
        'worker-src': ['self'],
      },
    },
  }
}

export default config
