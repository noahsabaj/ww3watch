// The link-preview card for a shared story or article: what iMessage, WhatsApp,
// Slack and friends show when someone pastes a ww3watch.org/?story= or
// ?article= link. The site is static, and those apps read the page's meta tags
// without running the app, so the Cloudflare Worker in cloudflare/share-card
// fills them in from these rows before the page leaves the edge.
//
// Same photo rules as the app (storyImage): the publisher's own photograph,
// never a share card, logo or reused house graphic, and no text drawn on it.
// Stories without one keep the site card (static/og.png).
import type { Article } from './types'
import { storyImage } from './cluster'
import { headlineText } from './utils'

export const CARD_COLUMNS =
  'id,title,source_name,source_lang,published_at,story_id,image_url,image_width,image_height,image_verdict'

export type CardRow = Pick<
  Article,
  'id' | 'title' | 'source_name' | 'source_lang' | 'published_at' | 'story_id' | 'image_url' | 'image_width' | 'image_height' | 'image_verdict'
>

export interface ShareCard {
  title: string
  description: string
  url: string
  image: { url: string; width: number | null; height: number | null; alt: string } | null
}

const SITE = 'https://ww3watch.org'
const ts = (a: CardRow) => a.published_at ?? ''

/**
 * @param kind   which link was shared
 * @param id     the id in that link
 * @param target the shared article (kind 'article'), if it still exists
 * @param members every article in the story, newest first or in any order
 */
export function shareCard(
  kind: 'story' | 'article',
  id: string,
  target: CardRow | null,
  members: CardRow[],
): ShareCard | null {
  const all = members.length > 0 ? members : target ? [target] : []
  if (all.length === 0) return null
  const newest = all.reduce((best, a) => (ts(a) > ts(best) ? a : best), all[0])
  const rep = kind === 'article' && target ? target : newest

  // A story's headline in the language most people receiving it will read,
  // when one of its outlets wrote one; an article link keeps its own.
  const english = all.filter((a) => a.source_lang === 'en').sort((a, b) => ts(b).localeCompare(ts(a)))[0]
  const headlineFrom = kind === 'story' && rep.source_lang !== 'en' && english ? english : rep
  const title = headlineText(headlineFrom.title).trim()

  const names = [...new Set([rep, ...[...all].sort((a, b) => ts(b).localeCompare(ts(a)))].map((a) => a.source_name))]
  const description =
    names.length > 1
      ? `${names.length} sources, including ${names.slice(0, 3).join(', ')}. Compare the coverage on WW3Watch.`
      : `Reported by ${names[0]}. Read it on WW3Watch.`

  // storyImage takes a cluster; the shared article leads it so its own photo wins.
  const photo = storyImage({
    id,
    storyId: null,
    representative: rep as Article,
    articles: [rep, ...all.filter((a) => a.id !== rep.id)] as Article[],
    sourceCount: names.length,
    updatedAt: 0,
  })

  return {
    title,
    description,
    url: `${SITE}/?${kind}=${encodeURIComponent(id)}`,
    image: photo
      ? {
          url: photo.url,
          width: photo.article.image_width ?? null,
          height: photo.article.image_height ?? null,
          alt: `Photograph published by ${photo.sourceName}`,
        }
      : null,
  }
}
