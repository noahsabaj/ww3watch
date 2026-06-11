// One-off (re-runnable) body_hash backfill for pre-existing articles.
// Run via the "Run script" workflow_dispatch (secrets live there):
//   gh workflow run run-script.yml -f script=scripts/backfill-body-hash.ts
//
// Hashes through src/lib/server/wire.ts — the SAME function the pipeline
// stamps with. Never reimplement the normalize in SQL (drift poisons equality).

import { createClient } from '@supabase/supabase-js'
import { bodyHash } from '../src/lib/server/wire'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('need SUPABASE_URL + SUPABASE_SECRET_KEY')
const supabase = createClient(url, key, { auth: { persistSession: false } })

const PAGE = 1000

async function main() {
  let updated = 0
  let skipped = 0
  let lastId = ''
  // Keyset pagination: unhashable rows keep body_hash null forever, so an
  // offset/page-0 strategy would starve on them. Walk ids once.
  for (;;) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, summary')
      .is('body_hash', null)
      .gt('id', lastId)
      .order('id')
      .limit(PAGE)
    if (error) throw new Error(JSON.stringify(error))
    if (!data?.length) break
    lastId = data[data.length - 1].id

    for (const a of data) {
      const hash = bodyHash(a.summary)
      if (!hash) {
        skipped++
        continue
      }
      const { error: upErr } = await supabase.from('articles').update({ body_hash: hash }).eq('id', a.id)
      if (upErr) throw new Error(JSON.stringify(upErr))
      updated++
    }
    console.log(`updated ${updated}, unhashable ${skipped}`)
  }
  console.log(`done: ${updated} hashed, ${skipped} unhashable (short/absent summaries)`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[backfill-body-hash] fatal:', err)
  process.exit(1)
})
