import { describe, expect, it } from 'vitest'
import { badgeStates } from '@engine/badges'
import { shareText, arenaShareText } from '@engine/awards'
import { dailyNudge, inviteFor, inviteKindOf, inviteLine, nextBadge, versusOf, oneMore, personalBests, SHARE_HOST, shareWithInvite, tidyShareText } from '@game/logic/shareInvite'
import { emptyCabinet } from '@game/logic/cabinet'

describe('the share text, emoji-light', () => {
  it('keeps the form blocks and the result icon, words the labels and drops flags and other pictures', () => {
    const text = shareText({
      teamName: 'Ashvale Rovers',
      tier: 'CHAMPIONS',
      row: { won: 3, drawn: 1, lost: 1, points: 10 } as never,
      position: 1,
      cupWon: false,
      continentalWon: false,
      leagueSeason: 2018,
      hostClubName: '',
      mode: 'Quick Draft',
      bootName: 'Haaland',
      bootGoals: 31,
      potsName: 'K. De Bruyne',
      extraLines: ['One nation: 🇧🇷 Brazil', '📜 3rd-best points total in PL history', '⚔️ Beat Minh by 4 points: 90 to 86'],
      seed: 'K7Q2-MX9A',
    }, 'TouchLine')
    expect(tidyShareText(text).split('\n')).toEqual([
      'TouchLine · Quick Draft',
      'Ashvale Rovers, 2018-19',
      'Champions',
      '3-1-1 · 10 pts · 1st',
      '🟩🟩🟩🟨🟥',
      'Top scorer: Haaland 31',
      'Player of the season: K. De Bruyne',
      'One nation: Brazil',
      '3rd-best points total in PL history',
      'Beat Minh by 4 points: 90 to 86',
      'Seed K7Q2-MX9A',
    ])
  })

  it('keeps an arena banner icon and the Gauntlet strip, and a named label keeps only its words', () => {
    const final = arenaShareText({ mode: 'Cup Final', teamName: 'Touchline XI', formationName: '4-3-3', wheel: 'Premier League wheel', banner: 'WINNERS', icon: '🏆', steps: [{ code: 'F', gf: 1, ga: 1, opponent: 'Manchester City 2017-18', pens: { us: 4, them: 3 } }], motm: 'K. De Bruyne', seed: 'K7Q2-MX9A' })
    expect(tidyShareText(final).split('\n')).toEqual(['TouchLine · Cup Final', 'Touchline XI · 4-3-3 · Premier League wheel', '🏆 WINNERS', 'F 🟨 1-1 Manchester City 2017-18 (4-3 pens)', 'MOTM: K. De Bruyne', 'Seed K7Q2-MX9A'])
    const ladder = arenaShareText({ mode: 'The Gauntlet', teamName: 'Touchline XI', formationName: '4-3-3', wheel: 'Premier League wheel', banner: '7 RUNGS', icon: '🪜', steps: [], strip: '🟩🟩🟨🟥', lines: ['⚽ Haaland 6 · ⭐ De Bruyne'] })
    expect(tidyShareText(ladder).split('\n').slice(2)).toEqual(['🪜 7 RUNGS', '🟩🟩🟨🟥', 'Top scorer: Haaland 6 · Star: De Bruyne'])
  })

  it("keeps a run-in's verdict icon but not its real-club line's", () => {
    expect(tidyShareText(['TouchLine · Run-in · Everton 2018-19', '✅ SURVIVED · 16th on 38', '📊 The real Everton went down on 35', '🏆 Won by Chelsea'].join('\n')).split('\n')).toEqual(['TouchLine · Run-in · Everton 2018-19', '✅ SURVIVED · 16th on 38', 'The real Everton went down on 35', 'Won by Chelsea'])
  })

  it('ends with the invitation, the link when there is one', () => {
    const invite = inviteFor('quick', { points: 90 })
    expect(invite).toEqual({ title: 'Beat my draft', line: 'Same spins, same wheel. Beat 90 points.', where: SHARE_HOST })
    expect(inviteLine(invite)).toBe(`Beat my draft: ${SHARE_HOST}`)
    expect(shareWithInvite('TouchLine · Quick Draft', invite, 'https://touchline.quest/#s=ABCD2345').split('\n')).toEqual(['TouchLine · Quick Draft', 'Beat my draft: https://touchline.quest/#s=ABCD2345'])
    expect(inviteFor('daily', { points: 1, code: 'ABCD2345' })).toEqual({ title: "Beat today's Daily", line: 'One wheel for everyone today. Beat 1 point.', where: `${SHARE_HOST} · code ABCD2345` })
    expect(inviteFor('gauntlet', { rungs: 7 }).line).toBe('Same ladder. Climb past rung 7.')
    expect(inviteFor('runin', { position: 12 }).line).toBe('Ten games to go. Finish above 12th.')
    for (const kind of ['weekly', 'season', 'dynasty', 'final', 'cup', 'h2h'] as const) expect(inviteFor(kind).title.length).toBeGreaterThan(0)
  })
})

describe("Home's comeback facts", () => {
  const today = 'daily-2026-10-28'
  const yesterday = 'daily-2026-10-27'
  it('words the Daily: played today, a streak that ends tonight, or a fresh puzzle', () => {
    expect(dailyNudge({ dailyStreak: 4, lastDailyDate: today, dailyResults: { [today]: { points: 80, tier: 'CHAMPIONS' } } }, today, yesterday)).toEqual({ kind: 'played', points: 80, streak: 4 })
    expect(dailyNudge({ dailyStreak: 4, lastDailyDate: yesterday, dailyResults: {} }, today, yesterday)).toEqual({ kind: 'atRisk', streak: 4 })
    expect(dailyNudge({ dailyStreak: 4, lastDailyDate: 'daily-2026-10-20', dailyResults: {} }, today, yesterday)).toEqual({ kind: 'fresh' })
    expect(dailyNudge({ dailyStreak: 0, lastDailyDate: null, dailyResults: {} }, today, yesterday)).toEqual({ kind: 'fresh' })
  })

  it('lists personal bests only once there are some', () => {
    expect(personalBests({})).toEqual([])
    const cabinet = emptyCabinet()
    cabinet.gauntlet.best = 9
    expect(personalBests({ quickBests: { bestRecord: { won: 31, drawn: 4, lost: 3, points: 97, games: 38 }, longestPerfectRun: 12 }, cabinet, weekly: { streak: 3, last: null, results: {} } })).toEqual([
      { id: 'record', won: 31, drawn: 4, lost: 3 },
      { id: 'perfectRun', n: 12 },
      { id: 'gauntlet', n: 9 },
    ])
  })

  it('picks the badge nearest its next tier, a started one first', () => {
    const cabinet = emptyCabinet()
    expect(nextBadge(badgeStates(cabinet, { leaguesWon: 0 }))?.state.badge.id).toBe('serial-winner')
    cabinet.dailies = 5
    cabinet.league = 1
    const n = nextBadge(badgeStates(cabinet, { leaguesWon: 1 }))
    expect(n?.state.badge.id).toBe('regular')
    expect(n).toMatchObject({ target: 7, tier: 'bronze', left: 2 })
  })

  it('reads a quick season against the best record', () => {
    const best = { won: 31, drawn: 4, lost: 3, points: 97, games: 38 }
    expect(oneMore(undefined, { won: 20, lost: 5 })).toBeNull()
    expect(oneMore(best, { won: 31, lost: 3 })).toEqual({ kind: 'best' })
    expect(oneMore(best, { won: 28, lost: 4 })).toEqual({ kind: 'short', wins: 3 })
    expect(oneMore(best, { won: 31, lost: 5 })).toEqual({ kind: 'moreDefeats' })
  })
})

describe('the invitation of a finished game', () => {
  const settings = (over: Record<string, unknown>) => ({ settings: { mode: 'quick', seed: 'K7Q2-MX9A', ...over } }) as never
  it('follows the mode, and the format in the arena', () => {
    expect(inviteKindOf(settings({}))).toBe('quick')
    expect(inviteKindOf(settings({ seed: 'weekly-2026-W44' }))).toBe('weekly')
    expect(inviteKindOf(settings({ mode: 'daily' }))).toBe('daily')
    expect(inviteKindOf(settings({ mode: 'dynasty' }))).toBe('dynasty')
    expect(inviteKindOf(settings({ mode: 'runin' }))).toBe('runin')
    expect(inviteKindOf(settings({ mode: 'arena', arena: { format: 'cup' } }))).toBe('final')
    expect(inviteKindOf(settings({ mode: 'arena', arena: { format: 'cup', size: 16 } }))).toBe('cup')
    expect(inviteKindOf(settings({ mode: 'arena', arena: { format: 'gauntlet' } }))).toBe('gauntlet')
  })

  it('decides a head-to-head on points, then fewer defeats', () => {
    expect(versusOf('Minh', { pts: 90, l: 4 }, { pts: 86, l: 2 })).toEqual({ name: 'Minh', mine: 90, theirs: 86, won: true })
    expect(versusOf('Minh', { pts: 80, l: 4 }, { pts: 86, l: 2 }).won).toBe(false)
    expect(versusOf('Minh', { pts: 86, l: 2 }, { pts: 86, l: 3 }).won).toBe(true)
    expect(versusOf('Minh', { pts: 86, l: 3 }, { pts: 86, l: 3 }).won).toBeNull()
  })
})
