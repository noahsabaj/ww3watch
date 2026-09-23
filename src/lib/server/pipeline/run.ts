// The run itself: fetch → dedupe → classify (head, then Jev) → persist →
// cluster → annotate → trending → ops. Each stage lives in its own module; this
// file is the order they happen in and what flows between them.
import { fetchFeed, type FeedFetchResult } from '../rss'
import { existingGuids } from '../dedupe'
import { updateTrending, lastTrendingSelectedAt, trendingStuck } from '../trending'
import { RUN_BUDGET_MS, configSnapshot } from '../config'
import { loadSources, updateSourceHealth, logFeedSummary } from './sources'
import { embedAndAssignClusters, mergeStories } from './clustering'
import { enrichSignals } from './signals'
import { classifyFresh } from './classify'
import { checkOpsHealth, reportLowYield, reportSilentFeeds, previousRunJevDown } from './ops'
import { fillMissingImages } from './images'
import { checkPhotos } from './photo-check'
import { timed as timedStage, type RunStats } from './stats'

// Local-model clustering + trending + the ops-health gate. Shared by the
// no-new-articles path and the main path so every run captures trending status
// and DB health (and self-heals clustering).
async function finalize(stats: RunStats, startedAt: number): Promise<void> {
  const timed = <T>(stage: string, fn: () => Promise<T>) => timedStage(stats, stage, fn)
  await timed('cluster', () => embedAndAssignClusters(stats))
  // Before trending: it counts independent sources per story, and two halves of
  // one story each look half as corroborated.
  await timed('merge', () => mergeStories(stats))
  // Before trending, which ranks on these.
  await timed('signals', () => enrichSignals(stats, startedAt + RUN_BUDGET_MS))
  stats.trending = await timed('trending', () => updateTrending(startedAt + RUN_BUDGET_MS))
  // After trending: photographs are cosmetic and must never spend the budget
  // that ranking needs.
  await timed('images', () => fillMissingImages(stats, startedAt + RUN_BUDGET_MS))
  // After the fill, so a photo found this run is also checked this run; the
  // site shows none until it has been (photo-check.ts).
  await timed('photo_check', () => checkPhotos(stats, startedAt + RUN_BUDGET_MS))
  await timed('ops_health', () => checkOpsHealth(stats))
  await reportLowYield(stats)
  await reportSilentFeeds(stats)
  stats.total_ms = Date.now() - startedAt
  console.log(`[pipeline] done in ${stats.total_ms}ms | stages ${JSON.stringify(stats.timings ?? {})}`)

  // Loud failure for STUCK trending — after everything else has persisted, so
  // it alerts (freshness stays green: articles did land) without costing the
  // run's work. A single error:* is tolerated; error:* while the live selection
  // is hours old is not. replace_trending failed every run for four weeks with
  // only stats.trending saying so, and the site showed no Trending section.
  const trendingStatus = String(stats.trending ?? '')
  if (trendingStatus.startsWith('error:')) {
    const lastSelectedAt = await lastTrendingSelectedAt()
    if (trendingStuck(trendingStatus, lastSelectedAt, Date.now())) {
      throw new Error(
        `trending is stuck: this run reported ${trendingStatus} and the live selection is from ${lastSelectedAt ?? 'never'}`,
      )
    }
  }
}

export async function run(stats: RunStats): Promise<void> {
  const startedAt = Date.now()
  // Per-stage wall-clock into pipeline_runs.stats.timings. Nothing measured the
  // shape of a run before, so "the pipeline is slow" could not be turned into
  // "which stage" without reading Actions logs by hand.
  const timed = <T>(stage: string, fn: () => Promise<T>) => timedStage(stats, stage, fn)
  // The thresholds and caps this run used, next to the numbers they produced.
  stats.config = configSnapshot()

  // 1. Load the roster from the DB, then fetch every feed in parallel;
  //    failures are recorded (and proxy-retried), never silently dropped.
  const sources = await timed('roster', () => loadSources())
  const settled = await timed('fetch', () => Promise.allSettled(sources.map((feed) => fetchFeed(feed))))
  const results: FeedFetchResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { feed: sources[i], via: 'direct', articles: [], error: { kind: 'network', detail: String(s.reason) } },
  )
  Object.assign(stats, logFeedSummary(results))
  stats.sources_disabled = await timed('source_health', () => updateSourceHealth(results))

  // Dead-man's switch: if EVERY feed failed (runner egress outage, proxy down,
  // DNS), a "no new articles" success would reset the freshness clock on the
  // exact failure class the readout exists for. Fail loudly — after the health
  // write (so per-source failures are recorded); recordRun fires via finally.
  if ((stats.feeds_ok as number) === 0) {
    throw new Error('all feeds failed to fetch — refusing to record a successful run')
  }

  const candidates = results.flatMap((r) => r.articles).filter((a) => a.guid !== '')

  // De-dup within this run: the same article can arrive from multiple feeds.
  const uniqueByGuid = [...new Map(candidates.map((a) => [a.guid, a])).values()]

  // 2. De-dup against the DB (kept articles UNION recorded rejects) so we only
  //    spend Jev tokens on genuinely-unseen articles.
  const existing = await timed('dedupe', () => existingGuids(uniqueByGuid.map((a) => a.guid)))
  const fresh = uniqueByGuid.filter((a) => !existing.has(a.guid))
  console.log(`[pipeline] ${candidates.length} items -> ${uniqueByGuid.length} unique -> ${fresh.length} new`)
  Object.assign(stats, { items: candidates.length, unique: uniqueByGuid.length, new: fresh.length })

  if (fresh.length === 0) {
    // Still run clustering: a previous run's embed/assign failure leaves
    // backlog that must heal even on quiet runs.
    console.log('[pipeline] no new articles; clustering self-heal + trending only')
    await finalize(stats, startedAt)
    return
  }

  // 3. Classify: the local head, then Jev (./classify.ts). Verdicts are persisted
  //    inside the stage, the head's first, so nothing waits on the network.
  const { jevPool, jevFailed } = await classifyFresh(fresh, stats, startedAt)

  // 4/5/6. Embed + assign stories (story_id IS NULL worklist self-heals),
  //         annotate signals, recompute trending, read the ops-health gate.
  await finalize(stats, startedAt)

  // 7. Loud failure when Jev is DOWN — after the head's inserts and the
  //    clustering self-heal have persisted, so an outage degrades the run rather
  //    than dropping it, but the run still FAILS (freshness amber + GitHub issue)
  //    instead of laundering a near-empty result into a green one. A handful of
  //    failed calls is a hiccup; most of a real pool failing is an outage — and
  //    only on the second run in a row, so one bad minute never files an issue.
  const jevDown = jevPool >= 5 && jevFailed > jevPool / 2
  stats.cls_all_failed = jevDown
  if (jevDown && (await previousRunJevDown())) {
    throw new Error(`jev failed ${jevFailed}/${jevPool} calls on two consecutive runs — TypeSafe appears down`)
  }
}
