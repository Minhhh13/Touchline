import { describe, expect, it } from 'vitest'
import { commentaryUpTo } from '../match/commentary'
import { pickFresh } from '../match/commentaryColour'
import { pickVariant } from '@game/logic/flavour'
import { matchPath } from '../match/epochs'
import { changedLive, getName, resultFeed } from './feeds'

const names = { home: 'HOM', away: 'AWA' }
const feeds = Array.from({ length: 24 }, (_, i) => resultFeed(i + 40))

describe('the commentary’s variety', () => {
  it('picks as pickVariant does on its own, and never twice from one match’s set', () => {
    const bank = ['a', 'b', 'c']
    for (const key of ['x', 'y', 'z', 'w']) expect(pickFresh(bank, key)).toBe(pickVariant(bank, key))
    const used = new Set<string>()
    const got = ['k1', 'k2', 'k3', 'k4'].map((k) => pickFresh(bank, k, used))
    expect(new Set(got.slice(0, 3)).size).toBe(3)
    expect(got[3]).toBeNull()
  })

  it('never says the same line twice in a match: no colour, no word on the mood, no line of play', () => {
    let colours = 0
    for (const feed of feeds) {
      const mpath = matchPath(feed)
      const lines = commentaryUpTo(feed, mpath, feed.lastMinute, names, getName, [])
      const seen = new Set<string>()
      for (const e of feed.events) {
        const line = lines.find((l) => l.minute === e.minute && l.kind !== 'play' && l.text.startsWith(e.text))
        if (!line) continue
        const colour = line.text.slice(e.text.length).replace(/^ HOM \d+-\d+ AWA\./, '').trim()
        if (!colour) continue
        colours++
        expect(seen.has(colour), `${feed.key}: "${colour}" again`).toBe(false)
        seen.add(colour)
      }
      const play = lines.filter((l) => l.kind === 'play').map((l) => l.text)
      expect(new Set(play).size, feed.key).toBe(play.length)
    }
    expect(colours).toBeGreaterThan(feeds.length * 4)
  })

  it('never rewrites a line already shown as the clock runs on, a live match with changes included', () => {
    const check = (feed: (typeof feeds)[number]) => {
      const mpath = matchPath(feed)
      const full = commentaryUpTo(feed, mpath, feed.lastMinute, names, getName, [])
      for (const m of [5, 23, 45, 61, 78, 88]) {
        const part = commentaryUpTo(feed, mpath, m, names, getName, [])
        expect(part.map((l) => l.text)).toEqual(full.filter((l) => l.minute <= m && l.kind !== 'board').map((l) => l.text).slice(0, part.length))
      }
    }
    for (const feed of feeds.slice(0, 8)) check(feed)
    for (let i = 0; i < 3; i++) check(changedLive(i).feed)
  })
})
