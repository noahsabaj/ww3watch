// /about is the one prerendered route. Its methodology prose is baked into static,
// indexable HTML (HTTP 200) at build time — overriding the app-wide ssr=false in
// the root +layout.ts. The LIVE source-health roster and region distribution are
// fetched client-side in +page.svelte's onMount, NOT here, so prerendering can't
// freeze them: a build-time load() would snapshot the roster to whatever it was at
// deploy and never update.
export const prerender = true
export const ssr = true

export type SourceRosterRow = {
  name: string
  region: string
  lang: string
  enabled: boolean
  last_ok_at: string | null
  consecutive_failures: number
}
