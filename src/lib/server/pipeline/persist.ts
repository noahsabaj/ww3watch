// Writes of verdicts: accepted articles and recorded rejects.
import type { AppDatabase } from '../../db'
import type { TablesInsert } from '../../database.types'
import { supabaseAdmin } from '../supabase'
import { UPSERT_BATCH } from '../config'

export type ArticleUpsert = AppDatabase['public']['Tables']['articles']['Insert']

// Every reject path — Jev's verdicts, the head's confident rejects, and unjudged
// stale write-offs — goes through here so they can never drift in what they
// write. `reason` is the only thing that distinguishes them, and
// train-classifier.ts depends on it being accurate: it loads reason='jev' (and historical 'llm') as
// the negatives class, so a mislabelled row would train the head against a
// verdict no model ever gave (or against its own).
export async function writeRejects(
  rows: Array<{ guid: string; title: string | null; source_id: string | null; lang: string | null; reason: 'stale' | 'head' | 'jev' }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    const { error } = await supabaseAdmin
      .from('classified_rejects')
      .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })
    if (error) console.error('[pipeline] reject record error:', error)
  }
}

export async function upsertArticles(articles: ArticleUpsert[]): Promise<number> {
  let inserted = 0
  for (let i = 0; i < articles.length; i += UPSERT_BATCH) {
    const batch = articles.slice(i, i + UPSERT_BATCH)
    const { data, error } = await supabaseAdmin
      .from('articles')
      .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })
      .select('id')
    if (error) console.error(`[pipeline] upsert error (batch ${Math.floor(i / UPSERT_BATCH) + 1}):`, error)
    else inserted += data?.length ?? 0
  }
  return inserted
}

export type VerdictRow = TablesInsert<'verdicts'>

// The append-only record of every judgment (20260919150000_verdicts…). Strictly
// best-effort: it is analysis data, and must never cost a run its articles.
export async function writeVerdicts(rows: VerdictRow[]): Promise<number> {
  let written = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await supabaseAdmin.from('verdicts').insert(rows.slice(i, i + UPSERT_BATCH))
    if (error) console.error('[pipeline] verdict record error (non-fatal):', error)
    else written += Math.min(UPSERT_BATCH, rows.length - i)
  }
  return written
}
