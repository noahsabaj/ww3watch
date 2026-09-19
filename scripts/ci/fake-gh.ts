// Test double for the `Gh` runner: records every argv and answers from a list
// of [argv-prefix, reply] routes. An unrouted call exits 0 with no output.
// Asserting on `calls` is the point — the merged-PR bug was a wrong argv.

import type { Gh, GhResult } from './gh'

type Reply = Partial<GhResult> | ((args: string[]) => Partial<GhResult>)

export function fakeGh(routes: Array<[prefix: string[], reply: Reply]> = []): { gh: Gh; calls: string[][] } {
  const calls: string[][] = []
  const gh: Gh = async (args) => {
    calls.push(args)
    const route = routes.find(([prefix]) => prefix.every((p, i) => args[i] === p))
    const reply = route ? (typeof route[1] === 'function' ? route[1](args) : route[1]) : {}
    return { stdout: '', stderr: '', code: 0, ...reply }
  }
  return { gh, calls }
}
