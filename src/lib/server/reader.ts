import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

export interface ArticleContent {
  title: string
  byline: string | null
  content: string
  siteName: string | null
}

function stripEventHandlers(html: string): string {
  // Remove inline event handler attributes (on*)
  return html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
}

export async function extractArticle(url: string): Promise<ArticleContent | null> {
  let html: string
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    html = await res.text()
  } catch (err) {
    console.error('[reader] fetch failed:', url, err)
    return null
  }

  try {
    const { document } = parseHTML(html)
    const reader = new Readability(document as unknown as Document)
    const article = reader.parse()
    if (!article) return null
    return {
      title: article.title ?? '',
      byline: article.byline ?? null,
      content: stripEventHandlers(article.content ?? ''),
      siteName: article.siteName ?? null,
    }
  } catch (err) {
    console.error('[reader] parse failed:', url, err)
    return null
  }
}
