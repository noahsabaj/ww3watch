/// <reference lib="dom" />
import { parseHTML } from 'npm:linkedom@0.18.12'

/** Text only goes to the model; our code retains every HTML node and attribute. */
export function readerSegments(content: string) {
  const { document } = parseHTML(`<html><body>${content}</body></html>`)
  const walker = document.createTreeWalker(document.body, 4)
  const nodes: Array<{ node: { nodeValue: string | null }; before: string; after: string }> = []
  const segments: string[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script,style,code,pre,noscript')) continue
    const raw = node.nodeValue ?? ''
    if (!raw.trim()) continue
    segments.push(raw.trim())
    nodes.push({ node, before: raw.slice(0, raw.length-raw.trimStart().length), after: raw.slice(raw.trimEnd().length) })
  }
  return {
    segments,
    render(translated: string[]) {
      nodes.forEach(({node,before,after},i) => { node.nodeValue = before+(translated[i] || segments[i])+after })
      return document.body.innerHTML
    },
  }
}
