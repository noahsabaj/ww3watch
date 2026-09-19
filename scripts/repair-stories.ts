// One-off / on-demand: undo wrong story merges made by the similarity threshold
// alone. For every non-representative member whose similarity to its story's
// representative is inside the grey band, ask Jev "same news story?"
// (src/lib/server/jev-pairs.ts). A DIFFERENT verdict detaches the article; the
// pipeline's clustering worklist (story_id IS NULL) then re-assigns it — with the
// pair judge — on its next runs. SAME / unsure / failed → left alone.
//
//   node --import tsx --env-file=.env scripts/repair-stories.ts [hours=24] [--dry]
import { supabaseAdmin as supabase } from '../src/lib/server/supabase'
import { judgeSameEvent, PAIR_BAND } from '../src/lib/server/jev-pairs'
import { mapPool } from '../src/lib/server/pool'


const HOURS = Number(process.argv.find((a) => /^\d+$/.test(a))) || 24
const DRY = process.argv.includes('--dry')
const CONCURRENCY = 16

interface Join { r_article_id: string; r_title: string; r_rep_title: string; r_sim: number }

async function main() {
  const since = new Date(Date.now() - HOURS * 3600_000).toISOString()
  const joins: Join[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .rpc('story_join_sims', { p_since: since, p_below: PAIR_BAND.hi })
      .range(from, from + 999)
    if (error) throw new Error(JSON.stringify(error))
    joins.push(...((data ?? []) as Join[]))
    if (!data || data.length < 1000) break
  }
  console.log(`${joins.length} joins below similarity ${PAIR_BAND.hi} in the last ${HOURS}h`)

  const detach: string[] = []
  const tally = { same: 0, different: 0, unsure: 0, failed: 0 }
  const samples: string[] = []
  const judged = await mapPool(joins, CONCURRENCY, (j) => judgeSameEvent(j.r_title, j.r_rep_title))
  tally.failed = judged.failed.length
  for (const { item: j, value: { verdict, p } } of judged.done) {
    tally[verdict]++
    if (verdict === 'different') {
      detach.push(j.r_article_id)
      if (samples.length < 12) samples.push(`  ${p.toFixed(2)} sim ${j.r_sim.toFixed(3)} | ${j.r_title.slice(0, 70)} ≠ ${j.r_rep_title.slice(0, 70)}`)
    }
  }
  console.log(tally)
  console.log('sample of DIFFERENT verdicts:\n' + samples.join('\n'))
  if (DRY) return console.log(`dry run — would detach ${detach.length}`)

  let detached = 0
  for (let i = 0; i < detach.length; i += 200) {
    const { data, error } = await supabase.rpc('detach_from_story', { p_ids: detach.slice(i, i + 200) })
    if (error) throw new Error(JSON.stringify(error))
    detached += Number(data) || 0
  }
  console.log(`detached ${detached}; the pipeline re-assigns them (newest first) over its next runs`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
