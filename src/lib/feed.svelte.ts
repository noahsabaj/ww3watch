// The live article list and everything that mutates it, extracted from
// routes/+page.svelte: adoption of the +page.ts load, Supabase realtime
// (inserts, batched cluster-assignment updates, trending rewrites), "Load
// older" pagination, deep-link recovery fetches and the pipeline freshness
// readout.
//
// createFeed() is a factory, not a module singleton like now.svelte.ts /
// prefs.svelte.ts: the state it replaces was component-local and is rebuilt
// from the load data on every mount of the page, and that lifetime is
// preserved. Call it during component initialisation; call start() from
// onMount and stop() from its cleanup.
import { supabase } from './supabase'
import type { Article } from './types'
import { groupByStoryId } from './cluster'
import type { Cluster } from './cluster'
import { clock } from './now.svelte'
import { FEED_COLUMNS } from './feed-columns'

export type TrendingRef = { article_id: string; story_id: string | null }

export interface FeedInitial {
  articles: Article[]
  trending: TrendingRef[]
  lastUpdatedAt: string | null
}

export interface FeedOptions {
  /** True while the reader has scrolled away from the top: realtime inserts are
   *  then queued behind the "N new articles" pill instead of shifting the feed.
   *  Read at flush time, never cached. */
  isPaused: () => boolean
}

// Dead-man's switch tiers: pipeline real cadence is 30–120 min, so >3h means
// several missed runs; >24h means it's down.
const STALE_AMBER_MS = 60 * 60 * 1000
const STALE_RED_MS = 3 * 60 * 60 * 1000

// Two separate cluster passes: allClustered uses the full article list (global top stories),
// clustered uses the filtered list (feed view). They cannot be shared.
const TOP_STORIES_WINDOW_MS = 60 * 60 * 1000
// Cap in-memory list growth on long-lived tabs (realtime keeps prepending).
const MAX_ARTICLES = 800
// Hard ceiling once the user has paged back (articleCap grows with each "Load
// older" so a realtime prepend can't slice off loaded rows — but it must stop
// growing somewhere, or a paged-back long-lived tab loses the MAX_ARTICLES
// protection entirely). Beyond this, the next realtime flush trims the oldest.
const MAX_LOADED = 2400

const INITIAL_LIMIT = 500 // keep in sync with +page.ts .limit()
const PAGE_SIZE = 100

export function createFeed(initial: FeedInitial, options: FeedOptions) {
  let articles = $state<Article[]>(initial.articles)
  let newQueue = $state<Article[]>([])
  // Live trending selection: seeded from the load, refreshed via realtime
  // events on the trending table (the pipeline rewrites it each run).
  let trending = $state<TrendingRef[]>(initial.trending)
  // Last successful ingestion run — the "updated Xm ago" readout. Anchor only
  // changes when a run completes; the label itself ticks via clock.now.
  let lastUpdatedAt = $state<string | null>(initial.lastUpdatedAt)
  let realtimeStatus = $state('CLOSED')

  // allClustered uses the full (unfiltered) article list — see the "Two
  // separate cluster passes" note above.
  let allClustered = $derived(groupByStoryId(articles))

  let staleness = $derived.by((): 'ok' | 'amber' | 'red' | null => {
    if (!lastUpdatedAt) return null
    const age = clock.now - Date.parse(lastUpdatedAt)
    return age > STALE_RED_MS ? 'red' : age > STALE_AMBER_MS ? 'amber' : 'ok'
  })

  // Pagination ("Load older"): numeric offset against the same DESC ordering.
  // serverOffset counts rows pulled from the server (independent of realtime
  // prepends); articleCap lets the realtime slice-cap grow as the user pages back,
  // so a live insert never discards manually-loaded older stories.
  // Note: realtime INSERTs land at the TOP of the DESC window, so rows added
  // server-side after load shift everything to a higher absolute offset and the
  // next range() re-reads a few already-held rows. Those are deduped client-side
  // (the `known` Set) — correct, just a little redundant egress on a tab left open
  // across pipeline runs. Offset is chosen over a keyset cursor precisely because
  // it never SKIPS a row (the dedup makes overlap harmless) and handles the
  // null-published tail without a separate query.
  let serverOffset = $state(initial.articles.length)
  let hasMore = $state(initial.articles.length >= INITIAL_LIMIT)
  let loadingMore = $state(false)
  let articleCap = $state(MAX_ARTICLES)
  // Pre-existing polite live region (announced to screen readers). Focus for the
  // "Load older" button (re-rendering the feed blurs it) and the end marker it's
  // replaced by on the final page is restored by id, after the DOM settles.
  let liveMessage = $state('')

  // Toast for deep-link recovery + pagination errors.
  let toast = $state<string | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function showToast(msg: string) {
    toast = msg
    liveMessage = msg // announce via the persistent live region (the visual pill is sighted-only)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = null), 4500)
  }

  let topStories = $derived.by(() => {
    if (trending.length > 0) {
      // Resolve by story_id when the row has one; fall back to membership
      // lookup for legacy rows written before stories existed. Dedupe in case
      // two picks land in the same cluster.
      const seen = new Set<string>()
      const result: Cluster[] = []
      for (const t of trending) {
        const c =
          (t.story_id ? allClustered.find(cl => cl.storyId === t.story_id) : undefined) ??
          allClustered.find(cl => cl.articles.some(a => a.id === t.article_id))
        if (c && !seen.has(c.id)) {
          seen.add(c.id)
          result.push(c)
        }
      }
      return result
    }
    // clock.now, not Date.now(): inside a $derived, Date.now() is not a reactive
    // dependency, so this window never slid — the fallback selection froze until
    // something else happened to invalidate the derivation. Time-derived values
    // read the shared clock (docs/CONVENTIONS.md).
    return allClustered
      .filter(c =>
        c.representative.published_at
          ? clock.now - new Date(c.representative.published_at).getTime() < TOP_STORIES_WINDOW_MS
          : false
      )
      .sort((a, b) => b.sourceCount - a.sourceCount)
      .slice(0, 3)
  })

  // The pipeline rewrites trending as a burst (≤3 DELETEs + 3 INSERTs) —
  // debounce to one refetch, and never interpret event payloads (DELETE
  // delivery semantics under RLS differ; any event is just a refetch signal).
  let trendingRefreshTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleTrendingRefresh() {
    clearTimeout(trendingRefreshTimer)
    trendingRefreshTimer = setTimeout(async () => {
      const { data: rows, error } = await supabase
        .from('trending')
        .select('article_id, rank, story_id')
        .order('rank', { ascending: true })
      // On error keep the previous selection.
      if (!error && rows) trending = rows.map((t) => ({ article_id: t.article_id, story_id: t.story_id ?? null }))
    }, 2500)
  }

  // Article writes can arrive before the run is recorded as successful. Poll
  // the tiny timestamp while visible too, so quiet runs and that race cannot
  // leave an open tab falsely reporting an outage.
  let statusRefreshTimer: ReturnType<typeof setTimeout> | undefined
  let statusPollTimer: ReturnType<typeof setInterval> | undefined
  async function refreshPipelineStatus() {
    try {
      const { data: ts, error } = await supabase.rpc('pipeline_status')
      if (!error && ts) lastUpdatedAt = ts as string
    } catch { /* preserve the last verified completion time */ }
  }
  function refreshVisibleStatus() {
    if (document.visibilityState === 'visible') void refreshPipelineStatus()
  }
  function schedulePipelineStatusRefresh() {
    clearTimeout(statusRefreshTimer)
    statusRefreshTimer = setTimeout(refreshPipelineStatus, 5000)
  }

  // Realtime burst batching: the pipeline writes a burst of inserts +
  // cluster-assignment updates every ~15 min. Accumulate raw events in
  // non-reactive buffers and apply them in ONE state reassignment per ~500ms
  // window, instead of a full derived-graph recompute per event.
  let pendingInserts: Article[] = []
  let pendingUpdates = new Map<string, Article>()
  let realtimeFlushTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleRealtimeFlush() {
    clearTimeout(realtimeFlushTimer)
    realtimeFlushTimer = setTimeout(applyRealtime, 500)
  }
  function applyRealtime() {
    if (pendingInserts.length > 0) {
      const incoming = pendingInserts
      pendingInserts = []
      // Dedupe against current lists (realtime replays on reconnect) + within batch.
      const known = new Set<string>([...articles, ...newQueue].map((a) => a.id))
      const fresh: Article[] = []
      for (const a of incoming) if (!known.has(a.id)) { known.add(a.id); fresh.push(a) }
      if (fresh.length > 0) {
        // isPaused (scrollY>300) read at flush time, so a mid-burst scroll wins.
        if (options.isPaused()) newQueue = [...fresh, ...newQueue]
        else articles = [...fresh, ...articles].slice(0, articleCap)
      }
    }
    if (pendingUpdates.size > 0) {
      const updates = pendingUpdates
      pendingUpdates = new Map()
      // Patch in whichever list holds each id; unknown ids no-op.
      articles = articles.map((a) => updates.get(a.id) ?? a)
      newQueue = newQueue.map((a) => updates.get(a.id) ?? a)
    }
  }

  /** Move the queued realtime inserts into the feed. Scrolling back to the top
   *  is the caller's job. */
  function flushQueue() {
    articles = [...newQueue, ...articles].slice(0, articleCap)
    newQueue = []
  }

  // "Load older": pull the next page from the server (offset against the same
  // DESC order), append the rows not already held. Appending older rows keeps
  // the list DESC; groupByStoryId re-sorts regardless. articleCap grows so a
  // realtime prepend won't slice off what we just loaded.
  //
  // Resolves true when a page was fetched (even an empty one), false when the
  // call was a no-op or failed — the page uses that to decide whether to
  // restore keyboard focus.
  async function loadOlder(): Promise<boolean> {
    if (loadingMore || !hasMore) return false
    loadingMore = true
    const { data: rows, error } = await supabase
      .from('articles')
      .select(FEED_COLUMNS)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('fetched_at', { ascending: false })
      .range(serverOffset, serverOffset + PAGE_SIZE - 1)
    loadingMore = false
    if (error) {
      showToast("Couldn't load older stories.")
      return false
    }
    serverOffset += PAGE_SIZE
    const incoming = (rows ?? []) as Article[]
    if (incoming.length < PAGE_SIZE) hasMore = false
    const known = new Set(articles.map((a) => a.id))
    const fresh = incoming.filter((a) => !known.has(a.id))
    if (fresh.length > 0) {
      // Grow the realtime slice-cap to fit, but never past MAX_LOADED — beyond
      // that the next realtime flush trims the oldest, keeping memory bounded.
      articleCap = Math.min(articleCap + fresh.length, MAX_LOADED)
      articles = [...articles, ...fresh]
    }
    // Announce the result to screen readers; the button fires no visible state
    // on success on its own.
    const noun = fresh.length === 1 ? 'story' : 'stories'
    liveMessage = fresh.length > 0 ? `Loaded ${fresh.length} older ${noun}.` : 'No new older stories.'
    if (!hasMore) liveMessage += " You've reached the oldest stories."
    return true
  }

  // Deep-link recovery: open ?article=/?story= even when the target scrolled
  // past the initial window — fetch the missing row(s) on demand.
  //
  // `open` installs the reader state; it is supplied by deeplink.svelte.ts,
  // which owns the routing side (and the reason it is replaceState).
  async function recoverDeepLink(
    articleId: string | null,
    storyId: string | null,
    open: (id: string, sid?: string) => void,
  ) {
    if (articleId) {
      const local = articles.find((a) => a.id === articleId)
      if (local) { open(local.id); return }
      const { data: row, error } = await supabase
        .from('articles').select(FEED_COLUMNS).eq('id', articleId).maybeSingle()
      if (error || !row) { showToast('That article is no longer in the feed.'); return }
      const a = row as Article
      if (!articles.some((x) => x.id === a.id)) articles = [a, ...articles]
      open(a.id)
      return
    }
    if (storyId) {
      const local = allClustered.find((c) => c.storyId === storyId)
      if (local) { open(local.representative.id, storyId); return }
      const { data: rows, error } = await supabase
        .from('articles').select(FEED_COLUMNS).eq('story_id', storyId)
        .order('published_at', { ascending: false, nullsFirst: false }).limit(100)
      const list = (rows ?? []) as Article[]
      if (error || list.length === 0) { showToast('That story is no longer in the feed.'); return }
      const known = new Set(articles.map((a) => a.id))
      const fresh = list.filter((a) => !known.has(a.id))
      if (fresh.length > 0) articles = [...articles, ...fresh]
      // Newest member is the representative (matches groupByStoryId).
      const rep = list.reduce((best, a) =>
        ((a.published_at ?? '') > (best.published_at ?? '') ? a : best), list[0])
      open(rep.id, storyId)
    }
  }

  let channel: ReturnType<typeof supabase.channel> | undefined
  let updatesChannel: ReturnType<typeof supabase.channel> | undefined

  /** Subscribe to realtime. Browser-only — call from onMount. */
  function start() {
    statusPollTimer = setInterval(refreshVisibleStatus, 5 * 60_000)
    document.addEventListener('visibilitychange', refreshVisibleStatus)
    channel = supabase
      .channel('articles-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'articles' },
        (payload) => {
          pendingInserts.push(payload.new as Article)
          schedulePipelineStatusRefresh()
          scheduleRealtimeFlush()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trending' },
        () => {
          scheduleTrendingRefresh()
          // Trending rewrites even on zero-new-article runs — the best signal
          // that an ingestion run just completed.
          schedulePipelineStatusRefresh()
        },
      )
      // supabase-js auto-rejoins with backoff after TIMED_OUT/CHANNEL_ERROR and
      // re-fires SUBSCRIBED — the header dot just mirrors the latest status.
      .subscribe((status) => {
        realtimeStatus = status
      })

    // UPDATE on its OWN channel with a server-side filter: cluster-assignment
    // patches arrive minutes after the INSERT (recent fetched_at), so we only
    // need recent rows — this stops every backlog UPDATE fanning out to every
    // client (egress + radio wakeups). A SEPARATE channel means a filter
    // rejection degrades only cluster-patching, never the INSERT/trending feed.
    const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    updatesChannel = supabase
      .channel('articles-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'articles', filter: `fetched_at=gt.${recentCutoff}` },
        (payload) => {
          pendingUpdates.set((payload.new as Article).id, payload.new as Article)
          scheduleRealtimeFlush()
        },
      )
      .subscribe((status) => {
        // Only cluster-patching depends on this channel; if its filter is ever
        // rejected, log it (the main feed is unaffected) rather than failing silently.
        if (status === 'CHANNEL_ERROR') console.warn('[realtime] articles-updates channel error — live cluster regrouping degraded')
      })
  }

  /** Tear down timers and realtime channels — the onMount cleanup. */
  function stop() {
    clearInterval(statusPollTimer)
    document.removeEventListener('visibilitychange', refreshVisibleStatus)
    clearTimeout(trendingRefreshTimer)
    clearTimeout(statusRefreshTimer)
    clearTimeout(realtimeFlushTimer)
    clearTimeout(toastTimer)
    if (channel) supabase.removeChannel(channel)
    if (updatesChannel) supabase.removeChannel(updatesChannel)
    channel = updatesChannel = undefined
  }

  return {
    /** The unfiltered list, newest first. */
    get articles() { return articles },
    /** Realtime inserts held back while the reader is scrolled down. */
    get newQueue() { return newQueue },
    /** Every loaded article grouped into stories (unfiltered). */
    get allClustered() { return allClustered },
    /** The Trending Now selection (pipeline picks, or the fallback window). */
    get topStories() { return topStories },
    get lastUpdatedAt() { return lastUpdatedAt },
    get staleness() { return staleness },
    get realtimeStatus() { return realtimeStatus },
    get hasMore() { return hasMore },
    get loadingMore() { return loadingMore },
    get liveMessage() { return liveMessage },
    get toast() { return toast },
    initialize(value: FeedInitial) {
      const ids = new Set(value.articles.map(a => a.id))
      articles = [...value.articles, ...articles.filter(a => !ids.has(a.id))]
      trending = value.trending
      lastUpdatedAt = value.lastUpdatedAt
      serverOffset = value.articles.length
      hasMore = value.articles.length >= INITIAL_LIMIT
    },
    flushQueue,
    loadOlder,
    recoverDeepLink,
    start,
    stop,
  }
}

export type Feed = ReturnType<typeof createFeed>
