// Per-article signals: the worklist stage that annotates accepted articles.
import { askSignals } from '../jev-signals'
import { mapPool } from '../pool'
import { supabaseAdmin } from '../supabase'
import type { ArticleSignals } from '../../signals'
import { PURGE_BELOW, PURGE_CAP_PER_RUN, SIGNALS_CAP, SIGNALS_CONCURRENCY, SIGNALS_LOOKBACK_HOURS, UPSERT_BATCH } from '../config'
import { bump, type RunStats } from './stats'

// Annotate accepted articles that have no signals yet (signals_at IS NULL).
// Same contract as clustering: failure never fails the run, the rows stay on
// the worklist, and the next run picks them up.
export async function enrichSignals(stats: RunStats, deadlineMs: number): Promise<void> {
  try {
    const since = new Date(Date.now() - SIGNALS_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data: pending, error } = await supabaseAdmin
      .from('articles')
      .select('id, title, summary, source_lang, jev_relevant')
      .is('signals_at', null)
      .gte('fetched_at', since)
      .order('fetched_at', { ascending: false })
      .limit(SIGNALS_CAP)
    if (error) throw new Error(`worklist query failed: ${JSON.stringify(error)}`)
    if (!pending?.length) return

    const items: Array<{ id: string } & ArticleSignals> = []
    const irrelevant: string[] = []
    let tokens = 0
    // jev_relevant is already set for articles Jev itself accepted; only the
    // head's accepts still need the relevance question.
    const asked = await mapPool(pending, SIGNALS_CONCURRENCY, (a) => askSignals(a, deadlineMs, a.jev_relevant ?? null), { deadlineMs })
    for (const { item: a, value } of asked.done) {
      const { inputTokens, ...signals } = value
      tokens += inputTokens
      items.push({ id: a.id, ...signals })
      if (a.jev_relevant == null && signals.jev_relevant !== null && signals.jev_relevant < PURGE_BELOW) irrelevant.push(a.id)
    }
    const failed = asked.failed.length
    asked.failed.slice(0, 3).forEach(({ error }) =>
      console.error('[signals] jev call failed (article stays on the worklist):', String(error).slice(0, 200)),
    )
    let applied = 0
    for (let i = 0; i < items.length; i += UPSERT_BATCH) {
      const { data, error: rpcError } = await supabaseAdmin.rpc('apply_article_signals', { p_items: items.slice(i, i + UPSERT_BATCH) })
      if (rpcError) throw new Error(`apply_article_signals failed: ${JSON.stringify(rpcError)}`)
      applied += Number(data) || 0
    }
    // Annotated FIRST, purged second: anything over the cap keeps its signals
    // (and its low jev_relevant on the record) instead of being re-asked forever.
    if (irrelevant.length > 0) {
      const { data, error: purgeError } = await supabaseAdmin.rpc('purge_irrelevant_articles', {
        p_ids: irrelevant.slice(0, PURGE_CAP_PER_RUN),
      })
      if (purgeError) console.error('[signals] purge failed (articles stay):', purgeError)
      else {
        bump(stats, 'signals_purged', Number(data) || 0)
        console.log(`[pipeline] signals: removed ${Number(data) || 0} of ${irrelevant.length} accepted articles Jev puts below P(relevant) ${PURGE_BELOW}`)
      }
    }
    bump(stats, 'signals_applied', applied)
    bump(stats, 'signals_failed', failed)
    bump(stats, 'signals_tokens', tokens)
    console.log(`[pipeline] signals: ${applied} articles annotated (${failed} failed, ${pending.length - items.length - failed} left for next run)`)
  } catch (err) {
    console.error('[pipeline] signals FAILED (articles stay un-annotated; next run self-heals):', err)
    stats.signals_error = String(err).slice(0, 300)
  }
}
