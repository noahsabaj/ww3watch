// One-off / on-demand: annotate accepted articles that have no Jev signals yet.
// The pipeline's own signals stage does the same 600 at a time; this drains a
// large backlog (first rollout, or after changing the question set and nulling
// signals_at) without waiting for it.
//
//   WW3WATCH_ALLOW_PRODUCTION=1 node --import tsx --env-file=.env scripts/backfill-signals.ts [hours=48]
//   gh workflow run run-script.yml -f script=scripts/backfill-signals.ts
import { supabaseAdmin as supabase } from '../src/lib/server/supabase'
import { askSignals } from '../src/lib/server/jev-signals'
import { mapPool } from '../src/lib/server/pool'


const HOURS = Number(process.argv[2]) || 48
const PAGE = 500
const CONCURRENCY = 16

async function main() {
  const since = new Date(Date.now() - HOURS * 3600_000).toISOString()
  let applied = 0
  let failed = 0
  let tokens = 0
  for (;;) {
    const { data: pending, error } = await supabase
      .from('articles')
      .select('id, title, summary, source_lang, jev_relevant')
      .is('signals_at', null)
      .gte('fetched_at', since)
      .order('fetched_at', { ascending: false })
      .limit(PAGE)
    if (error) throw new Error(JSON.stringify(error))
    if (!pending?.length) break

    const asked = await mapPool(pending, CONCURRENCY, (a) => askSignals(a, undefined, a.jev_relevant ?? null))
    const items = asked.done.map(({ item, value: { inputTokens, ...signals } }) => {
      tokens += inputTokens
      return { id: item.id, ...signals }
    })
    const pageFailed = asked.failed.length
    if (failed < 3) asked.failed.slice(0, 3 - failed).forEach(({ error }) => console.error('jev call failed:', String(error).slice(0, 200)))
    for (let i = 0; i < items.length; i += 100) {
      const { data, error: rpcError } = await supabase.rpc('apply_article_signals', { p_items: items.slice(i, i + 100) })
      if (rpcError) throw new Error(JSON.stringify(rpcError))
      applied += Number(data) || 0
    }
    failed += pageFailed
    console.log(`annotated ${applied} (failed ${failed}, ${(tokens / 1e6).toFixed(2)}M tokens, $${((tokens / 1e6) * 0.042).toFixed(3)})`)
    // A page that made no progress would loop forever on the same rows.
    if (items.length === 0) break
  }
  console.log('done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
