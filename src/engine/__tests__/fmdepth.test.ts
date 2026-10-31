import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { aerialBonus, aerialOf, beginMatch, lateFade, simulateMatch, teamInputFromPool, type MatchTeamInput } from '../match'
import { tacticalModifiers, tacticsForStyle } from '../tactics'
import { buildLeague, isClassic, type MetaFile, type PlayersFile } from '../universe'
import { aggressionCardFactor, DEPTH_KEYS, deriveAggression, deriveJumping, deriveStamina, deriveStrength, deriveWorkRate, familiarityGainFactor, fatigueInjuryFactor, injuryRiskLevel, legs, mismatchFactor, staminaCostFactor, withDepth, workRateEdge } from '../depth'
import { computeTeamStrength } from '../ratings'
import { ENGINE_VERSION } from '../version'
import type { Attributes, PlayerSeason, SquadPlayer } from '../types'

const root = path.resolve(__dirname, '..', '..', '..')
const LEAGUES = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const COLUMNS = ['sta', 'str', 'agg', 'jmp', 'wr']

/** Best distinct players per position within an overall band, so every slot has a natural fit. */
function bestXIpool(all: PlayerSeason[], minOverall: number, maxOverall: number): PlayerSeason[] {
  const seen = new Set<string>()
  const pool: PlayerSeason[] = []
  const perPos: Record<string, number> = { GK: 2, CB: 4, LB: 2, RB: 2, DM: 2, CM: 3, AM: 2, LW: 2, RW: 2, ST: 3 }
  const sorted = all.filter((p) => p.overall >= minOverall && p.overall <= maxOverall).sort((a, b) => b.overall - a.overall)
  for (const pos of Object.keys(perPos)) {
    let n = 0
    for (const p of sorted) {
      if (n >= perPos[pos]) break
      if (seen.has(p.playerId) || p.positions[0] !== pos) continue
      seen.add(p.playerId)
      pool.push(p)
      n++
    }
  }
  return pool
}

/** The same players with one depth attribute set to a value, as a fresh pool (ids kept). */
function withAttr(pool: PlayerSeason[], patch: Partial<Attributes>): PlayerSeason[] {
  return pool.map((p) => ({ ...p, attributes: { ...p.attributes, ...patch } }))
}

/** The same players under other ids, so two copies of one squad can face each other (condition loss is keyed by id). */
function renamed(pool: PlayerSeason[], tag: string): PlayerSeason[] {
  return pool.map((p) => ({ ...p, id: `${p.id}#${tag}` }))
}

const fresh = (condition: number): SquadPlayer => ({ playerSeasonId: '', condition, morale: 70, sharpness: 80, familiarity: 70, recentRatings: [], injury: null, suspension: 0, yellowCards: 0, seasonStats: { apps: 0, starts: 0, goals: 0, assists: 0, minutes: 0, ratingSum: 0, cleanSheets: 0, motm: 0 } })

describe('depth columns in the data packs', () => {
  it('every pack carries stamina, strength, aggression, jumping and work rate as integers in 1..99', () => {
    for (const id of LEAGUES) {
      const players = JSON.parse(readFileSync(path.join(root, 'public', 'data', id, 'players.json'), 'utf8')) as PlayersFile
      expect(players.version).toBeGreaterThanOrEqual(3)
      const col = Object.fromEntries(players.columns.map((c, i) => [c, i])) as Record<string, number>
      for (const c of COLUMNS) expect(col[c], `${id} has column ${c}`).toBeDefined()
      let bad = 0
      for (const row of players.rows) for (const c of COLUMNS) {
        const v = row[col[c]]
        if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 99) bad++
      }
      expect(bad, `${id}: out-of-range depth values`).toBe(0)
      // The columns carry information: a work rate of 80 (High/High) exists, and stamina spreads widely
      const wr = players.rows.map((r) => r[col.wr] as number)
      expect(wr.some((v) => v === 80)).toBe(true)
      const sta = players.rows.map((r) => r[col.sta] as number)
      expect(Math.max(...sta) - Math.min(...sta)).toBeGreaterThan(40)
    }
  })

  it('loads the five into every player-season and keepers read low on stamina and aggression', () => {
    const u = loadTestUniverse()
    const all = Object.values(u.index)
    for (const p of all) for (const k of DEPTH_KEYS) {
      expect(Number.isInteger(p.attributes[k]), `${p.id} ${k}`).toBe(true)
      expect(p.attributes[k]).toBeGreaterThanOrEqual(1)
      expect(p.attributes[k]).toBeLessThanOrEqual(99)
    }
    const mean = (ps: PlayerSeason[], k: keyof Attributes) => ps.reduce((s, p) => s + p.attributes[k], 0) / ps.length
    const keepers = all.filter((p) => p.positions[0] === 'GK')
    const outfield = all.filter((p) => p.positions[0] !== 'GK')
    expect(mean(keepers, 'stamina')).toBeLessThan(mean(outfield, 'stamina') - 15)
    expect(mean(keepers, 'aggression')).toBeLessThan(mean(outfield, 'aggression') - 15)
    const vardy = all.find((p) => p.name === 'J. Vardy' && p.season === 2015)!
    expect(vardy.attributes.stamina).toBeGreaterThan(80)
    expect(vardy.attributes.workRate).toBe(80)
  })
})

describe('derivation fallbacks', () => {
  it('derive sensible numbers from the eight core attributes, age and height', () => {
    expect(deriveStamina(70, 25)).toBe(73)
    expect(deriveStamina(70, 33)).toBe(65)
    expect(deriveStrength(70, 190)).toBe(74)
    expect(deriveStrength(70, 0)).toBe(70)
    expect(deriveAggression(80, 70)).toBe(76)
    expect(deriveJumping(190, 75)).toBe(80)
    expect(deriveWorkRate(60)).toBe(55)
    expect(deriveWorkRate(99)).toBe(75)
    expect(deriveWorkRate(10)).toBe(35)
    for (const v of [deriveStamina(1, 40), deriveStrength(99, 210), deriveJumping(140, 1), deriveAggression(99, 99)]) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(99)
    }
  })

  it('withDepth keeps known values and derives the missing ones', () => {
    const core = { pace: 70, shooting: 60, passing: 65, dribbling: 66, defending: 50, physical: 72, mentality: 68, goalkeeping: 10 }
    const a = withDepth({ ...core, stamina: 88, strength: undefined, aggression: Number.NaN, jumping: undefined, workRate: undefined }, 24, 185)
    expect(a.stamina).toBe(88)
    expect(a.strength).toBe(deriveStrength(72, 185))
    expect(a.aggression).toBe(deriveAggression(50, 68))
    expect(a.jumping).toBe(deriveJumping(185, 72))
    expect(a.workRate).toBe(deriveWorkRate(68))
  })

  it('an older pack without the columns still loads, with the depth derived row by row', () => {
    const players = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'england', 'players.json'), 'utf8')) as PlayersFile
    const meta = JSON.parse(readFileSync(path.join(root, 'public', 'data', 'england', 'meta.json'), 'utf8')) as MetaFile
    const keep = players.columns.map((c, i) => [c, i] as const).filter(([c]) => !COLUMNS.includes(c))
    const old: PlayersFile = { ...players, version: 2, columns: keep.map(([c]) => c), rows: players.rows.slice(0, 2000).map((r) => keep.map(([, i]) => r[i])) }
    const u = buildLeague(old, meta)
    const fresh = buildLeague({ ...players, rows: players.rows.slice(0, 2000) }, meta)
    let differ = 0
    for (const [id, p] of Object.entries(u.index)) {
      for (const k of DEPTH_KEYS) {
        expect(Number.isInteger(p.attributes[k])).toBe(true)
        expect(p.attributes[k]).toBeGreaterThanOrEqual(1)
        expect(p.attributes[k]).toBeLessThanOrEqual(99)
      }
      expect(p.attributes.stamina).toBe(deriveStamina(p.attributes.physical, p.age))
      expect(p.attributes.workRate).toBe(deriveWorkRate(p.attributes.mentality))
      if (p.attributes.stamina !== fresh.index[id].attributes.stamina) differ++
    }
    // Derived values approximate the real ones; they are not them
    expect(differ).toBeGreaterThan(0)
  })
})

describe('depth helpers', () => {
  it('are bounded and documented', () => {
    expect(staminaCostFactor(50)).toBeCloseTo(1)
    expect(staminaCostFactor(90)).toBeCloseTo(0.8)
    expect(staminaCostFactor(30)).toBeCloseTo(1.1)
    expect(legs(80)).toBe(0)
    expect(legs(50)).toBeCloseTo(0.5)
    expect(legs(10)).toBe(1)
    expect(aggressionCardFactor(0)).toBeCloseTo(0.7)
    expect(aggressionCardFactor(50)).toBeCloseTo(1)
    expect(aggressionCardFactor(100)).toBeCloseTo(1.3)
    expect(fatigueInjuryFactor(90, 90)).toBe(1)
    expect(fatigueInjuryFactor(30, 90)).toBe(1)
    expect(fatigueInjuryFactor(90, 30)).toBe(1)
    expect(fatigueInjuryFactor(30, 40)).toBeCloseTo(1.3)
    expect(fatigueInjuryFactor(50, 60)).toBeCloseTo(1 + 0.3 * 0.5 * 0.5)
    expect(mismatchFactor(80, 72)).toBeCloseTo(1.04)
    expect(mismatchFactor(72, 80)).toBeCloseTo(0.96)
    expect(mismatchFactor(99, 40)).toBeCloseTo(1.04)
    expect(mismatchFactor(76, 72)).toBeCloseTo(1.02)
    expect(workRateEdge(35)).toBeCloseTo(-0.2)
    expect(workRateEdge(55)).toBe(0)
    expect(workRateEdge(80)).toBeCloseTo(0.25)
    expect(workRateEdge(99)).toBeCloseTo(0.25)
    expect(familiarityGainFactor(80)).toBe(1)
    expect(familiarityGainFactor(55)).toBe(1)
    expect(familiarityGainFactor(35)).toBeCloseTo(0.8)
    expect(familiarityGainFactor(1)).toBeCloseTo(0.8)
    expect(injuryRiskLevel({ injuryProneness: 0.05 })).toBe(1)
    expect(injuryRiskLevel({ injuryProneness: 0.3 })).toBe(2)
    expect(injuryRiskLevel({ injuryProneness: 0.5 })).toBe(3)
    expect(injuryRiskLevel({ injuryProneness: 0.75 })).toBe(4)
    expect(injuryRiskLevel({ injuryProneness: 0.97 })).toBe(5)
  })
})

describe('depth in the match engine', () => {
  const u = loadTestUniverse()
  // the standard seasons' players: the pins below predate the classic pack, which is opt-in
  const all = Object.values(u.index).filter((p) => !isClassic(u, p))
  const elite = bestXIpool(all, 86, 99)
  const mid = bestXIpool(all, 72, 76)
  const low = withAttr(mid, { stamina: 35 })
  const high = renamed(withAttr(mid, { stamina: 90 }), 'high')

  it('identical squads except stamina: the low-stamina side loses more condition and fades more', () => {
    let lowLoss = 0
    let highLoss = 0
    let lowLate = 0
    let highLate = 0
    let lowEarly = 0
    let highEarly = 0
    // 4,000 matches: at 600 the late-goal shares (about 0.24 each, a difference near 0.014) sat
    // within one standard error, and the 2026-10-25 data rebuild flipped them on the same seeds
    const n = 4000
    for (let i = 0; i < n; i++) {
      const rng = new Rng(`stamina-${i}`)
      const home = teamInputFromPool('L', 'Low', 'LOW', tacticsForStyle('balanced', '4-3-3'), low)
      const away = teamInputFromPool('H', 'High', 'HIG', tacticsForStyle('balanced', '4-3-3'), high)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      for (const [id, loss] of Object.entries(r.conditionLoss)) {
        if (home.getPlayer(id)) lowLoss += loss
        else highLoss += loss
      }
      for (const e of r.events) {
        if (e.type !== 'goal' && e.type !== 'penalty' && e.type !== 'own_goal') continue
        if (e.side === 'home') e.minute > 70 ? lowLate++ : lowEarly++
        else e.minute > 70 ? highLate++ : highEarly++
      }
    }
    console.log(`stamina: condition lost low ${(lowLoss / n).toFixed(1)} high ${(highLoss / n).toFixed(1)} a match; late-goal share low ${(lowLate / (lowLate + lowEarly)).toFixed(3)} high ${(highLate / (highLate + highEarly)).toFixed(3)}`)
    // Condition: ×1.075 against ×0.8 on the same base, so about a third more
    expect(lowLoss / highLoss).toBeGreaterThan(1.2)
    expect(lowLoss / highLoss).toBeLessThan(1.5)
    // The fade: the low-stamina side scores a smaller share of its goals after the 70th minute
    expect(lowLate / (lowLate + lowEarly)).toBeLessThan(highLate / (highLate + highEarly))
    // The fade itself, measured on a kicked-off match: 0.08 for each of the ten outfielders at
    // stamina 35 (the keeper counts as fresh), so 0.08 × 10/11 over the eleven; nothing for 90
    const mp = beginMatch({ rng: new Rng('fade'), home: teamInputFromPool('L', 'Low', 'LOW', tacticsForStyle('balanced', '4-3-3'), low), away: teamInputFromPool('H', 'High', 'HIG', tacticsForStyle('balanced', '4-3-3'), high), detail: 'summary' })
    expect(lateFade(mp.hLive, (id) => low.find((p) => p.id === id))).toBeCloseTo((0.08 * 10) / 11, 5)
    expect(lateFade(mp.aLive, (id) => high.find((p) => p.id === id))).toBe(0)
  }, 30000)

  it('a keeper\'s low stamina, a convention of the data, costs him nothing', () => {
    // Only the keeper differs: stamina 20 against 95. He does not fade, loses the same condition
    // and the side's late fade stays at nothing.
    const gkLow = mid.map((p) => (p.positions[0] === 'GK' ? { ...p, attributes: { ...p.attributes, stamina: 20 } } : { ...p, attributes: { ...p.attributes, stamina: 90 } }))
    const gkHigh = gkLow.map((p) => (p.positions[0] === 'GK' ? { ...p, attributes: { ...p.attributes, stamina: 95 } } : p))
    const get = (pool: PlayerSeason[]) => (id: string) => pool.find((p) => p.id === id)
    const mp = beginMatch({ rng: new Rng('gk-fade'), home: teamInputFromPool('L', 'L', 'L', tacticsForStyle('balanced', '4-3-3'), gkLow), away: teamInputFromPool('H', 'H', 'H', tacticsForStyle('balanced', '4-3-3'), renamed(gkHigh, 'gk')), detail: 'summary' })
    expect(lateFade(mp.hLive, get(gkLow))).toBe(0)
    const keeperLoss = (pool: PlayerSeason[]) => {
      const r = simulateMatch({ rng: new Rng('gk-cost'), home: teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), pool), away: teamInputFromPool('B', 'B', 'B', tacticsForStyle('balanced', '4-3-3'), renamed(mid, 'opp')), detail: 'summary' })
      return Object.entries(r.conditionLoss).filter(([id]) => pool.find((p) => p.id === id)?.positions[0] === 'GK').map(([, loss]) => loss)
    }
    expect(keeperLoss(gkLow)).toEqual(keeperLoss(gkHigh))
    expect(keeperLoss(gkLow).length).toBeGreaterThan(0)
  })

  it('routine substitutions take off the low-stamina men first', () => {
    // Half the XI at stamina 40, half at 90, same condition: the tired-looking half goes off
    let lowOff = 0
    let highOff = 0
    for (let i = 0; i < 300; i++) {
      const rng = new Rng(`subs-${i}`)
      const home = teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), mid.map((p, j) => ({ ...p, attributes: { ...p.attributes, stamina: j % 2 ? 40 : 90 } })))
      const away = teamInputFromPool('B', 'B', 'B', tacticsForStyle('balanced', '4-3-3'), mid)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      for (const s of r.homeReport.substitutions) {
        if (s.reason !== 'tired' && s.reason !== 'tactical') continue
        const st = home.getPlayer(s.off)?.attributes.stamina
        if (st === 40) lowOff++
        else if (st === 90) highOff++
      }
    }
    console.log(`routine subs off: stamina 40 ${lowOff}, stamina 90 ${highOff}`)
    expect(lowOff).toBeGreaterThan(highOff * 1.5)
  })

  it('aggression lifts cards: the most combative side collects far more than the meekest over 500 matches', () => {
    const meek = withAttr(mid, { aggression: 10 })
    const combative = withAttr(mid, { aggression: 99 })
    let meekCards = 0
    let combativeCards = 0
    for (let i = 0; i < 500; i++) {
      const rng = new Rng(`cards-${i}`)
      const home = teamInputFromPool('M', 'Meek', 'MEE', tacticsForStyle('balanced', '4-3-3'), meek)
      const away = teamInputFromPool('C', 'Combative', 'COM', tacticsForStyle('balanced', '4-3-3'), combative)
      const r = simulateMatch({ rng, home, away, detail: 'summary' })
      for (const e of r.events) {
        if (e.type !== 'yellow' && e.type !== 'red') continue
        if (e.side === 'home') meekCards++
        else combativeCards++
      }
    }
    console.log(`cards over 500: aggression 10 → ${meekCards}, aggression 99 → ${combativeCards} (ratio ${(combativeCards / meekCards).toFixed(2)})`)
    // (0.7 + 0.594) / (0.7 + 0.06) = 1.70 on the yellow; the second yellow compounds it
    expect(combativeCards / meekCards).toBeGreaterThan(1.5)
    expect(combativeCards / meekCards).toBeLessThan(2.0)
  })

  it('an aerial mismatch moves expected goals by up to 4 per cent each way, and pressing gets bite from aggression and work rate', () => {
    const tall = withAttr(mid, { strength: 90, jumping: 90 })
    const slight = withAttr(mid, { strength: 55, jumping: 55 })
    // The reference has every man at 72 in the air, so its mismatch is exactly 1 and its set-piece term 0
    const even = withAttr(mid, { strength: 72, jumping: 72 })
    const sides = (h: PlayerSeason[], a: PlayerSeason[]) => ({ home: teamInputFromPool('H', 'H', 'H', tacticsForStyle('balanced', '4-3-3'), h), away: teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), a) })
    const base = beginMatch({ rng: new Rng('aerial'), ...sides(even, even), detail: 'summary' })
    const tilted = beginMatch({ rng: new Rng('aerial'), ...sides(tall, slight), detail: 'summary' })
    // The same seed draws the same variance, so the ratio is the aerial effect alone:
    // the mismatch (×1.04 for the tall side, ×0.96 for the slight) plus the set-piece term (+0.0072, −0.0068)
    const upH = tilted.lamH / base.lamH
    const downA = tilted.lamA / base.lamA
    console.log(`aerial: tall side xG ×${upH.toFixed(4)}, slight side ×${downA.toFixed(4)}`)
    expect(upH).toBeCloseTo(1.04 * 1.0072, 3)
    expect(downA).toBeCloseTo(0.96 * (1 - 0.0068), 3)
    const getTall = (id: string) => tall.find((p) => p.id === id)
    expect(aerialOf(tilted.hLive, getTall, 'attack')).toBeCloseTo(90)
    expect(aerialBonus(tilted.hLive, getTall)).toBeCloseTo(0.0072)
    expect(aerialBonus(tilted.aLive, (id) => slight.find((p) => p.id === id))).toBeCloseTo(-0.0068)
    // Pressing: a hard-working, aggressive side presses better than a lazy, meek one
    const pressing = tacticsForStyle('press', '4-3-3')
    const slots = (pool: PlayerSeason[]) => computeTeamStrength(pressing, teamInputFromPool('P', 'P', 'P', pressing, pool).lineup, (id) => pool.find((p) => p.id === id), () => undefined).slots
    const opp = computeTeamStrength(tacticsForStyle('balanced', '4-3-3'), teamInputFromPool('O', 'O', 'O', tacticsForStyle('balanced', '4-3-3'), mid).lineup, (id) => mid.find((p) => p.id === id), () => undefined).slots
    const workers = tacticalModifiers(pressing, slots(withAttr(mid, { workRate: 80, aggression: 80, stamina: 85 })), tacticsForStyle('balanced', '4-3-3'), opp)
    const loafers = tacticalModifiers(pressing, slots(withAttr(mid, { workRate: 35, aggression: 40, stamina: 55 })), tacticsForStyle('balanced', '4-3-3'), opp)
    console.log(`press: workers attack ×${workers.attack} defence ×${workers.defence} fatigue ${workers.fatigue}; loafers ×${loafers.attack} ×${loafers.defence} fatigue ${loafers.fatigue}`)
    expect(workers.attack).toBeGreaterThan(loafers.attack)
    expect(workers.defence).toBeLessThan(loafers.defence)
    expect(workers.fatigue).toBeLessThan(loafers.fatigue)
    // The press style is a fast tempo too, so work rate counts twice: 1.074 from the press and 1.035 from the counters
    expect(workers.attack / loafers.attack).toBeLessThan(1.12)
    expect(workers.notes).toContain('A hard-working side makes the press stick')
    expect(loafers.notes).toContain('Low work rate: the press is half-hearted')
  })

  it('low stamina on tired legs raises the injury roll by up to 30 per cent', () => {
    const count = (pool: PlayerSeason[], condition: number) => {
      let injuries = 0
      for (let i = 0; i < 1500; i++) {
        const rng = new Rng(`inj-${i}`)
        const state = () => fresh(condition)
        const home = teamInputFromPool('A', 'A', 'A', tacticsForStyle('balanced', '4-3-3'), pool, state)
        const away = teamInputFromPool('B', 'B', 'B', tacticsForStyle('balanced', '4-3-3'), mid, state)
        const r = simulateMatch({ rng, home, away, detail: 'summary' })
        injuries += r.events.filter((e) => e.type === 'injury' && e.side === 'home').length
      }
      return injuries
    }
    const tiredLow = count(withAttr(mid, { stamina: 30 }), 40)
    const tiredHigh = count(withAttr(mid, { stamina: 90 }), 40)
    const freshLow = count(withAttr(mid, { stamina: 30 }), 95)
    const freshHigh = count(withAttr(mid, { stamina: 90 }), 95)
    console.log(`injuries over 1,500: tired low ${tiredLow}, tired high ${tiredHigh}, fresh low ${freshLow}, fresh high ${freshHigh}`)
    expect(tiredLow / tiredHigh).toBeGreaterThan(1.12)
    expect(tiredLow / tiredHigh).toBeLessThan(1.5)
    // Fresh legs: stamina alone changes nothing
    expect(Math.abs(freshLow - freshHigh) / freshHigh).toBeLessThan(0.1)
  }, 30000)

  it('a seeded match is deterministic and pinned to the engine version', () => {
    // Engine 7 changed no match draw: the literals below held from engine 6
    expect(ENGINE_VERSION).toBe('7')
    const play = () => {
      const rng = new Rng('depth-pin')
      const home: MatchTeamInput = teamInputFromPool('E', 'Elite', 'ELI', tacticsForStyle('possession', '4-3-3'), elite)
      const away: MatchTeamInput = teamInputFromPool('M', 'Mid', 'MID', tacticsForStyle('counter', '4-2-3-1'), mid)
      return simulateMatch({ rng, home, away })
    }
    const a = play()
    const b = play()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const summary = { score: `${a.homeGoals}-${a.awayGoals}`, events: a.events.length, xg: `${a.xg.home}/${a.xg.away}`, cards: a.events.filter((e) => e.type === 'yellow' || e.type === 'red').length }
    console.log('depth-pin', JSON.stringify(summary))
    // Pinned on ENGINE_VERSION 4, and the same on 5 (this match makes no change a keeper-only man could take). Any change to the draws a match takes from the seed moves these,
    // and must bump the version: a mismatch here is the reminder. A data rebuild can move them too
    // (the pools are real players): 3.2 became 3.18 when the 2026-10-25 rebuild un-swapped the
    // 2008-14 left and right positions and C. Ronaldo 2008-09 joined the elite pool as a right winger.
    // Re-pinned on engine 6 (base xG 1.28, the soft ceiling, keepers booked and the card rates retuned)
    expect(summary).toEqual({ score: '1-0', events: 19, xg: '3.08/0.36', cards: 3 })
  })
})
