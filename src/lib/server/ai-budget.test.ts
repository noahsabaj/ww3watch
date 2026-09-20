import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseAdmin: { rpc } }))

beforeEach(() => {
  vi.resetModules()
  rpc.mockReset()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

it('waits for a concurrency slot before allowing provider work', async () => {
  const { reserveClassification, assertBudgetHealthy } = await import('./ai-budget')
  rpc.mockResolvedValueOnce({ data: { error: 'busy' } })
    .mockResolvedValueOnce({ data: { id: 'reservation' } })
    .mockResolvedValue({ error: null })
  let providerAllowed = false
  const pending = reserveClassification('model', 'request').then((settle) => {
    providerAllowed = true
    return settle(23)
  })
  await vi.advanceTimersByTimeAsync(499)
  expect(providerAllowed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await pending
  expect(providerAllowed).toBe(true)
  expect(rpc).toHaveBeenLastCalledWith('settle_ai', { p_id: 'reservation', p_input_tokens: 23, p_output_tokens: 0 })
  expect(assertBudgetHealthy).not.toThrow()
})

it.each(['budget_exhausted', 'pricing_unverified', 'opening_usage_unverified'])('never retries a %s denial as concurrency', async (reason) => {
  const { reserveClassification, assertBudgetHealthy } = await import('./ai-budget')
  rpc.mockResolvedValue({ data: { error: reason } })
  await expect(reserveClassification('model', 'request')).rejects.toThrow('deferred')
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(assertBudgetHealthy).toThrow()
})

it('stops waiting at the caller deadline without granting permission', async () => {
  const { reserveClassification } = await import('./ai-budget')
  rpc.mockResolvedValue({ data: { error: 'busy' } })
  const pending = expect(reserveClassification('model', 'request', Date.now() + 1000)).rejects.toThrow('deferred')
  await vi.advanceTimersByTimeAsync(1000)
  await pending
  expect(rpc).toHaveBeenCalledTimes(2)
})

it('fails closed on a ledger error', async () => {
  const { reserveClassification } = await import('./ai-budget')
  rpc.mockResolvedValue({ error: { message: 'unavailable' } })
  await expect(reserveClassification('model', 'request')).rejects.toThrow('deferred')
  expect(rpc).toHaveBeenCalledTimes(1)
})
