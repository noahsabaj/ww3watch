// Reader panel routing, extracted from routes/+page.svelte: the shallow-routing
// glue that makes page.state the single source of truth for the open article,
// plus ?article= / ?story= deep-link handling.
//
// createReaderRouting() registers an $effect and an afterNavigate callback, so
// it MUST be called during component initialisation (top level of the page's
// <script>), never from onMount or an event handler.
import { afterNavigate, pushState, replaceState } from '$app/navigation'
import { page } from '$app/state'
import { base } from '$app/paths'
import type { Article } from './types'
import type { Feed } from './feed.svelte'

export function createReaderRouting(feed: Feed) {
  // ── Reader panel = shallow routing ─────────────────────────────────────────
  // The open article lives in page.state, not a local variable, so ONE mechanism
  // drives the panel and the browser's history: Back closes it, the URL names
  // what you're reading, and reload reopens it. Previously this was a local
  // $state plus a native history.replaceState that stripped the deep-link param
  // on mount — SvelteKit patches that method and warns it "will conflict with
  // SvelteKit's router" (see its client.js), and the panel was invisible to
  // history, so Back left the site instead of closing the reader.
  //
  // Articles fetched for a deep link are prepended to `articles` by
  // recoverDeepLink, so resolving by id here covers both cases. Identity is
  // preserved across realtime patches that don't touch this row, so the reader
  // doesn't refetch on every burst.
  let selectedArticle = $derived(
    page.state.articleId ? feed.articles.find(a => a.id === page.state.articleId) ?? null : null
  )
  let selectedCluster = $derived(
    selectedArticle
      ? feed.allClustered.find(c => c.articles.some(a => a.id === selectedArticle!.id)) ?? null
      : null
  )

  // True when WE pushed the history entry the panel sits on, so closing can pop
  // it. A cold deep link has no entry of ours behind it — history.back() there
  // would leave the site — so that path installs state with replaceState and
  // closing rewrites the URL instead.
  let openedByPush = false

  function openArticle(a: Article) {
    if (page.state.articleId === a.id) return
    if (page.state.articleId) {
      // Switching articles inside an open panel (the in-panel source list):
      // replace, so moving between sources of one story doesn't stack entries
      // the visitor then has to press Back through.
      replaceState(`?article=${a.id}`, { articleId: a.id })
    } else {
      pushState(`?article=${a.id}`, { articleId: a.id })
      openedByPush = true
    }
  }

  function closeArticle() {
    if (openedByPush) {
      openedByPush = false
      history.back() // native back is fine — only push/replaceState conflict with the router
    } else {
      replaceState(`${base}/`, {})
    }
  }

  // Back/forward can also clear the state without going through closeArticle;
  // keep the flag honest so a later close doesn't pop someone else's entry.
  $effect(() => {
    if (!page.state.articleId) openedByPush = false
  })

  // Deep-link targets (see feed.recoverDeepLink, which fetches them when they
  // scrolled past the initial window) are opened through this.
  //
  // Installs page.state with replaceState, NOT pushState: the visitor arrived
  // here directly, so there is no entry of ours behind this one and adding a new
  // one would mean Back leaves the site. The URL is left exactly as they typed
  // or were sent it — `?story=` links stay `?story=` links.
  const openDeepLink = (id: string, sid?: string) =>
    replaceState('', sid ? { articleId: id, storyId: sid } : { articleId: id })

  // Deep link: ?article=<id> opens that article, ?story=<id> that story — both
  // recovering targets that scrolled past the initial window.
  //
  // Runs in afterNavigate, NOT onMount: the router performs its own
  // history.replaceState while hydrating, which lands AFTER onMount and wipes
  // any page.state set there (sveltekit:states goes back to {}), so the panel
  // silently failed to open. afterNavigate fires once the initial navigation has
  // settled, which is the only safe moment to install state.
  let deepLinkHandled = false
  afterNavigate(() => {
    if (deepLinkHandled) return
    deepLinkHandled = true
    const params = new URLSearchParams(window.location.search)
    const articleId = params.get('article')
    const storyId = params.get('story')
    if (articleId || storyId) feed.recoverDeepLink(articleId, storyId, openDeepLink)
  })

  return {
    /** The article open in the reader panel, or null when it is closed. */
    get selectedArticle() { return selectedArticle },
    /** The story the open article belongs to. */
    get selectedCluster() { return selectedCluster },
    openArticle,
    closeArticle,
  }
}

export type ReaderRouting = ReturnType<typeof createReaderRouting>
