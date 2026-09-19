import { describe, it, expect } from 'vitest'
import {
  closeOpen, disabledSourcesIssue, fileOrComment, lowYieldIssue, lowYieldMarker, resolvedComment, LABELS,
} from './issues'
import { fakeGh } from './fake-gh'

const RUN = 'https://github.com/o/r/actions/runs/42'
const LABEL_CALL = ['label', 'create', 'feed-health', '--color', 'FBCA04', '--description', 'Feed sources needing re-curation', '--force']
const open = (n: number) => ({ stdout: JSON.stringify([{ number: n }]) })
const none = { stdout: '[]' }

const LOW = 'Zeta Times: 1 accepted / 140 rejected in 7d (0.7%)\nAlpha Wire: 0 accepted / 300 rejected in 7d (0.0%)'

describe('fileOrComment', () => {
  const issue = { label: LABELS.feedHealth, title: 'T', body: 'B' }

  it('creates the issue (after upserting the label) when none is open', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], none]])
    expect(await fileOrComment(gh, issue)).toEqual({ action: 'created', number: null })
    expect(calls).toEqual([
      LABEL_CALL,
      ['issue', 'list', '--label', 'feed-health', '--state', 'open', '--json', 'number'],
      ['issue', 'create', '--title', 'T', '--label', 'feed-health', '--body', 'B'],
    ])
  })

  it('comments on the open issue instead of creating a second one', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], open(7)]])
    expect(await fileOrComment(gh, issue)).toEqual({ action: 'commented', number: 7 })
    expect(calls[2]).toEqual(['issue', 'comment', '7', '--body', 'B'])
    expect(calls.some((c) => c[0] === 'issue' && c[1] === 'create')).toBe(false)
  })

  it('uses the newest open issue when several carry the label', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], { stdout: JSON.stringify([{ number: 9 }, { number: 7 }]) }]])
    await fileOrComment(gh, issue)
    expect(calls[2][2]).toBe('9')
  })

  it('tolerates a failing label upsert (bash: `|| true`)', async () => {
    const { gh } = fakeGh([[['label'], { code: 1, stderr: 'forbidden' }], [['issue', 'list'], none]])
    await expect(fileOrComment(gh, issue)).resolves.toMatchObject({ action: 'created' })
  })

  it('treats a failing lookup as "none open" and still files (bash: `2>/dev/null || echo ""`)', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], { code: 1, stderr: 'HTTP 502' }]])
    await expect(fileOrComment(gh, issue)).resolves.toMatchObject({ action: 'created' })
    expect(calls[2].slice(0, 2)).toEqual(['issue', 'create'])
  })

  it('throws when the create or the comment fails, so the step goes red', async () => {
    const a = fakeGh([[['issue', 'list'], none], [['issue', 'create'], { code: 1, stderr: 'boom' }]])
    await expect(fileOrComment(a.gh, issue)).rejects.toThrow(/gh issue create exited 1: boom/)
    const b = fakeGh([[['issue', 'list'], open(7)], [['issue', 'comment'], { code: 1, stderr: 'boom' }]])
    await expect(fileOrComment(b.gh, issue)).rejects.toThrow(/gh issue comment exited 1/)
  })
})

describe('disabled-sources issue', () => {
  it('has the exact title and body the workflow used', () => {
    const o = disabledSourcesIssue('Feed A\nFeed B', RUN)
    expect(o.title).toBe('Feed sources auto-disabled — re-curation needed')
    expect(o.body).toBe(
      `Auto-disabled after 200 consecutive failed fetches (run ${RUN}):\n\n- Feed A\n- Feed B\n\n` +
      'Fix the feed URL or leave it disabled; re-enable with SQL on the sources table.',
    )
    expect(o.label.name).toBe('feed-health')
    expect(o.search).toBeUndefined()
    expect(o.dedupeMarker).toBeUndefined()
  })

  it('comments every time while an issue is open (no dedupe)', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], open(3)]])
    const o = disabledSourcesIssue('Feed A', RUN)
    await fileOrComment(gh, o)
    expect(calls.map((c) => c.slice(0, 2).join(' '))).toEqual(['label create', 'issue list', 'issue comment'])
    expect(calls[2]).toEqual(['issue', 'comment', '3', '--body', o.body])
  })
})

describe('low-yield issue', () => {
  it('marker is the sorted names before the first colon, each followed by a comma', () => {
    expect(lowYieldMarker(LOW)).toBe('<!-- low-yield: Alpha Wire,Zeta Times, -->')
    expect(lowYieldMarker('Solo: 0 accepted')).toBe('<!-- low-yield: Solo, -->')
    // `sort` under C.UTF-8 is byte order: uppercase before lowercase, no locale folding
    expect(lowYieldMarker('b: x\nB: x\na: x')).toBe('<!-- low-yield: B,a,b, -->')
    // only the FIRST colon splits (`cut -d: -f1`)
    expect(lowYieldMarker('Name: 1 accepted: more')).toBe('<!-- low-yield: Name, -->')
  })

  it('marker ignores the counts and the input order, so a standing list is stable', () => {
    const later = 'Alpha Wire: 2 accepted / 410 rejected in 7d (0.5%)\nZeta Times: 1 accepted / 150 rejected in 7d (0.7%)'
    expect(lowYieldMarker(later)).toBe(lowYieldMarker(LOW))
  })

  it('has the exact title, body, search and marker the workflow used', () => {
    const o = lowYieldIssue(LOW)
    expect(o.title).toBe('Feed sources with low-yield — re-curation suggested')
    expect(o.search).toBe('low-yield in:title')
    expect(o.dedupeMarker).toBe('<!-- low-yield: Alpha Wire,Zeta Times, -->')
    expect(o.body).toBe(
      '<!-- low-yield: Alpha Wire,Zeta Times, -->\n' +
      'Fetching fine, but almost nothing accepted over the last 7 days (≥100 items, ≤2% accepted):\n\n' +
      '- Zeta Times: 1 accepted / 140 rejected in 7d (0.7%)\n- Alpha Wire: 0 accepted / 300 rejected in 7d (0.0%)\n\n' +
      "Swap the URL for the outlet's world/conflict section feed, or disable it, with SQL on the sources table.",
    )
  })

  it('creates when no low-yield issue is open, looking only at low-yield titles', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], none]])
    const o = lowYieldIssue(LOW)
    expect((await fileOrComment(gh, o)).action).toBe('created')
    expect(calls[1]).toEqual(['issue', 'list', '--label', 'feed-health', '--state', 'open', '--search', 'low-yield in:title', '--json', 'number'])
    expect(calls[2]).toEqual(['issue', 'create', '--title', o.title, '--label', 'feed-health', '--body', o.body])
  })

  it('stays silent when the marker is already in the issue BODY', async () => {
    const o = lowYieldIssue(LOW)
    const { gh, calls } = fakeGh([
      [['issue', 'list'], open(5)],
      [['issue', 'view'], { stdout: JSON.stringify({ body: o.body, comments: [] }) }],
    ])
    expect(await fileOrComment(gh, o)).toEqual({ action: 'unchanged', number: 5 })
    expect(calls[2]).toEqual(['issue', 'view', '5', '--json', 'body,comments'])
    expect(calls).toHaveLength(3) // label, list, view — no comment, no create
  })

  it('stays silent when the marker is in a later COMMENT', async () => {
    const o = lowYieldIssue(LOW)
    const { gh, calls } = fakeGh([
      [['issue', 'list'], open(5)],
      [['issue', 'view'], { stdout: JSON.stringify({ body: '<!-- low-yield: Old, -->\n…', comments: [{ body: 'human note' }, { body: o.body }] }) }],
    ])
    expect((await fileOrComment(gh, o)).action).toBe('unchanged')
    expect(calls.some((c) => c[1] === 'comment')).toBe(false)
  })

  it('comments when the list changed (marker is new)', async () => {
    const o = lowYieldIssue(LOW)
    const { gh, calls } = fakeGh([
      [['issue', 'list'], open(5)],
      // a SUBSET marker must not count as a match
      [['issue', 'view'], { stdout: JSON.stringify({ body: '<!-- low-yield: Alpha Wire, -->\nold', comments: [] }) }],
    ])
    expect(await fileOrComment(gh, o)).toEqual({ action: 'commented', number: 5 })
    expect(calls[3]).toEqual(['issue', 'comment', '5', '--body', o.body])
  })

  it('comments when the view fails — a redundant comment beats a dropped one (bash had no pipefail)', async () => {
    const o = lowYieldIssue(LOW)
    const { gh } = fakeGh([[['issue', 'list'], open(5)], [['issue', 'view'], { code: 1 }]])
    expect((await fileOrComment(gh, o)).action).toBe('commented')
  })
})

describe('closeOpen', () => {
  it('no-ops when nothing is open', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], none]])
    expect(await closeOpen(gh, { label: 'pipeline-failure', comment: 'c' })).toEqual({ closed: null })
    expect(calls).toEqual([['issue', 'list', '--label', 'pipeline-failure', '--state', 'open', '--json', 'number']])
  })

  it('closes the open issue as completed, with the comment', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], open(11)]])
    const comment = resolvedComment('Pipeline run succeeded', RUN)
    expect(comment).toBe(`Pipeline run succeeded: ${RUN}. Auto-closing issue.`)
    expect(await closeOpen(gh, { label: 'pipeline-failure', comment })).toEqual({ closed: 11 })
    expect(calls[1]).toEqual(['issue', 'close', '11', '--comment', comment, '--reason', 'completed'])
  })

  it('no-ops when the lookup fails (bash: `2>/dev/null || echo ""`) — the next green run retries', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], { code: 1 }]])
    expect(await closeOpen(gh, { label: 'pipeline-failure', comment: 'c' })).toEqual({ closed: null })
    expect(calls).toHaveLength(1)
  })

  it('never creates the label or an issue', async () => {
    const { gh, calls } = fakeGh([[['issue', 'list'], open(11)]])
    await closeOpen(gh, { label: 'prod-smoke-failure', comment: 'c' })
    expect(calls.some((c) => c[0] === 'label' || c[1] === 'create')).toBe(false)
  })
})
