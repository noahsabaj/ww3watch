// Prerendered like /about: static, indexable HTML (HTTP 200 on GitHub Pages, not
// the SPA's 404 fallback). The numbers are fetched client-side in onMount, so
// the build cannot freeze them.
export const prerender = true
export const ssr = true
