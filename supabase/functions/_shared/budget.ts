import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

export class BudgetError extends Error {}
export async function reserveTranslation(db: SupabaseClient, model: string, prompt: string, output: number) {
  // UTF-8 bytes upper-bound ordinary input tokenization; include chat-template headroom.
  const { data, error } = await db.rpc('reserve_ai', { p_service:'translation', p_model:model, p_input_tokens:new TextEncoder().encode(prompt).length+4096, p_output_tokens:output })
  if (error || !data?.id) throw new BudgetError(data?.error ?? 'quota_unavailable')
  return async (usage?: { prompt_tokens?: number; completion_tokens?: number }) => {
    const valid = Number.isInteger(usage?.prompt_tokens) && Number.isInteger(usage?.completion_tokens) && usage!.prompt_tokens!>=0 && usage!.completion_tokens!>=0
    const { error } = await db.rpc('settle_ai', { p_id:data.id, p_input_tokens:valid ? usage!.prompt_tokens : null, p_output_tokens:valid ? usage!.completion_tokens : null })
    if (error) console.error('[budget] settlement unavailable; reservation retained')
  }
}
