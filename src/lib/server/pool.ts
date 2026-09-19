// Bounded-concurrency map. One implementation of the worker-pool loop that was
// written out seven times (pipeline ×2, the Jev classifier, four scripts).
//
// Never rejects: a throwing `fn` is recorded in `failed`, because every caller's
// policy is the same — a failed call is not a verdict, the item is handled by
// whatever handles "unjudged". `deadlineMs` stops STARTING work; items never
// started come back in `skipped`.

export interface PoolResult<T, R> {
  done: Array<{ item: T; value: R }>
  failed: Array<{ item: T; error: unknown }>
  skipped: T[]
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  opts: { deadlineMs?: number } = {},
): Promise<PoolResult<T, R>> {
  const out: PoolResult<T, R> = { done: [], failed: [], skipped: [] }
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
        out.skipped.push(item)
        continue
      }
      try {
        out.done.push({ item, value: await fn(item) })
      } catch (error) {
        out.failed.push({ item, error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker))
  return out
}
