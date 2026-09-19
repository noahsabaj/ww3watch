import { describe, it, expect } from 'vitest'
import { ensureBotPr } from './bot-pr'
import type { Gh } from './gh'

type Pr = { number: number; head: string; state: 'OPEN' | 'MERGED' | 'CLOSED' }

// A small model of GitHub's PR lookup semantics, including the trap: `pr view
// <branch>` resolves to the most recent PR for the branch in ANY state, while
// `pr list` honours --state. Code that reaches for `pr view` gets the merged PR
// back here exactly as it did in production, and the tests below fail.
function github(prs: Pr[]): { gh: Gh; calls: string[][] } {
  const calls: string[][] = []
  const flag = (args: string[], name: string) => {
    const i = args.indexOf(name)
    return i === -1 ? undefined : args[i + 1]
  }
  const gh: Gh = async (args) => {
    calls.push(args)
    const ok = (stdout = '') => ({ stdout, stderr: '', code: 0 })
    if (args[0] === 'pr' && args[1] === 'list') {
      const state = (flag(args, '--state') ?? 'open').toUpperCase()
      const rows = prs
        .filter((p) => p.head === flag(args, '--head') && (state === 'ALL' || p.state === state))
        .sort((a, b) => b.number - a.number)
        .map((p) => ({ number: p.number }))
      return ok(JSON.stringify(rows))
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const hit = prs.filter((p) => p.head === args[2]).sort((a, b) => b.number - a.number)[0]
      return hit ? ok(JSON.stringify({ number: hit.number })) : { stdout: '', stderr: 'no pull requests found', code: 1 }
    }
    return ok()
  }
  return { gh, calls }
}

const opts = { branch: 'retrain-head', title: 'chore: retrain relevance head', body: '## Relevance head\n\n| metric | value |' }

describe('ensureBotPr', () => {
  it('looks up OPEN PRs only, by head branch', async () => {
    const { gh, calls } = github([])
    await ensureBotPr(gh, opts)
    expect(calls[0]).toEqual(['pr', 'list', '--head', 'retrain-head', '--state', 'open', '--json', 'number'])
    expect(calls.some((c) => c[1] === 'view')).toBe(false)
  })

  it('reuses an OPEN PR: edits its body, creates nothing', async () => {
    const { gh, calls } = github([{ number: 91, head: 'retrain-head', state: 'OPEN' }])
    const result = await ensureBotPr(gh, opts)
    expect(result).toEqual({ action: 'edited', number: 91 })
    expect(calls.slice(1)).toEqual([['pr', 'edit', '91', '--body', opts.body]])
  })

  it('creates a new PR when the only PR for the branch is MERGED', async () => {
    const { gh, calls } = github([{ number: 88, head: 'retrain-head', state: 'MERGED' }])
    const result = await ensureBotPr(gh, opts)
    expect(result.action).toBe('created')
    expect(calls.slice(1)).toEqual([
      ['pr', 'create', '--base', 'main', '--head', 'retrain-head', '--title', opts.title, '--body', opts.body],
    ])
    expect(calls.some((c) => c.includes('88'))).toBe(false) // the merged PR is never touched
  })

  it('edits the OPEN PR, not a newer-numbered CLOSED or older MERGED one', async () => {
    const { gh, calls } = github([
      { number: 88, head: 'retrain-head', state: 'MERGED' },
      { number: 91, head: 'retrain-head', state: 'OPEN' },
      { number: 95, head: 'retrain-head', state: 'CLOSED' },
    ])
    await ensureBotPr(gh, opts)
    expect(calls[1]).toEqual(['pr', 'edit', '91', '--body', opts.body])
  })

  it('creates when there is no PR at all', async () => {
    const { gh, calls } = github([{ number: 12, head: 'some-other-branch', state: 'OPEN' }])
    const result = await ensureBotPr(gh, opts)
    expect(result).toEqual({ action: 'created', number: null })
    expect(calls).toHaveLength(2)
    expect(calls[1].slice(0, 2)).toEqual(['pr', 'create'])
  })

  it("ifOpen: 'leave' (backup.yml) neither edits nor creates when one is open", async () => {
    const { gh, calls } = github([{ number: 70, head: 'sources-backup', state: 'OPEN' }])
    const result = await ensureBotPr(gh, { ...opts, branch: 'sources-backup', ifOpen: 'leave' })
    expect(result).toEqual({ action: 'left', number: 70 })
    expect(calls).toHaveLength(1)
  })

  it("ifOpen: 'leave' still creates when only a MERGED PR exists", async () => {
    const { gh, calls } = github([{ number: 70, head: 'sources-backup', state: 'MERGED' }])
    await ensureBotPr(gh, { ...opts, branch: 'sources-backup', ifOpen: 'leave' })
    expect(calls[1].slice(0, 6)).toEqual(['pr', 'create', '--base', 'main', '--head', 'sources-backup'])
  })

  it('passes a multi-line body with shell metacharacters through as ONE argv element', async () => {
    const body = 'line 1\n`code` "$HOME" $(rm -rf /) \'quoted\'\n| a | b |'
    const { gh, calls } = github([])
    await ensureBotPr(gh, { ...opts, body })
    expect(calls[1][calls[1].indexOf('--body') + 1]).toBe(body)
  })

  it('throws — and creates nothing — when the lookup itself fails', async () => {
    const calls: string[][] = []
    const gh: Gh = async (args) => {
      calls.push(args)
      return { stdout: '', stderr: 'HTTP 502', code: 1 }
    }
    await expect(ensureBotPr(gh, opts)).rejects.toThrow(/gh pr list exited 1: HTTP 502/)
    expect(calls).toHaveLength(1)
  })

  it('throws when the create fails, so the step goes red', async () => {
    const gh: Gh = async (args) =>
      args[1] === 'list' ? { stdout: '[]', stderr: '', code: 0 } : { stdout: '', stderr: 'GraphQL: nope', code: 1 }
    await expect(ensureBotPr(gh, opts)).rejects.toThrow(/gh pr create exited 1/)
  })
})
