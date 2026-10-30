/**
 * Content depth round 2 (r13): the new wordings are reached. Every line of the story catalogue that has wordings
 * (`stem_0`, `stem_1`…) comes out in every wording over a few hundred keys, through the function a screen calls; the
 * inbox's new banks (a high-scoring win, a thrilling draw, a ban) and the pundit's hundred points are reached; the
 * digest's mood reads its stretch; the commentary's new moods come from the score and the clock. Display only, no RNG.
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { USER_TEAM } from '@engine/season'
import type { NewsItem } from '@engine/season'
import { newsBody, RED_CARD_BODIES, RESULT_BODIES, ROUTINE_BODIES, STOCK_BODIES } from '@game/logic/newsFlavour'
import { punditVerdict, STAT_LINES, type VerdictInput } from '@game/logic/pundit'
import { fillTemplate } from '@game/logic/flavour'
import type { MatchPreview, Stake, Storyline, SummerHeadline, SummerReview } from '@game/logic/storylines'
import { formLine, LONG_RUN, previewLines, stakeLine, storylineText, summerText, variantsOf, variantStems } from '../storyText'
import { digestMood, digestWording, DIGEST_MOOD_WORDINGS } from '../seasonDrama'
import { MOOD_LINES, moodLine } from '../match/commentaryColour'
import { app } from '../i18n/en/app'
import { setLocaleMessages } from '../i18n'
import { PSEUDO_LOCALE } from '../i18n/pseudo'
import { logicLine } from '../i18n/logicText'

const u = loadTestUniverse(['england'])
const KEYS = Array.from({ length: 400 }, (_, i) => `r13-${i}`)
const club = u.clubSeasons[0].clubId
const rival = u.clubSeasons[1].clubId

describe('the story catalogue’s wordings', () => {
  const reached = new Set<string>()
  /** Every wording of `stem` comes out of `f` over the keys (the same facts, so each wording reads differently). */
  function every(stem: string, f: (key: string) => string) {
    const want = variantsOf(stem).length
    expect(want, stem).toBeGreaterThan(1)
    expect(new Set(KEYS.map(f)).size, stem).toBe(want)
    reached.add(stem)
  }

  it('says every form line in every wording', () => {
    const W = 'W' as const
    const L = 'L' as const
    const D = 'D' as const
    every('theirsHot', (k) => formLine([D, D], [W, W, W, W, D], 'ARS', k))
    every('oursPerfect', (k) => formLine([W, W, W, W, W], [D, D], 'ARS', k))
    every('oursHot', (k) => formLine([W, W, W, W, D], [D, D], 'ARS', k))
    every('theirsCold', (k) => formLine([D, D], [L, L, L, D, D], 'ARS', k))
    every('oursCold', (k) => formLine([L, L, L, D], [D, W], 'ARS', k))
    every('theirsUnbeaten', (k) => formLine([D, L], [D, D, W], 'ARS', k))
    every('oursUnbeaten', (k) => formLine([D, D, W], [L, W], 'ARS', k))
    every('formEven', (k) => formLine([D, L], [W, L], 'ARS', k))
  })

  it('says every stake in every wording', () => {
    const say = (s: Stake) => (k: string) => stakeLine(s, 'ARS', k, u, 'Test XI')
    every('deciderAhead', say({ kind: 'title-decider', gap: 2 }))
    every('deciderBehind', say({ kind: 'title-decider', gap: -2 }))
    every('deciderLevel', say({ kind: 'title-decider', gap: 0 }))
    every('topClear', say({ kind: 'title', gap: 3, leaderId: USER_TEAM }))
    every('topOnGd', say({ kind: 'title', gap: 0, leaderId: USER_TEAM }))
    every('chasing', say({ kind: 'title', gap: -3, leaderId: club }))
    every('topFour', say({ kind: 'europe', gap: 1 }))
    every('offTopFour', say({ kind: 'europe', gap: -1 }))
    every('sixPointer', say({ kind: 'six-pointer', gap: 0 }))
    every('aboveDrop', say({ kind: 'survival', gap: 2 }))
    every('inDrop', say({ kind: 'survival', gap: -2 }))
    every('levelDrop', say({ kind: 'survival', gap: 0 }))
    every('leapLevel', say({ kind: 'leapfrog', gap: 0 }))
    every('leapBehind', say({ kind: 'leapfrog', gap: -2 }))
    every('final', say({ kind: 'final' }))
    every('semi', say({ kind: 'semi' }))
    every('knockout', say({ kind: 'knockout', round: 'QF' }))
    every('stakeGroup', say({ kind: 'group', group: 'B' }))
    every('stakeFirstLeg', say({ kind: 'first-leg', round: 'SF' }))
  })

  it('says every preview line in every wording', () => {
    const base: MatchPreview = { comp: 'league', opponentId: rival, home: true, matchweek: 10, form: { ours: [], theirs: [] }, meetings: [], stake: null, watch: {}, derby: null, oldBoys: [] }
    const line = (p: Partial<MatchPreview>, id: string) => (k: string) => previewLines({ ...base, ...p }, u, 'Test XI', k).find((l) => l.id === id)!.text
    const watch = { playerId: 'x', name: 'A. Striker', goals: 9, assists: 2, apps: 12, overall: 84, form: 7.6 }
    every('derbyNamed', line({ derby: { kind: 'named', name: 'North London derby' } }, 'derby'))
    every('derbyCity', line({ derby: { kind: 'city', city: 'Manchester' } }, 'derby'))
    every('rivalry', line({ derby: { kind: 'rival' } }, 'derby'))
    every('firstMeeting', line({}, 'meetings'))
    every('watchGoals', line({ watch: { theirs: { ...watch, why: 'goals' } } }, 'watch-theirs'))
    every('watchForm', line({ watch: { ours: { ...watch, why: 'form' } } }, 'watch-ours'))
    every('watchTheirs', line({ watch: { theirs: { ...watch, why: 'rating' } } }, 'watch-theirs'))
    every('watchOurs', line({ watch: { ours: { ...watch, why: 'rating' } } }, 'watch-ours'))
  })

  it('tells every running story in every wording', () => {
    const say = (s: Storyline) => (k: string) => storylineText(s, u, 'Test XI', k).text
    const race = { kind: 'title-race' as const, id: 'race', rivalId: club, toPlay: 5, before: null }
    every('raceClear', say({ ...race, position: 1, gap: 3 }))
    every('raceLevel', say({ ...race, position: 1, gap: 0 }))
    every('raceBehind', say({ ...race, position: 2, gap: -3 }))
    // The trend, a sentence after the main line when the gap moved since last week: read on its own
    const trend = (stem: string, s: Storyline) => every(stem, (k) => {
      const text = say(s)(k)
      return text.slice(text.indexOf('.') + 1)
    })
    trend('leadClosing', { ...race, position: 1, gap: 2, before: 5 })
    trend('leadGrowing', { ...race, position: 1, gap: 5, before: 2 })
    trend('chaseClosing', { ...race, position: 2, gap: -2, before: -5 })
    trend('chaseSlipping', { ...race, position: 2, gap: -5, before: -2 })
    const drop = { kind: 'relegation' as const, id: 'drop', position: 17, toPlay: 5, before: null }
    every('dropAbove', say({ ...drop, gap: 2 }))
    every('dropIn', say({ ...drop, gap: -2 }))
    every('dropLevel', say({ ...drop, gap: 0 }))
    trend('climbing', { ...drop, gap: 4, before: 1 })
    trend('sinking', { ...drop, gap: 1, before: 4 })
    const boot = { kind: 'golden-boot' as const, id: 'boot', playerId: 'p', name: 'A. Striker' }
    every('bootLevel', say({ ...boot, goals: 10, rank: 1, rival: { name: 'B. Forward', teamId: club, goals: 10 } }))
    every('bootLeads', say({ ...boot, goals: 12, rank: 1, rival: { name: 'B. Forward', teamId: club, goals: 10 } }))
    every('bootLeadsAlone', say({ ...boot, goals: 12, rank: 1, rival: null }))
    every('bootChasing', say({ ...boot, goals: 8, rank: 2, rival: { name: 'B. Forward', teamId: club, goals: 10 } }))
    every('bootChasingAlone', say({ ...boot, goals: 8, rank: 3, rival: null }))
    every('winRun', say({ kind: 'winning-run', id: 'w', length: 4 }))
    every('winRunLong', say({ kind: 'winning-run', id: 'w', length: LONG_RUN }))
    every('unbeatenRun', say({ kind: 'unbeaten-run', id: 'u', length: 6 }))
    every('loseRun', say({ kind: 'losing-run', id: 'l', length: 4 }))
    every('winlessRun', say({ kind: 'winless-run', id: 'n', length: 5 }))
    const ms = { kind: 'milestone' as const, id: 'm', playerId: 'p', name: 'A. Striker', target: 100 }
    every('appsReached', say({ ...ms, stat: 'apps', value: 100, reached: true }))
    every('goalsReached', say({ ...ms, stat: 'goals', value: 100, reached: true }))
    every('appsNear', say({ ...ms, stat: 'apps', value: 99, reached: false }))
    every('goalsNear', say({ ...ms, stat: 'goals', value: 98, reached: false }))
    every('oldClub', say({ kind: 'old-club', id: 'o', playerId: 'p', name: 'A. Striker', clubId: club, season: 2015, comp: 'league' }))
    every('pressure', say({ kind: 'pressure', id: 'p', confidence: 30, canSack: false, target: 6, position: 12 }))
    const run = { kind: 'run-in' as const, id: 'r', target: 6, gapSafety: 20 }
    const part = (s: Storyline, i: 0 | 1) => (k: string) => {
      const text = say(s)(k)
      const cut = text.indexOf('.') + 1
      return i === 0 ? text.slice(0, cut) : text.slice(cut)
    }
    every('lastDay', part({ ...run, toPlay: 1, position: 1, gapTop: 3 }, 0))
    every('gamesToPlay', part({ ...run, toPlay: 4, position: 1, gapTop: 3 }, 0))
    every('runTop', part({ ...run, toPlay: 4, position: 1, gapTop: 3 }, 1))
    every('runOnCourse', part({ ...run, toPlay: 4, position: 5, gapTop: -20 }, 1))
    every('pressureSack', say({ kind: 'pressure', id: 'p', confidence: 15, canSack: true, target: 6, position: 15 }))
  })

  it('heads every summer in every wording', () => {
    const record = { year: 2, leagueId: 'england', leagueSeason: 2022, teamName: 'Test XI', position: 4, points: 70, won: 21, drawn: 7, lost: 10, goalsFor: 70, goalsAgainst: 40 }
    for (const h of ['treble', 'double', 'perfect', 'invincible', 'champions', 'relegated', 'cup', 'europe', 'climb', 'slide', 'steady'] as SummerHeadline[]) {
      const review = { record, previous: null, headline: h, climb: h === 'slide' ? -3 : 3, titles: 1, seasons: 1, legend: null } as unknown as SummerReview
      every(`head_${h}`, (k) => summerText(review, u, k).headline)
    }
  })

  it('reaches every line that has wordings', () => {
    expect(variantStems().filter((s) => !reached.has(s)).sort()).toEqual([])
  })
})

describe('the inbox’s new banks', () => {
  const KEYS2 = Array.from({ length: 300 }, (_, i) => i)
  const covers = (bank: readonly string[], f: (i: number) => string) => {
    const seen = new Set(KEYS2.map(f))
    for (const l of bank) expect(seen.has(l), l).toBe(true)
  }
  const res = (title: string, body: string) => (i: number): string => newsBody({ matchweek: i, kind: 'result', title, body })
  const fill = (bank: readonly string[], score: string) => bank.map((l) => fillTemplate(l, { score }))

  it('a high-scoring win and a thrilling draw have their own lines, the old banks keep theirs', () => {
    covers(fill(RESULT_BODIES.shootoutWin, '3-2'), res('TXI 3-2 ARS', STOCK_BODIES.win))
    covers(fill(RESULT_BODIES.shootoutWin, '4-2'), res('ARS 2-4 TXI', STOCK_BODIES.win))
    covers(fill(RESULT_BODIES.thrillerDraw, '3-3'), res('TXI 3-3 ARS', STOCK_BODIES.draw))
    covers(fill(RESULT_BODIES.scoreDraw, '2-2'), res('TXI 2-2 ARS', STOCK_BODIES.draw))
    covers(fill(RESULT_BODIES.narrowWin, '2-1'), res('TXI 2-1 ARS', STOCK_BODIES.win))
  })

  it('a ban reads in several ways, the stored line among them', () => {
    const yellow = (i: number) => newsBody({ matchweek: i, kind: 'suspension', title: `Player ${i} suspended`, body: STOCK_BODIES.fiveYellows })
    covers(ROUTINE_BODIES.fiveYellows, yellow)
    for (const n of [1, 3]) {
      const body = `Suspended for ${n} match${n === 1 ? '' : 'es'}.`
      const red = (i: number) => newsBody({ matchweek: i, kind: 'suspension', title: `Player ${i} sent off`, body })
      covers([body, ...RED_CARD_BODIES.map((l) => fillTemplate(l, { n }))], red)
    }
    // Any other suspension body is shown as stored
    const odd: NewsItem = { matchweek: 1, kind: 'suspension', title: 'X', body: 'Banned by the league.' }
    expect(newsBody(odd)).toBe(odd.body)
  })
})

describe('the pundit’s hundred points', () => {
  it('remarks on a hundred-point season in every wording', () => {
    const base: VerdictInput = { key: 'x', tier: 'CHAMPIONS', position: 1, clubs: 20, won: 32, drawn: 4, lost: 2, points: 100, goalsFor: 80, goalsAgainst: 30, team: 'Test XI' }
    const all = KEYS.map((k) => punditVerdict({ ...base, key: k }))
    for (const l of STAT_LINES.centurion.map((x) => fillTemplate(x, { points: 100 }))) expect(all.some((v) => v.endsWith(l)), l).toBe(true)
    expect(KEYS.map((k) => punditVerdict({ ...base, key: k, points: 99 })).some((v) => STAT_LINES.centurion.some((c) => v.endsWith(fillTemplate(c, { points: 99 }))))).toBe(false)
  })
})

describe('the new lines in another language', () => {
  it('translates a verdict of two two-sentence lines whole, and every new inbox and pundit line', () => {
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    try {
      const verdict = logicLine('Worthy champions. The best side over the season. A hundred points. That is a number for the record books.')
      for (const w of ['Worthy', 'season', 'hundred', 'record books']) expect(verdict, w).not.toContain(w)
      const lines = [...Object.values(RESULT_BODIES).flat().map((l) => fillTemplate(l, { score: '3-2' })), ...Object.values(ROUTINE_BODIES).flat(), ...RED_CARD_BODIES.map((l) => fillTemplate(l, { n: 2 })), ...STAT_LINES.centurion.map((l) => fillTemplate(l, { points: 101 }))]
      expect(lines.filter((l) => logicLine(l) === l)).toEqual([])
    } finally {
      setLocaleMessages({ id: 'en', messages: {} })
    }
  })
})

describe('the digest’s mood', () => {
  it('reads the stretch from the results and the table', () => {
    const at = { from: 8, to: 8, fromPreseason: false }
    expect(digestMood(['W'], at)).toBeNull()
    expect(digestMood(['W', 'W', 'W'], at)).toBe('perfect')
    expect(digestMood(['W', 'D', 'W'], at)).toBe('unbeaten')
    expect(digestMood(['D', 'L'], at)).toBe('winless')
    expect(digestMood(['W', 'L', 'D'], { from: 10, to: 6, fromPreseason: false })).toBe('climb')
    expect(digestMood(['W', 'L', 'D'], { from: 6, to: 10, fromPreseason: false })).toBe('slide')
    expect(digestMood(['W', 'L', 'D'], { from: 6, to: 10, fromPreseason: true })).toBe('mixed')
    expect(digestMood(['W', 'W', 'L', 'W'], at)).toBe('good')
    expect(digestMood(['L', 'L', 'D', 'W', 'L'], at)).toBe('poor')
  })

  it('has every wording in the catalogue and reaches each', () => {
    for (const mood of ['perfect', 'unbeaten', 'winless', 'climb', 'slide', 'good', 'poor', 'mixed'])
      for (let i = 0; i < DIGEST_MOOD_WORDINGS; i++) expect(`digestMood_${mood}_${i}` in app.messages, `${mood}_${i}`).toBe(true)
    for (let i = 0; i < DIGEST_MOOD_WORDINGS; i++) expect(`digestQuiet_${i}` in app.messages).toBe(true)
    const seen = new Set(Array.from({ length: 200 }, (_, i) => digestWording('g', i, i + 5, 'mood')))
    expect([...seen].sort()).toEqual([0, 1, 2])
    expect(digestWording('g', 3, 8, 'mood')).toBe(digestWording('g', 3, 8, 'mood'))
  })
})

describe('the commentary’s new moods', () => {
  const names = { home: 'HOM', away: 'AWA' }
  const none = { home: 0, away: 0 }
  const filled = (bank: readonly string[], v: Record<string, string>) => bank.map((l) => fillTemplate(l, v))
  const covers = (bank: string[], f: (k: string) => string | null) => {
    const seen = new Set(KEYS.map(f))
    for (const l of bank) expect(seen.has(l), l).toBe(true)
  }
  it('says a two-goal cushion and an open game from the score and the clock', () => {
    covers(filled(MOOD_LINES.comfortable, { lead: 'HOM', trail: 'AWA' }), (k) => moodLine(k, 65, { home: 2, away: 0 }, none, 'home', names))
    covers(filled(MOOD_LINES.openGame, {}), (k) => moodLine(k, 40, { home: 1, away: 1 }, none, 'home', names))
    // Not before the hour for a two-goal lead, never an open game late on or goalless
    expect(KEYS.every((k) => moodLine(k, 30, { home: 2, away: 0 }, none, 'home', names) === null)).toBe(true)
    expect(KEYS.every((k) => !MOOD_LINES.openGame.includes(moodLine(k, 85, { home: 1, away: 1 }, none, 'home', names) as never))).toBe(true)
  })
})
