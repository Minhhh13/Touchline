import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { NewsItem } from '@engine/season'
import { fillTemplate, flavourChance, flavourHash, ordinalOf, pickVariant } from '../logic/flavour'
import { newsBody, RESULT_BODIES, ROUTINE_BODIES, scoreOfTitle, STOCK_BODIES } from '../logic/newsFlavour'
import { DYNASTY_LINES, punditVerdict, STAT_LINES, VERDICT_LINES, verdictInputOf, type VerdictInput } from '../logic/pundit'

const KEYS = Array.from({ length: 300 }, (_, i) => `k${i}`)

/** Every line of `bank` comes out over the keys. */
function covers(bank: readonly string[], f: (key: string, i: number) => string) {
  const seen = new Set(KEYS.map(f))
  for (const line of bank) expect(seen.has(line), line).toBe(true)
}

describe('flavour helpers', () => {
  it('pick the same variant for the same key, and every variant over many keys', () => {
    const bank = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    for (const k of KEYS) expect(pickVariant(bank, k)).toBe(pickVariant(bank, k))
    covers(bank, (k) => pickVariant(bank, k))
    expect(flavourHash('x')).toBe(flavourHash('x'))
    expect(flavourHash('x')).toBeGreaterThanOrEqual(0)
    const share = KEYS.filter((k) => flavourChance(k, 1, 4)).length / KEYS.length
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.35)
    expect(fillTemplate('{team} beat {opp}, {team} top. {x}', { team: 'TXI', opp: 'ARS' })).toBe('TXI beat ARS, TXI top. {x}')
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinalOf)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
  })

  it('draws nothing: no RNG, no clock, no Math.random', () => {
    for (const f of ['src/game/logic/flavour.ts', 'src/game/logic/newsFlavour.ts', 'src/game/logic/pundit.ts', 'src/game/logic/milestoneBadges.ts']) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|Rng\b/)
    }
  })
})

describe('inbox flavour', () => {
  const result = (title: string, body: string, matchweek: number): NewsItem => ({ matchweek, kind: 'result', title, body })

  it('varies a result’s stock body by the score, the same way every time, and every line gets used', () => {
    const fill = (bank: readonly string[], score: string) => bank.map((t) => t.replace('{score}', score))
    covers(fill(RESULT_BODIES.thrashing, '4-0'), (_k, i) => newsBody(result('TXI 4-0 ARS', STOCK_BODIES.win, i)))
    covers(fill(RESULT_BODIES.cleanWin, '2-0'), (_k, i) => newsBody(result('ARS 0-2 TXI', STOCK_BODIES.win, i)))
    covers(fill(RESULT_BODIES.narrowWin, '2-1'), (_k, i) => newsBody(result('TXI 2-1 ARS', STOCK_BODIES.win, i)))
    covers(fill(RESULT_BODIES.wideWin, '3-1'), (_k, i) => newsBody(result('TXI 3-1 ARS', STOCK_BODIES.win, i)))
    covers(fill(RESULT_BODIES.goallessDraw, '0-0'), (_k, i) => newsBody(result('TXI 0-0 ARS', STOCK_BODIES.draw, i)))
    covers(fill(RESULT_BODIES.scoreDraw, '2-2'), (_k, i) => newsBody(result('TXI 2-2 ARS', STOCK_BODIES.draw, i)))
    covers(fill(RESULT_BODIES.narrowLoss, '1-0'), (_k, i) => newsBody(result('TXI 0-1 ARS', STOCK_BODIES.loss, i)))
    covers(fill(RESULT_BODIES.heavyLoss, '3-0'), (_k, i) => newsBody(result('ARS 3-0 TXI', STOCK_BODIES.loss, i)))
    const n = result('TXI 2-1 ARS', STOCK_BODIES.win, 7)
    expect(newsBody(n)).toBe(newsBody({ ...n }))
  })

  it('varies the routine items and leaves every other item exactly as stored', () => {
    covers(ROUTINE_BODIES.friendly, (_k, i) => newsBody({ matchweek: 0, kind: 'info', title: `Friendly: 2-1 v Club ${i}`, body: STOCK_BODIES.friendly }))
    covers(ROUTINE_BODIES.freeWeekend, (_k, i) => newsBody({ matchweek: i, kind: 'info', title: `Matchweek ${i}: free weekend`, body: STOCK_BODIES.freeWeekend }))
    covers(ROUTINE_BODIES.windowShut, (_k, i) => newsBody({ matchweek: i, kind: 'transfer', title: 'Window closed', body: STOCK_BODIES.windowShut }))
    const kept: NewsItem[] = [
      { matchweek: 3, kind: 'injury', title: 'X injured', body: 'Knock. Out for around 1 week.' },
      { matchweek: 3, kind: 'result', title: 'No score here', body: STOCK_BODIES.win },
      { matchweek: 3, kind: 'result', title: 'TXI 2-1 ARS', body: 'Something else.' },
      { matchweek: 3, kind: 'cup', title: 'Final: through', body: '2-1 against ARS.' },
      { matchweek: 3, kind: 'training', title: 'Development report', body: 'Improving: A 70→72.' },
    ]
    for (const n of kept) expect(newsBody(n)).toBe(n.body)
    expect(scoreOfTitle('TXI 10-2 ARS')).toEqual({ a: 10, b: 2 })
    expect(scoreOfTitle('Window closed')).toBeNull()
  })
})

describe('pundit verdict', () => {
  const base: VerdictInput = { key: 'g-1', tier: 'MID_TABLE', position: 10, clubs: 20, won: 14, drawn: 10, lost: 14, points: 52, goalsFor: 50, goalsAgainst: 50, team: 'Touchline XI' }
  const first = (i: VerdictInput) => punditVerdict(i).split(/(?<=[.!?])\s/)[0]
  const tiers: Array<[readonly string[], Partial<VerdictInput>]> = [
    [VERDICT_LINES.perfect, { tier: 'PERFECT', position: 1, won: 38, drawn: 0, lost: 0 }],
    [VERDICT_LINES.invincible, { tier: 'INVINCIBLE', position: 1, won: 30, drawn: 8, lost: 0 }],
    [VERDICT_LINES.champions, { tier: 'CHAMPIONS', position: 1 }],
    [VERDICT_LINES.double, { tier: 'CHAMPIONS', position: 1, cupWon: true }],
    [VERDICT_LINES.treble, { tier: 'CHAMPIONS', position: 1, cupWon: true, continentalWon: true }],
    [VERDICT_LINES.titleRace, { tier: 'TITLE_RACE', position: 2 }],
    [VERDICT_LINES.european, { tier: 'EUROPEAN', position: 5 }],
    [VERDICT_LINES.midTable, { tier: 'MID_TABLE' }],
    [VERDICT_LINES.survived, { tier: 'RELEGATION_BATTLE', position: 17 }],
    [VERDICT_LINES.relegated, { tier: 'RELEGATED', position: 19 }],
    [VERDICT_LINES.sacked, { tier: 'RELEGATED', position: 20, sacked: true }],
  ]

  it('opens with a line for the result, the same for the same season, every line in use', () => {
    for (const [bank, o] of tiers) {
      const lines = KEYS.map((k) => first({ ...base, ...o, key: k }))
      for (const l of lines) expect(bank.some((b) => l === b || b.startsWith(l)), l).toBe(true)
      covers(bank, (k) => {
        const v = punditVerdict({ ...base, ...o, key: k })
        return bank.find((b) => v.startsWith(b)) ?? v
      })
    }
    expect(punditVerdict({ ...base, key: 'same' })).toBe(punditVerdict({ ...base, key: 'same' }))
  })

  it('adds a word on a number that stands out, and on a Dynasty’s run', () => {
    const tail = (i: VerdictInput) => KEYS.map((k) => punditVerdict({ ...i, key: k }))
    const has = (lines: string[], bank: readonly string[]) => bank.every((b) => lines.some((l) => l.endsWith(b)))
    expect(has(tail({ ...base, goalsFor: 100 }), STAT_LINES.attack)).toBe(true)
    expect(has(tail({ ...base, goalsAgainst: 20 }), STAT_LINES.defence)).toBe(true)
    expect(has(tail({ ...base, position: 4, tier: 'EUROPEAN', goalsAgainst: 70 }), STAT_LINES.leaky)).toBe(true)
    expect(has(tail({ ...base, drawn: 16, won: 11, lost: 11 }), STAT_LINES.draws)).toBe(true)
    // An ordinary season gets one sentence
    expect(tail(base).every((l) => VERDICT_LINES.midTable.includes(l as never))).toBe(true)
    const dyn = (seasons: number, titles: number) => tail({ ...base, dynasty: { seasons, titles } })
    expect(has(dyn(10, 3), DYNASTY_LINES.decade)).toBe(true)
    expect(has(dyn(4, 3), DYNASTY_LINES.dominant.map((t) => t.replace('{titles}', '3').replace('{seasons}', '4')))).toBe(true)
    expect(has(dyn(3, 0), DYNASTY_LINES.building.map((t) => t.replace('{seasons}', '3')))).toBe(true)
    // A first Dynasty season reads like any other
    expect(dyn(1, 1).every((l) => VERDICT_LINES.midTable.includes(l as never))).toBe(true)
  })

  it('reads its input off a finished game', () => {
    const quick = verdictInputOf({ id: 'g', year: 1, settings: { mode: 'quick', teamName: 'TXI' } as never, tier: 'CHAMPIONS', quickResult: { won: 30, drawn: 5, lost: 3, points: 95, position: 1, goalsFor: 90, goalsAgainst: 30, tier: 'CHAMPIONS', cup: { reached: 'W' } } as never, history: [], season: null }, 20)
    expect(quick).toMatchObject({ key: 'g-1', tier: 'CHAMPIONS', position: 1, cupWon: true, continentalWon: false, team: 'TXI' })
    expect(quick?.dynasty).toBeUndefined()
    const h = (position: number) => ({ position, tier: position === 1 ? 'CHAMPIONS' : 'MID_TABLE', won: 20, drawn: 9, lost: 9, points: 69, goalsFor: 60, goalsAgainst: 40 })
    const dynasty = verdictInputOf({ id: 'd', year: 3, settings: { mode: 'dynasty', teamName: 'TXI' } as never, tier: 'MID_TABLE', quickResult: undefined, history: [h(1), h(4), h(1)] as never, season: { sacked: false } as never }, 20)
    expect(dynasty).toMatchObject({ key: 'd-3', dynasty: { seasons: 3, titles: 2 } })
    expect(verdictInputOf({ id: 'e', year: 1, settings: { mode: 'season' } as never, tier: undefined, quickResult: undefined, history: [], season: null }, 20)).toBeNull()
  })
})
