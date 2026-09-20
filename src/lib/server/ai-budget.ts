/** All provider attempts reserve spend before transmission, including retries. */
let denied = false
export function assertBudgetHealthy() {
  if (denied) throw new Error('AI budget unavailable during this run; pending judgments were deferred')
}
export async function reserveClassification(model: string, request: string, deadlineMs?: number) {
  const { supabaseAdmin: db } = await import('./supabase')
  const waitUntil = Math.min(deadlineMs ?? Infinity, Date.now() + 30_000)
  for (;;) {
    const { data, error } = await db.rpc('reserve_ai', {
      p_service:'classification', p_model:model,
      p_input_tokens:Buffer.byteLength(request,'utf8')*4+65536, p_output_tokens:0,
    })
    // A full concurrency window is temporary, not an exhausted allowance. Wait
    // for an existing attempt to settle, then ask the atomic gate again. Never
    // contact the provider without a reservation, even after the wait expires.
    if (!error && data && typeof data === 'object' && !Array.isArray(data) && data.error === 'busy' && Date.now() + 500 < waitUntil) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      continue
    }
    if (error || !data || typeof data!=='object' || Array.isArray(data) || typeof data.id!=='string') {
      denied = true
      const reason = error ? 'ledger_error' : data && typeof data === 'object' && !Array.isArray(data) ? data.error : 'invalid_response'
      console.error('[budget] reservation denied:', reason)
      throw new Error('AI budget unavailable; judgment deferred')
    }
    const id = data.id
    return async (inputTokens?: number) => {
      const valid = Number.isInteger(inputTokens) && inputTokens!>=0
      const { error } = await db.rpc('settle_ai', { p_id:id,p_input_tokens:valid ? inputTokens : undefined,p_output_tokens:valid ? 0 : undefined })
      if (error) console.error('[budget] settlement unavailable; reservation retained')
    }
  }
}
