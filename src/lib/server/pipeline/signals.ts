// Per-article signals: the worklist stage that annotates accepted articles.
import { askSignals } from '../jev-signals'
import { mapPool } from '../pool'
import { supabaseAdmin } from '../supabase'
import type { ArticleSignals } from '../../signals'
import { PURGE_BELOW, PURGE_CAP_PER_RUN, SIGNALS_CAP, SIGNALS_CONCURRENCY, SIGNALS_LOOKBACK_HOURS, UPSERT_BATCH } from '../config'
import { bump, type RunStats } from './stats'
import { writeVerdicts } from './persist'
import { JEV_MODEL, jevState } from '../jev'

// Wire copies and cross-posts: the same headline, summary and language under
// another outlet or feed (~2% of accepted articles, most arriving runs after
// the first). Jev sees exactly jevState(), so the same state gets the same
// answers: ask once per state, and give a copy of an annotated article its
// answers instead of asking again.
const stateKey = (a: { title: string; summary: string | null; source_lang: string }) => JSON.stringify(jevState(a))
// The lookup's titles travel in the request URL, percent-encoded: a Persian or
// Arabic headline is ~6 bytes a character there. 25 titles a request reached
// tens of kilobytes, which the gateway refused ("fetch failed") on every run
// from 2026-09-23 16:00, and with it the whole signals stage. Chunks are
// bounded by encoded length instead.
const TITLE_URL_BUDGET = 4000
const TITLE_CHUNK_MAX = 25

export function titleChunks(titles: string[]): string[][] {
  const chunks: string[][] = []
  let chunk: string[] = []
  let size = 0
  for (const t of titles) {
    const len = encodeURIComponent(t).length
    if (chunk.length > 0 && (size + len > TITLE_URL_BUDGET || chunk.length >= TITLE_CHUNK_MAX)) {
      chunks.push(chunk)
      chunk = []
      size = 0
    }
    chunk.push(t)
    size += len
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

type Pending = { id: string; guid: string; title: string; summary: string | null; source_lang: string; jev_relevant: number | null }

async function annotatedCopies(pending: Pending[], since: string): Promise<Map<string, ArticleSignals>> {
  const found = new Map<string, ArticleSignals>()
  for (const chunk of titleChunks([...new Set(pending.map((a) => a.title))])) {
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select('title, summary, source_lang, topic, severity, claim, unverified, opinion, actors, jev_relevant')
      .in('title', chunk)
      .not('signals_at', 'is', null)
      .gte('fetched_at', since)
    if (error) throw new Error(`copy lookup failed: ${JSON.stringify(error)}`)
    for (const d of data ?? []) {
      found.set(stateKey(d), {
        topic: d.topic, severity: d.severity, claim: d.claim, unverified: d.unverified, opinion: d.opinion,
        actors: d.actors ?? [], jev_relevant: d.jev_relevant,
      } as ArticleSignals)
    }
  }
  return found
}

// Annotate accepted articles that have no signals yet (signals_at IS NULL).
// Same contract as clustering: failure never fails the run, the rows stay on
// the worklist, and the next run picks them up.
export async function enrichSignals(stats: RunStats, deadlineMs: number): Promise<void> {
  try {
    const since = new Date(Date.now() - SIGNALS_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data: pending, error } = await supabaseAdmin
      .from('articles')
      .select('id, guid, title, summary, source_lang, jev_relevant')
      .is('signals_at', null)
      .gte('fetched_at', since)
      .order('fetched_at', { ascending: false })
      .limit(SIGNALS_CAP)
    if (error) throw new Error(`worklist query failed: ${JSON.stringify(error)}`)
    if (!pending?.length) return

    const items: Array<{ id: string } & ArticleSignals> = []
    const irrelevant: string[] = []
    const purgeP = new Map<string, { guid: string; p: number; lang: string | null }>()
    let tokens = 0
    let reused = 0
    const take = (a: Pending, signals: ArticleSignals) => {
      // A copy keeps its own Jev relevance when classification already asked.
      const own = { ...signals, jev_relevant: a.jev_relevant ?? signals.jev_relevant }
      items.push({ id: a.id, ...own })
      if (a.jev_relevant == null && own.jev_relevant !== null && own.jev_relevant < PURGE_BELOW) {
        irrelevant.push(a.id)
        purgeP.set(a.id, { guid: a.guid, p: own.jev_relevant, lang: a.source_lang })
      }
    }

    // One question per distinct state; copies of an annotated article need none.
    // Reuse is a saving, never a gate: if the lookup fails, every article is
    // asked, as before copies were reused.
    const known = await annotatedCopies(pending, new Date(Date.now() - 7 * 86400_000).toISOString()).catch((err) => {
      console.error('[pipeline] signals copy lookup failed (asking Jev for every article):', err)
      stats.signals_copy_error = String(err).slice(0, 300)
      return new Map<string, ArticleSignals>()
    })
    const groups = new Map<string, Pending[]>()
    for (const a of pending) {
      const key = stateKey(a)
      const done = known.get(key)
      if (done) { take(a, done); reused++; continue }
      const g = groups.get(key)
      if (g) g.push(a)
      else groups.set(key, [a])
    }
    // jev_relevant is already set for articles Jev itself accepted; only the
    // head's accepts still need the relevance question. A group asks it unless
    // one of its copies already has Jev's answer.
    const leaders = [...groups.values()].map((g) => g.find((a) => a.jev_relevant != null) ?? g[0])
    const asked = await mapPool(leaders, SIGNALS_CONCURRENCY, (a) => askSignals(a, deadlineMs, a.jev_relevant ?? null), { deadlineMs })
    for (const { item: leader, value } of asked.done) {
      const { inputTokens, ...signals } = value
      tokens += inputTokens
      const group = groups.get(stateKey(leader))!
      for (const a of group) take(a, signals)
      reused += group.length - 1
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
        await writeVerdicts(
          irrelevant.slice(0, PURGE_CAP_PER_RUN).map((id) => purgeP.get(id)!).map((v) => ({
            guid: v.guid, judge: 'purge', decision: 'reject', p: v.p, threshold: PURGE_BELOW, model: JEV_MODEL, lang: v.lang,
          })),
        )
        console.log(`[pipeline] signals: removed ${Number(data) || 0} of ${irrelevant.length} accepted articles Jev puts below P(relevant) ${PURGE_BELOW}`)
      }
    }
    bump(stats, 'signals_applied', applied)
    bump(stats, 'signals_failed', failed)
    bump(stats, 'signals_tokens', tokens)
    bump(stats, 'signals_reused', reused)
    console.log(`[pipeline] signals: ${applied} articles annotated, ${reused} of them copies answered without asking (${failed} failed, ${pending.length - items.length - failed} left for next run)`)
  } catch (err) {
    console.error('[pipeline] signals FAILED (articles stay un-annotated; next run self-heals):', err)
    stats.signals_error = String(err).slice(0, 300)
  }
}
