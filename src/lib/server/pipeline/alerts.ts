// The alarm: a push notification, to the browsers that asked for one, when a
// world-changing event is confirmed. Off unless a reader turns it on (the
// switch in the site menu); nothing about who they are is stored.
//
// A story qualifies when it is fresh, carried by at least 5 outlets in 3
// regions, and one of its news reports is at the top of the severity scale
// (a looking-back piece counts as 0, and analysis is left out). Then Jev is
// asked whether it is, as news, one of the events the scale's top names. In
// the two weeks to 2026-09-24 five stories qualified and none of them was:
// North Korea's missile test (0.13), the Houthis taking a Red Sea island (0.17),
// Russian strikes on infrastructure (0.23), Saudi Arabia closing a pipeline, and
// arrests over Haiti's 2021 assassination (0.04). On events that were, it gave
// 0.44 (Iran's 2024 missile attack on Israel) to 0.95 (a North Korean nuclear
// test), and 0.09 at most on big but ordinary news, hence CONFIRM_YES.
import webpush from 'web-push'
import { supabaseAdmin } from '../supabase'
import { callJev } from '../jev'
import { eventSeverity } from '../../signals'
import { VAPID_PUBLIC_KEY } from '../../vapid'
import { bump, type RunStats } from './stats'

const FRESH_HOURS = 12
const MIN_OUTLETS = 5
const MIN_REGIONS = 3
const TOP_SEVERITY = 0.84
const CONFIRM_YES = 0.4
/** Never two alerts within this, however much is happening: the first says enough. */
const SPACING_HOURS = 3

export const confirmQuestion = {
  confirm: {
    type: 'noul',
    instructions:
      'Does `story` report, as news from the past day, an event that changes the course of a war or of world affairs: a war between states starting or spreading to another state, a nuclear weapon used or tested, a state directly threatening nuclear use, a head of state or government killed or overthrown, or the forces of great powers clashing directly?',
    criteria: {
      true: {
        what: 'A new, world-changing event',
        examples: ['North Korea conducts its seventh nuclear test', 'Troops cross the border as one state declares war on another', 'President assassinated in the capital; the army takes power'],
      },
      false: {
        what: 'Anything less, or not new',
        examples: ['State tests a new ballistic missile', 'Deadly strikes continue in a war that is already under way', 'Leaders trade threats at the UN', 'Anniversary of the start of a war', 'Arrests over an assassination years ago'],
      },
    },
  },
}

export interface Member {
  story_id: string
  title: string
  summary: string | null
  source_name: string
  source_region: string
  source_lang: string
  published_at: string | null
  severity: number | null
  opinion: number | null
  retrospective: number | null
}

export interface Candidate {
  storyId: string
  outlets: number
  regions: number
  /** What the notification says: the gravest English report, else the gravest. */
  headline: string
  reports: Member[]
}

/** Stories that qualify for the Jev check, from their members' rows. */
export function candidates(members: Member[]): Candidate[] {
  const byStory = new Map<string, Member[]>()
  for (const m of members) byStory.set(m.story_id, [...(byStory.get(m.story_id) ?? []), m])
  const out: Candidate[] = []
  for (const [storyId, list] of byStory) {
    const outlets = new Set(list.map((m) => m.source_name)).size
    const regions = new Set(list.map((m) => m.source_region)).size
    const news = list.filter((m) => (m.opinion ?? 0) < 0.5)
    const top = Math.max(0, ...news.map((m) => eventSeverity(m) ?? 0))
    if (outlets < MIN_OUTLETS || regions < MIN_REGIONS || top < TOP_SEVERITY) continue
    const gravest = [...news].sort((a, b) => (eventSeverity(b) ?? 0) - (eventSeverity(a) ?? 0))
    const english = gravest.find((m) => m.source_lang === 'en')
    out.push({ storyId, outlets, regions, headline: (english ?? gravest[0]).title, reports: gravest.slice(0, 4) })
  }
  return out
}

export function payload(c: Pick<Candidate, 'storyId' | 'headline' | 'outlets'>): string {
  return JSON.stringify({
    title: 'WW3Watch',
    body: `${c.headline} (${c.outlets} outlets)`,
    url: `/?story=${c.storyId}`,
    tag: `alert-${c.storyId}`,
  })
}

async function send(c: Candidate): Promise<{ sent: number; failed: number }> {
  const key = process.env.VAPID_PRIVATE_KEY
  if (!key) return { sent: 0, failed: 0 }
  webpush.setVapidDetails('https://ww3watch.org', VAPID_PUBLIC_KEY, key)
  const { data, error } = await supabaseAdmin.from('push_subscriptions').select('endpoint, p256dh, auth, failures')
  if (error) throw new Error(error.message)
  let sent = 0
  let failed = 0
  const body = payload(c)
  for (const s of data ?? []) {
    try {
      // Urgent: it should wake the phone. An hour's TTL: an alarm that arrives
      // the next morning is news, not an alarm.
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: 'high' })
      sent++
      await supabaseAdmin.from('push_subscriptions').update({ last_sent_at: new Date().toISOString(), failures: 0 }).eq('endpoint', s.endpoint)
    } catch (err) {
      failed++
      const status = (err as { statusCode?: number }).statusCode
      // Gone (unsubscribed, uninstalled) or failing again and again: forget it.
      if (status === 404 || status === 410 || s.failures + 1 >= 5) await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      else await supabaseAdmin.from('push_subscriptions').update({ failures: s.failures + 1 }).eq('endpoint', s.endpoint)
    }
  }
  return { sent, failed }
}

export async function checkAlerts(stats: RunStats, deadlineMs: number, now = Date.now()): Promise<void> {
  try {
    const since = new Date(now - FRESH_HOURS * 3600_000).toISOString()
    const members: Member[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('articles')
        .select('story_id, title, summary, source_name, source_region, source_lang, published_at, severity, opinion, retrospective')
        .gte('published_at', since)
        .not('story_id', 'is', null)
        .order('published_at', { ascending: false })
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      members.push(...((data ?? []) as Member[]))
      if (!data || data.length < 1000) break
    }
    const found = candidates(members)
    if (!found.length) return
    const { data: done, error: e } = await supabaseAdmin
      .from('alerts')
      .select('story_id, created_at, status, outlets')
      .order('created_at', { ascending: false })
      .limit(500)
    if (e) throw new Error(e.message)
    const before = new Map((done ?? []).map((a) => [a.story_id, a]))
    const lastSent = (done ?? []).find((a) => a.status === 'sent')
    for (const c of found) {
      const prev = before.get(c.storyId)
      // A story Jev turned down is asked again only once its outlets have
      // doubled, an hour later at least: an event can turn out graver as the
      // reports come in, but it is not asked every run.
      if (prev && !(prev.status === 'declined' && c.outlets >= 2 * prev.outlets && now - Date.parse(prev.created_at) >= 3600_000)) continue
      const state = { story: { reports: c.reports.map((r) => ({ outlet: r.source_name, headline: r.title, summary: (r.summary ?? '').replace(/\s+/g, ' ').slice(0, 250) })) } }
      const { answers, inputTokens } = await callJev(state, confirmQuestion, deadlineMs)
      bump(stats, 'alerts_tokens', inputTokens)
      const p = typeof answers.confirm?.noul === 'number' ? answers.confirm.noul : 0
      const confirmed = p >= CONFIRM_YES
      const spaced = !!lastSent && now - Date.parse(lastSent.created_at) < SPACING_HOURS * 3600_000
      const status = !confirmed ? 'declined' : spaced ? 'spaced' : process.env.VAPID_PRIVATE_KEY ? 'sent' : 'no_key'
      // Recorded before sending: a run that dies mid-send never sends twice.
      const { data: row, error: saveError } = await supabaseAdmin
        .from('alerts')
        .upsert({ story_id: c.storyId, created_at: new Date(now).toISOString(), headline: c.headline, p_confirm: p, outlets: c.outlets, regions: c.regions, status }, { onConflict: 'story_id' })
        .select('id')
        .single()
      if (saveError) throw new Error(saveError.message)
      if (!confirmed) continue
      bump(stats, 'alerts_confirmed', 1)
      if (status !== 'sent') continue
      const result = await send(c)
      await supabaseAdmin.from('alerts').update({ sent: result.sent, failed: result.failed }).eq('id', row.id)
      bump(stats, 'alerts_sent', result.sent)
      break // one alert a run at most; the spacing holds the rest
    }
  } catch (err) {
    stats.alerts_error = String(err).slice(0, 200)
    console.error('[pipeline] alerts failed (non-fatal):', err)
  }
}
