// What this process has read from Supabase. Egress is metered by the byte, and
// the Free plan's 5 GB a month is what every 5-minute run spends from; in
// October 2026 it ran out, and nothing measured which reads had spent it, so
// the first fix was made from estimates (docs/OPERATIONS.md, "Egress"). Each
// response body is counted as it is read, decompressed: its full size,
// whatever the meter charges for it. Headers are not counted; `requests` is
// there to estimate them by.
export const egress = { bytes: 0, requests: 0 }

/** fetch, counting every response body into `egress`. For the Supabase client. */
export async function meteredFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  egress.requests++
  if (!res.body || res.status === 204 || res.status === 304) return res
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        egress.bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(counted, { status: res.status, statusText: res.statusText, headers: res.headers })
}

/** KB to one decimal, as pipeline_runs.stats records it. */
export const kb = (bytes: number): number => Math.round(bytes / 102.4) / 10
