// One-off / on-demand: annotate accepted articles that have no Jev signals yet.
// The pipeline's own signals stage does the same 600 at a time; this drains a
// large backlog (first rollout, or after changing the question set and nulling
// signals_at) without waiting for it.
//
//   node --import tsx --env-file=.env scripts/backfill-signals.ts [hours=48]
//   gh workflow run run-script.yml -f script=scripts/backfill-signals.ts
import { createClient } from '@supabase/supabase-js'
import { askSignals } from '../src/lib/server/jev-signals'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('need SUPABASE_URL + SUPABASE_SECRET_KEY')
const supabase = createClient(url, key, { auth: { persistSession: false } })

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

    const items: Array<Record<string, unknown>> = []
    let pageFailed = 0
    let next = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < pending.length) {
          const a = pending[next++]
          try {
            const { inputTokens, ...signals } = await askSignals(a, undefined, a.jev_relevant ?? null)
            tokens += inputTokens
            items.push({ id: a.id, ...signals })
          } catch (err) {
            pageFailed++
            if (failed + pageFailed <= 3) console.error('jev call failed:', String(err).slice(0, 200))
          }
        }
      }),
    )
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
