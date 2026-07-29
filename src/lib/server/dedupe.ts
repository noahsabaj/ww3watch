// De-dup new feed items against what the DB has already judged — kept articles
// UNION recorded rejects — so the run only spends LLM tokens on genuinely
// unseen articles.
//
// Lives here rather than inline in scripts/run-pipeline.ts because that script
// calls main() at import time and so cannot be imported by a test. The failure
// mode below went unnoticed for exactly that reason.

import { supabaseAdmin } from './supabase'

// existing_guids POSTs the array, so there is no URL-length limit to respect.
const GUID_QUERY_CHUNK = 1000
const RETRY_DELAY_MS = 500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Ids already present in the DB (articles ∪ classified_rejects).
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
  for (let i = 0; i < guids.length; i += GUID_QUERY_CHUNK) {
    const chunk = guids.slice(i, i + GUID_QUERY_CHUNK)
    let { data, error } = await supabaseAdmin.rpc('existing_guids', { check_guids: chunk })
    if (error) {
      console.error(`[pipeline] existing_guids RPC error on chunk ${i / GUID_QUERY_CHUNK} (retrying):`, error)
      await sleep(RETRY_DELAY_MS)
      ;({ data, error } = await supabaseAdmin.rpc('existing_guids', { check_guids: chunk }))
    }
    if (error) {
      throw new Error(
        `existing_guids RPC failed for chunk ${i / GUID_QUERY_CHUNK} after a retry — ` +
          `refusing to treat ${chunk.length} already-judged articles as new: ${JSON.stringify(error)}`,
      )
    }
    ;(data as Array<{ guid: string }> | null)?.forEach((r) => existing.add(r.guid))
  }
  return existing
}
