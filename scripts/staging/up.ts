// Local staging: the real schema from THIS branch's migrations, filled with the
// last couple of days of production data, running on the local Supabase stack.
// Only you can see it, and nothing here can write to production.
//
//   npm run staging:up                # start (or reset) the stack, copy a snapshot in
//   npm run staging:up -- --hours 12  # smaller window
//   npm run staging:dev               # the site on http://localhost:5175, against staging
//   npm run staging:pipeline          # one real ingestion run, writing to staging
//   npm run staging:down              # stop and discard the stack
//
// Reads production with the secret key from .env (stories and embeddings are
// not public), through a fetch that refuses anything but GET/HEAD — the copy is
// read-only by construction, not by convention. Writes go to the local
// container over psql with session_replication_role=replica, so rows land in
// any order without tripping foreign keys or triggers. Columns this branch adds
// arrive NULL; columns production has and this branch dropped are ignored.
//
// Needs Docker running. The Supabase CLI is fetched with npx.
import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { isLocalSupabase } from '../../src/lib/server/write-guard'

const DB_CONTAINER = 'supabase_db_ww3watch'
const PAGE = 1000
// Services the staging site and pipeline never touch; skipping them makes the
// first start pull far fewer images.
const EXCLUDE = 'imgproxy,storage-api,logflare,vector,supavisor,mailpit'

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback
  if (!Number.isFinite(v) || v <= 0) throw new Error(`--${name} must be a positive number`)
  return v
}

function run(cmd: string, args: string[], opts: { input?: number; capture?: boolean } = {}): string {
  const res = spawnSync(cmd, args, {
    stdio: [opts.input ?? 'inherit', opts.capture ? 'pipe' : 'inherit', 'inherit'],
    encoding: 'utf8',
    // npx is npx.cmd on Windows and needs a shell; docker must not get one,
    // because the psql -c argument would be re-split on spaces.
    shell: cmd === 'npx' && process.platform === 'win32',
  })
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${res.status}`)
  return res.stdout ?? ''
}

const supabaseCli = (...args: string[]) => run('npx', ['--yes', 'supabase@2', ...args], { capture: args[0] === 'status' })

function psql(sql: string): string {
  return run('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { capture: true })
}

// ── Source: production, GET only ────────────────────────────────────────────
const SOURCE_URL = process.env.SUPABASE_URL
const SOURCE_KEY = process.env.SUPABASE_SECRET_KEY
if (!SOURCE_URL || !SOURCE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env (the production project to snapshot)')
if (isLocalSupabase(SOURCE_URL)) throw new Error('.env SUPABASE_URL points at the local stack; it should be the production project to copy from')

const readOnlyFetch: typeof fetch = (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') throw new Error(`staging snapshot is read-only; refused ${method}`)
  return fetch(input, init)
}
const prod = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false }, global: { fetch: readOnlyFetch } })

type Row = Record<string, unknown>

async function readAll(table: string, filter: (q: any) => any = (q) => q): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(prod.from(table).select('*')).order(orderKey(table)).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data as Row[]))
    if (data.length < PAGE) return rows
  }
}

async function readByIds(table: string, column: string, ids: string[]): Promise<Row[]> {
  const rows: Row[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    rows.push(...(await readAll(table, (q) => q.in(column, chunk))))
  }
  return rows
}

function orderKey(table: string): string {
  return { article_embeddings: 'article_id', classified_rejects: 'guid', trending: 'rank', ai_budgets: 'service', ai_months: 'month' }[table] ?? 'id'
}

// ── Destination: the local container ────────────────────────────────────────
function localColumns(table: string): Set<string> {
  const out = psql(
    `select column_name from information_schema.columns where table_schema='public' and table_name='${table}' ` +
      `and is_generated='NEVER' and identity_generation is null`,
  )
  return new Set(out.split(/\r?\n/).filter(Boolean))
}

// Tables a migration pre-fills with defaults: production's rows replace them.
const REPLACE = new Set(['ai_budgets'])

function insertSql(table: string, rows: Row[]): string {
  if (rows.length === 0) return ''
  const local = localColumns(table)
  const remote = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const dropped = remote.filter((c) => !local.has(c))
  if (dropped.length) console.warn(`[staging] ${table}: production has columns this branch does not, not copied: ${dropped.join(', ')}`)
  const cols = remote.filter((c) => local.has(c))
  const list = cols.map((c) => `"${c}"`).join(', ')
  const tag = `$s${randomBytes(6).toString('hex')}$`
  return (
    (REPLACE.has(table) ? `DELETE FROM public.${table};\n` : '') +
    `INSERT INTO public.${table} (${list}) SELECT ${list} FROM json_populate_recordset(null::public.${table}, ` +
    `${tag}${JSON.stringify(rows)}${tag}::json) ON CONFLICT DO NOTHING;\n`
  )
}

function localKeys(): Record<string, string> {
  const out = supabaseCli('status', '-o', 'env')
  const env: Record<string, string> = {}
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

async function main() {
  const hours = arg('hours', 48)
  const since = new Date(Date.now() - hours * 3600_000).toISOString()

  // Always reset after starting: `supabase start` reuses an existing database
  // volume without re-applying migrations, so a stack last used by another
  // branch (or months ago) would otherwise keep that schema.
  const running = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', DB_CONTAINER], { encoding: 'utf8' }).stdout?.trim() === 'true'
  if (!running) supabaseCli('start', '-x', EXCLUDE)
  supabaseCli('db', 'reset', '--local')

  console.log(`[staging] reading production (last ${hours}h)…`)
  const sources = await readAll('sources')
  const articles = await readAll('articles', (q) => q.gte('fetched_at', since))
  const storyIds = [...new Set(articles.map((a) => a.story_id).filter(Boolean) as string[])]
  const stories = await readByIds('stories', 'id', storyIds)
  // A story's representative can be older than the window; bring it along so
  // the story still leads with the headline production shows.
  const have = new Set(articles.map((a) => a.id))
  const reps = stories.map((s) => s.rep_article_id as string | null).filter((id): id is string => !!id && !have.has(id))
  articles.push(...(await readByIds('articles', 'id', reps)))
  const embeddings = await readByIds('article_embeddings', 'article_id', articles.map((a) => a.id as string))
  const rejects = await readAll('classified_rejects', (q) => q.gte('rejected_at', since))
  const trending = await readAll('trending')
  // The operator-verified model pricing and this month's spend. Without them the
  // budget gate refuses every Jev call (pricing_unverified), and copying the
  // spend keeps a staging run inside what production has left this month.
  // Staging's own spend is never written back.
  const aiBudgets = await readAll('ai_budgets')
  const aiMonths = await readAll('ai_months', (q) => q.gte('month', since.slice(0, 7) + '-01'))

  const counts = {
    sources, articles, stories, article_embeddings: embeddings, classified_rejects: rejects, trending,
    ai_budgets: aiBudgets, ai_months: aiMonths,
  }
  console.log('[staging] ' + Object.entries(counts).map(([t, r]) => `${t}=${r.length}`).join(' '))

  mkdirSync('.tmp', { recursive: true })
  const file = '.tmp/staging-snapshot.sql'
  writeFileSync(
    file,
    'SET client_min_messages = error;\nBEGIN;\nSET session_replication_role = replica;\n' +
      Object.entries(counts).map(([t, r]) => insertSql(t, r)).join('') +
      'COMMIT;\n' +
      Object.keys(counts).map((t) => `ANALYZE public.${t};\n`).join(''),
  )
  const fd = openSync(file, 'r')
  try {
    run('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input: fd })
  } finally {
    closeSync(fd)
  }

  const keys = localKeys()
  const url = keys.API_URL ?? 'http://127.0.0.1:54321'
  const publishable = keys.PUBLISHABLE_KEY ?? keys.ANON_KEY
  const secret = keys.SECRET_KEY ?? keys.SERVICE_ROLE_KEY
  if (!publishable || !secret) throw new Error('could not read the local stack keys from `supabase status`')
  const carry = ['TYPESAFE_API_KEY', 'FEED_PROXY_URL', 'FEED_PROXY_SECRET']
    .filter((k) => process.env[k])
    .map((k) => `${k}=${process.env[k]}`)
  writeFileSync(
    '.env.staging',
    [
      '# Written by `npm run staging:up`. Points everything at the LOCAL stack.',
      '# Regenerated on every run; edit .env instead.',
      `PUBLIC_SUPABASE_URL=${url}`,
      `PUBLIC_SUPABASE_ANON_KEY=${publishable}`,
      `SUPABASE_URL=${url}`,
      `SUPABASE_SECRET_KEY=${secret}`,
      ...carry,
      '',
    ].join('\n'),
  )

  console.log(`[staging] ready. Site: npm run staging:dev → http://localhost:5175`)
  if (!readFileSync('.env.staging', 'utf8').includes('TYPESAFE_API_KEY')) {
    console.log('[staging] no TYPESAFE_API_KEY in .env, so staging:pipeline will not run')
  }
}

main().catch((err) => {
  console.error('[staging] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
