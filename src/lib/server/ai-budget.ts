/** All provider attempts reserve spend before transmission, including retries. */
export async function reserveClassification(model: string, request: string) {
  const { supabaseAdmin: db } = await import('./supabase')
  const { data, error } = await db.rpc('reserve_ai', {
    p_service:'classification', p_model:model,
    p_input_tokens:Buffer.byteLength(request,'utf8')*4+65536, p_output_tokens:0,
  })
  if (error || !data || typeof data!=='object' || Array.isArray(data) || typeof data.id!=='string') {
    throw new Error('AI budget unavailable; judgment deferred')
  }
  const id = data.id
  return async (inputTokens?: number) => {
    const valid = Number.isInteger(inputTokens) && inputTokens!>=0
    const { error } = await db.rpc('settle_ai', { p_id:id,p_input_tokens:valid ? inputTokens : undefined,p_output_tokens:valid ? 0 : undefined })
    if (error) console.error('[budget] settlement unavailable; reservation retained')
  }
}
