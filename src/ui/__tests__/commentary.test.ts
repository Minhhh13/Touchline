import { describe, expect, it } from 'vitest'
import { boardText, changeText, commentaryUpTo, KIND_WEIGHT, latestLine, type CommentaryLine } from '../match/commentary'
import { matchPath } from '../match/epochs'
import { changedLive, getName, resultFeed } from './feeds'

const names = { home: 'HOM', away: 'AWA' }

describe('commentary', () => {
  it('has a line for every key event at its minute, goals with the score, and a line of play for every quiet minute', () => {
    for (let i = 0; i < 8; i++) {
      const feed = resultFeed(i)
      const mpath = matchPath(feed)
      const lines = commentaryUpTo(feed, mpath, feed.lastMinute, names, getName, [])
      for (const e of feed.events.filter((x) => ['goal', 'penalty', 'own_goal', 'yellow', 'red', 'substitution', 'injury', 'chance', 'save'].includes(x.type))) {
        expect(lines.some((l) => l.minute === e.minute && l.text.startsWith(e.text))).toBe(true)
      }
      const goals = lines.filter((l) => l.kind === 'goal')
      expect(goals).toHaveLength(feed.events.filter((e) => ['goal', 'penalty', 'own_goal'].includes(e.type)).length)
      if (goals.length) expect(goals[goals.length - 1].text).toContain(`HOM ${feed.events.filter((e) => ['goal', 'penalty', 'own_goal'].includes(e.type) && e.side === 'home').length}-`)
      // One line of play per quiet minute, never in a minute with an event
      const eventMinutes = new Set([...feed.events.filter((e) => e.type !== 'kickoff').map((e) => e.minute), ...lines.filter((l) => l.kind === 'change').map((l) => l.minute)])
      const play = lines.filter((l) => l.kind === 'play')
      for (const l of play) expect(eventMinutes.has(l.minute)).toBe(false)
      for (let m = 1; m <= 90; m++) if (!eventMinutes.has(m)) expect(play.filter((l) => l.minute === m)).toHaveLength(1)
      for (let k = 1; k < lines.length; k++) expect(lines[k].minute).toBeGreaterThanOrEqual(lines[k - 1].minute)
      expect(lines[0].text).toBe('Kick-off.')
      expect(lines[lines.length - 1].text.startsWith('Full time')).toBe(true)
      // The board at 90, with the added time in words
      expect(lines.find((l) => l.kind === 'board')).toMatchObject({ minute: 90, text: boardText(feed.addedTime) })
      // Nothing beyond the clock
      expect(commentaryUpTo(feed, mpath, 30, names, getName, []).every((l) => l.minute <= 30)).toBe(true)
      expect(commentaryUpTo(feed, mpath, 89, names, getName, []).some((l) => l.kind === 'board')).toBe(false)
    }
  })

  it('reads the same on every run, names the changes and the goals elsewhere', () => {
    const { feed } = changedLive(2)
    const mpath = matchPath(feed)
    const elsewhere = [{ minute: 23, text: 'Elsewhere: Arsenal 1-0 Spurs, Saka 23’.' }]
    const a = commentaryUpTo(feed, mpath, feed.lastMinute, names, getName, elsewhere)
    expect(commentaryUpTo(feed, matchPath(feed), feed.lastMinute, names, getName, elsewhere)).toEqual(a)
    expect(a.find((l) => l.kind === 'elsewhere')).toMatchObject({ minute: 23, text: elsewhere[0].text })
    const changes = a.filter((l) => l.kind === 'change' && l.side === 'home')
    expect(changes.find((l) => l.minute === 30)?.text).toMatch(/^HOM (go attacking|sit back)( and stretch the play)?\.$/)
    expect(changes.find((l) => l.minute === 75)?.text).toMatch(/^HOM (push the line up|drop the line deep)\.$/)
    expect(changeText({ minute: 70, side: 'away', by: 'manager', shout: 'shut-up-shop' }, 'AWA')).toBe('AWA on the touchline: shut up shop.')
    expect(changeText({ minute: 50, side: 'away', by: 'manager', subs: 1 }, 'AWA')).toBeNull()
    expect(boardText(1)).toBe('The fourth official holds up the board: one minute of added time.')
    expect(boardText(4)).toBe('The fourth official holds up the board: four minutes of added time.')
  })

  it('the banner takes the latest minute’s most important line', () => {
    const line = (minute: number, kind: CommentaryLine['kind'], text = kind): CommentaryLine => ({ minute, kind, text, weight: KIND_WEIGHT[kind] })
    expect(latestLine([])).toBeNull()
    expect(latestLine([line(10, 'goal'), line(11, 'play')])?.kind).toBe('play')
    expect(latestLine([line(11, 'play'), line(11, 'chance'), line(11, 'card'), line(11, 'sub')])?.kind).toBe('card')
    expect(latestLine([line(40, 'elsewhere'), line(40, 'change'), line(40, 'injury'), line(40, 'goal'), line(40, 'board')])?.kind).toBe('goal')
    expect(latestLine([line(90, 'board'), line(90, 'play')])?.kind).toBe('board')
    const order: CommentaryLine['kind'][] = ['goal', 'card', 'injury', 'sub', 'change', 'elsewhere', 'chance', 'board', 'play']
    for (let k = 1; k < order.length; k++) expect(KIND_WEIGHT[order[k - 1]]).toBeGreaterThan(KIND_WEIGHT[order[k]])
  })
})
