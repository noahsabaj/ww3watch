import { describe, it, expect, vi } from 'vitest'
import { checkPhotosIsolated, parsePhotoStats, PHOTO_STATS_PREFIX } from './photo-check-isolated'
import type { RunStats } from './stats'

describe('parsePhotoStats', () => {
  it('reads the last stats line among the child’s log lines', () => {
    const out = `[pipeline] photo check: ok=3\n${PHOTO_STATS_PREFIX}{"photos_ok":3,"photos_reused":1}\n`
    expect(parsePhotoStats(out)).toEqual({ photos_ok: 3, photos_reused: 1 })
  })

  it('is null without a stats line, or with a cut-off one', () => {
    expect(parsePhotoStats('[pipeline] photo check: ok=3\n')).toBeNull()
    expect(parsePhotoStats(`${PHOTO_STATS_PREFIX}{"photos_ok":`)).toBeNull()
  })
})

describe('checkPhotosIsolated', () => {
  const node = (code: string) => ['-e', code]
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(console, 'error').mockImplementation(() => {})

  it('merges the child’s stats into the run', async () => {
    const stats: RunStats = { photos_ok: 0 }
    await checkPhotosIsolated(stats, Date.now() + 30_000, node(`console.log(${JSON.stringify(PHOTO_STATS_PREFIX)} + JSON.stringify({ photos_ok: 4, photos_emblem: 1 }))`))
    expect(stats).toMatchObject({ photos_ok: 4, photos_emblem: 1 })
    expect(stats.photos_error).toBeUndefined()
  })

  it('survives the child aborting natively and records why', async () => {
    const stats: RunStats = {}
    await checkPhotosIsolated(stats, Date.now() + 30_000, node('process.abort()'))
    expect(stats.photos_error).toMatch(/^photo check process exited /)
  })
})
