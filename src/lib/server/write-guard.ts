// Refuse to hand out an RLS-bypassing client for the hosted database from a
// developer machine. The local .env carries the production secret key (the
// pipeline and ops scripts need it), so without this a branch's pipeline run
// on a laptop writes straight into the live site. Staging runs against the
// local stack (npm run staging:up), whose URL is loopback and always passes.
//
// Production writers are GitHub Actions workflows (GITHUB_ACTIONS=true) and
// the pipeline container (Dockerfile sets WW3WATCH_ALLOW_PRODUCTION=1). A
// deliberate one-off from a laptop sets the same variable on the command line.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal'])

export function isLocalSupabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Why a privileged client for `url` must not be created here, or null when it may. */
export function productionWriteRefusal(url: string, env: Record<string, string | undefined>): string | null {
  if (isLocalSupabase(url)) return null
  if (env.GITHUB_ACTIONS === 'true') return null
  if (env.WW3WATCH_ALLOW_PRODUCTION === '1') return null
  return (
    `Refusing to write to the hosted database (${new URL(url).host}) from a local run. ` +
    `Use the local staging stack instead (npm run staging:up, then npm run staging:pipeline). ` +
    `If you really mean to touch production, re-run with WW3WATCH_ALLOW_PRODUCTION=1.`
  )
}
