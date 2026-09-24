import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { MAJOR_SEVERITY } from './signals'

// MAJOR_SEVERITY has to exist in two runtimes: here (Node + browser) and as a
// literal in the actor_daily SQL function. Nothing can share the constant, so
// this test is what keeps the copies equal: change one and it fails until both
// agree.
describe('MAJOR_SEVERITY across runtimes', () => {
  it('matches the latest actor_daily definition in the migrations', () => {
    const dir = 'supabase/migrations'
    const defs = readdirSync(dir)
      .sort()
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
      .flatMap((sql) => [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.actor_daily[\s\S]*?\$\$;/gi)].map((x) => x[0]))
    expect(defs.length, 'no actor_daily definition found in supabase/migrations').toBeGreaterThan(0)
    const m = defs[defs.length - 1].match(/severity >= \(?([0-9.]+)/)
    expect(m, 'actor_daily no longer compares severity with a literal').not.toBeNull()
    expect(Number(m![1])).toBe(MAJOR_SEVERITY)
  })
})

describe('image.ts across runtimes', () => {
  it('is copied verbatim into the Deno reader', () => {
    const node = readFileSync('src/lib/server/image.ts', 'utf8')
    const deno = readFileSync('supabase/functions/_shared/image.ts', 'utf8')
    expect(deno).toBe(node)
  })
})
