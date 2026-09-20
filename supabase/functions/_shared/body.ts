import { json } from './http.ts'

export async function boundedJson(req: Request, maxBytes = 16_384): Promise<Record<string, unknown> | Response> {
  const reader = req.body?.getReader()
  if (!reader) return json({ error: 'invalid_body' }, 400)
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxBytes) { await reader.cancel(); return json({ error: 'payload_too_large' }, 413) }
      chunks.push(part.value)
    }
    const buffer = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : json({ error: 'invalid_body' }, 400)
  } catch { return json({ error: 'invalid_body' }, 400) }
  finally { reader.releaseLock() }
}
