import { describe, expect, it } from 'vitest'
import { devicePosts, postLabel, postLine, sentence } from '../postText'

describe('the words for a device\'s ranked posts', () => {
  it('ends a reason with one full stop', () => {
    expect(sentence('it was played on engine 4')).toBe('it was played on engine 4.')
    expect(sentence('Done. ')).toBe('Done.')
  })

  it('names each board and says what happened, newest first, chase runs last', () => {
    expect(postLabel('daily:2026-10-25')).toBe('Daily 2026-10-25')
    expect(postLabel('weekly:2026-W43')).toBe('Weekly 2026-W43')
    expect(postLabel('chase:K7Q2MX9A3B')).toBe('38-0 chase K7Q2MX9A3B')
    expect(postLabel('nonsense')).toBeNull()
    const list = devicePosts(
      {
        'daily:2026-10-20': { state: 'closed' },
        'chase:K7Q2MX9A3B': { state: 'waiting', reason: 'retry', points: 90 },
        'daily:2026-10-26': { state: 'unranked', code: 'engine_mismatch', reason: 'it was played on an earlier version of the game (engine 4) and the board runs on engine 5' },
        'weekly:2026-W43': { state: 'posted', position: 2, total: 1200, points: 80, claimMatched: true, already: false },
        'weird:x': { state: 'closed' },
      },
      true,
    )
    expect(list.map((p) => p.key)).toEqual(['daily:2026-10-26', 'daily:2026-10-20', 'weekly:2026-W43', 'chase:K7Q2MX9A3B'])
    expect(list[0]).toMatchObject({ tone: 'bad', line: 'Unranked: it was played on an earlier version of the game (engine 4) and the board runs on engine 5.' })
    expect(list[2].line).toBe(`Posted 80 pts: 2nd of ${(1200).toLocaleString()}.`)
    expect(list[1]).toMatchObject({ tone: 'muted' })
    expect(list[3].line).toBe('Waiting to post 90 pts: the server did not answer, so this device tries again shortly.')
    expect(postLine({ state: 'waiting', reason: 'sign_in', points: 71 }, false).line).toBe('Sign in to post 71 pts to the board.')
    expect(postLine({ state: 'posted', position: 11, total: 13, points: 1, claimMatched: true, already: false }, true).line).toContain('11th of 13')
    expect(postLine({ state: 'posted', position: 22, total: 30, points: 1, claimMatched: true, already: false }, true).line).toContain('22nd')
  })
})
