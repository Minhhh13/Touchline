import { describe, expect, it } from 'vitest'
import type { MatchEvent } from '@engine/types'
import { assistantSubsBetween, assistantSubText, assistantSubToast, isAssistantSub } from '../match/assistantSubs'
import { commentaryUpTo } from '../match/commentary'
import { matchPath } from '../match/epochs'
import { changedLive, getName } from './feeds'

const names = { home: 'HOM', away: 'AWA' }

describe('the assistant’s own changes', () => {
  it('tells the engine’s routine and injury changes from the manager’s, and words only the user’s side', () => {
    let routine = 0
    for (let i = 0; i < 8; i++) {
      const { feed, subOn } = changedLive(i)
      const mpath = matchPath(feed)
      const plain = commentaryUpTo(feed, mpath, feed.lastMinute, names, getName, [])
      const ours = commentaryUpTo(feed, mpath, feed.lastMinute, names, getName, [], { userSide: 'home' })
      for (const e of feed.events.filter((x) => x.type === 'substitution')) {
        const sub = feed[e.side].subs.find((s) => s.off === e.playerId && s.on === e.secondaryId)!
        const mine = isAssistantSub(e, feed.home.subs, 'home')
        // The manager's change at 30 is his own; every change the engine made for the home side is the assistant's
        if (e.secondaryId === subOn && e.side === 'home') expect(mine).toBe(false)
        expect(mine).toBe(e.side === 'home' && ['tired', 'tactical', 'injury'].includes(sub.reason))
        const line = ours.find((l) => l.kind === 'sub' && l.minute === e.minute && l.side === e.side && l.text.includes(e.secondaryName ?? '?'))!
        if (mine) {
          routine++
          expect(line.text.startsWith(assistantSubText(e))).toBe(true)
        } else expect(line.text.startsWith(e.text)).toBe(true)
        // Without a user side the line is the event's own
        expect(plain.some((l) => l.kind === 'sub' && l.minute === e.minute && l.text.startsWith(e.text))).toBe(true)
      }
      // Only the wording moves: the same lines at the same minutes
      expect(ours.map((l) => [l.minute, l.kind])).toEqual(plain.map((l) => [l.minute, l.kind]))
      expect(assistantSubsBetween(feed, 'home', 0, feed.lastMinute).length).toBe(feed.events.filter((e) => isAssistantSub(e, feed.home.subs, 'home')).length)
      expect(assistantSubsBetween(feed, 'home', 45, 70).every((e) => e.minute > 45 && e.minute <= 70)).toBe(true)
    }
    expect(routine).toBeGreaterThan(0)
  })

  it('words the line and the toast', () => {
    const e = (on: string, off: string, text: string): MatchEvent => ({ minute: 60, type: 'substitution', side: 'away', playerId: 'a', playerName: off, secondaryId: 'b', secondaryName: on, text })
    const tired = e('F. Wirtz', 'A. Mac Allister', 'F. Wirtz comes on for A. Mac Allister.')
    const hurt = e('G. Mamardashvili', 'Alisson', 'G. Mamardashvili replaces the injured Alisson.')
    expect(assistantSubText(tired)).toBe('Your assistant brings on F. Wirtz for A. Mac Allister.')
    expect(assistantSubText(hurt)).toBe('Your assistant brings on G. Mamardashvili for the injured Alisson.')
    expect(assistantSubToast([])).toBeNull()
    expect(assistantSubToast([tired])).toBe('Your assistant brings on F. Wirtz for A. Mac Allister')
    expect(assistantSubToast([tired, hurt])).toBe('Your assistant makes 2 changes: F. Wirtz for A. Mac Allister, G. Mamardashvili for Alisson')
    // A change with no matching routine substitution is never the assistant's
    expect(isAssistantSub(tired, [{ minute: 60, off: 'a', on: 'b', reason: 'manager' }], 'away')).toBe(false)
    expect(isAssistantSub(tired, [{ minute: 60, off: 'a', on: 'b', reason: 'tired' }], 'away')).toBe(true)
    expect(isAssistantSub(tired, [{ minute: 60, off: 'a', on: 'b', reason: 'tired' }], 'home')).toBe(false)
  })
})
