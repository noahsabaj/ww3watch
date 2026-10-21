// De-dup new feed items against what the DB has already judged — kept articles
// UNION recorded rejects — so the run only spends Jev tokens on genuinely
// unseen articles.
//
// Lives here rather than inline in scripts/run-pipeline.ts because that script
// calls main() at import time and so cannot be imported by a test. The failure
// mode below went unnoticed for exactly that reason.

import { supabaseAdmin } from './supabase'
import { mapPool } from './pool'

// The guid RPCs POST the array, so there is no URL-length limit to respect.
const GUID_QUERY_CHUNK = 1000
const GUID_QUERY_CONCURRENCY = 4
const RETRY_DELAY_MS = 500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// unseen_guids answers with the new guids only: a run checks ~6,600 and ~45
// are new, so existing_guids sent back ~6,555 known ones every 5 minutes, ~70
// MB a day of metered egress. A database without its migration
// (20261021170000_unseen_guids.sql) reports the function missing (PGRST202);
// the run then asks existing_guids, as before, for the rest of its life.
let unseenAvailable = true

async function knownIn(chunk: string[]): Promise<{ known: string[] | null; error: unknown }> {
  if (unseenAvailable) {
    const { data, error } = await supabaseAdmin.rpc('unseen_guids', { check_guids: chunk })
    if (!error) {
      const unseen = new Set((data ?? []).map((r) => r.guid))
      return { known: chunk.filter((g) => !unseen.has(g)), error: null }
    }
    if (error.code !== 'PGRST202') return { known: null, error }
    unseenAvailable = false
    console.warn('[pipeline] unseen_guids is not in this database yet; checking with existing_guids')
  }
  const { data, error } = await supabaseAdmin.rpc('existing_guids', { check_guids: chunk })
  return { known: error ? null : (data ?? []).map((r) => r.guid), error }
}

/**
 * Ids already present in the DB (articles ∪ classified_rejects), worked out
 * from the ones the DB has never seen.
 *
 * A failed chunk used to be logged and swallowed, which silently means
 * "everything is new": the chunk contributes nothing to the set, so up to
 * GUID_QUERY_CHUNK already-judged articles re-enter the run, consume the
 * per-run classify cap re-judging articles that already carry permanent
 * verdicts, and push genuinely new ones to the next run — while the run
 * recorded a clean success and no stat made it visible.
 *
 * One retry absorbs a transient blip. Past that the run FAILS, which is the
 * same rule the roster query already follows (docs/CONVENTIONS.md: "The
 * pipeline THROWS on a failed/empty roster query… Failures must be loud").
 */
export async function existingGuids(guids: string[]): Promise<Set<string>> {
  const existing = new Set<string>()
  const chunks: string[][] = []
  for (let i = 0; i < guids.length; i += GUID_QUERY_CHUNK) chunks.push(guids.slice(i, i + GUID_QUERY_CHUNK))
  // A few chunks at once: one after another, ~7 chunks of index lookups took
  // ~3.5 s of every run (2026-10-17). Any chunk failing still fails the run.
  const results = await mapPool(chunks, GUID_QUERY_CONCURRENCY, async (chunk) => {
    const n = chunks.indexOf(chunk)
    let { known, error } = await knownIn(chunk)
    if (error) {
      console.error(`[pipeline] guid lookup error on chunk ${n} (retrying):`, error)
      await sleep(RETRY_DELAY_MS)
      ;({ known, error } = await knownIn(chunk))
    }
    if (error || !known) {
      throw new Error(
        `guid lookup RPC failed for chunk ${n} after a retry — ` +
          `refusing to treat ${chunk.length} already-judged articles as new: ${JSON.stringify(error)}`,
      )
    }
    return known
  })
  if (results.failed.length > 0) throw results.failed[0].error
  for (const { value } of results.done) value.forEach((g) => existing.add(g))
  return existing
}
