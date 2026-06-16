// Dumps the curated sources roster to data/sources-backup.json so the canonical
// feed list survives a Supabase free-tier pause/delete (the free tier has no
// automated backups, and curation lives only in the DB). Run weekly by
// backup.yml; restore by feeding this JSON back through an upsert (run-script.yml).
//
// Only the CURATED columns are dumped — not health/timestamps, which churn every
// run and would create noisy commits. Sorted by name for a clean, reviewable diff.
//
// Uses a standalone Supabase client (NOT ../src/lib/server/supabase, which eagerly
// validates the LLM env this job has no reason to carry).
import { writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
const supabase = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  const { data, error } = await supabase
    .from('sources')
    .select('url, name, region, lang, enabled, affiliation')
    .order('name')
  if (error) throw new Error(`sources query failed: ${JSON.stringify(error)}`)
  if (!data?.length) throw new Error('sources roster empty — refusing to write an empty backup')

  const rows = data.map((s) => ({
    url: s.url,
    name: s.name,
    region: s.region,
    lang: s.lang,
    enabled: s.enabled,
    affiliation: s.affiliation ?? null,
  }))

  mkdirSync('data', { recursive: true })
  writeFileSync('data/sources-backup.json', JSON.stringify(rows, null, 2) + '\n')
  console.log(`[backup] wrote ${rows.length} sources to data/sources-backup.json`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backup] fatal:', err)
    process.exit(1)
  })
