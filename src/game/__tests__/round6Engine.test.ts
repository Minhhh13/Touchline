/**
 * Round 6's engine-side items, fixed inside engine 6 before its release: the fixed-rules chips carry a picture id
 * instead of an emoji, a lost Cup final's share text names an opposing man of the match's club, and the user's
 * assistant puts a natural man in a slot a cover was holding when that makes the XI stronger (BACKLOG round 6, item 6).
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { positionFactor } from '@engine/positions'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { assistantLineup, autoPickLineup, liveModifiers, roleRating, type StateLookup } from '@engine/ratings'
import { defaultTactics } from '@engine/tactics'
import { arenaShareText } from '@engine/awards'
import { clubIdOfKey } from '@engine/knockout'
import { cupRoundCount } from '@engine/cup'
import type { Formation, Lineup, PlayerSeason, Tactics } from '@engine/types'
import { beginSeason, createGame, describeRuleChips, describeRules, setupRules } from '../logic/setup'
import { arenaClubShortName, arenaShareInput, beginArena, cupGameSettings, simArenaToEnd } from '../logic/arena'
import { playerLookup } from '../logic/players'
import type { Game } from '../types'

const u = loadTestUniverse(['england'])
const EMOJI = /\p{Extended_Pictographic}/u

describe('the fixed-rules chips', () => {
  it('carry a picture id for the modes, the power-ups, the manager and the end case, and no emoji in any word', () => {
    const base = { difficulty: 'normal' as const, showRatings: true, draftMode: 'squad' as const, ratings: 'season' as const, eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: true, leagues: ['england'] }
    const spin = setupRules(QUICK_RULES, { ...base, modes: ['crazy', 'underdog', 'legends', 'speedrun', 'gamble'], powerUps: true, managers: true, managerSpin: true, endCase: true, benchPicks: 2 })
    const chips = describeRuleChips(u, { ...spin, upgrader: true })
    expect(chips.map((c) => c.text)).toEqual(describeRules(u, { ...spin, upgrader: true }))
    for (const c of chips) expect(c.text).not.toMatch(EMOJI)
    const icon = (text: string) => chips.find((c) => c.text === text)?.icon
    expect(icon('Crazy')).toBe('crazy')
    expect(icon('Speedrun')).toBe('speedrun')
    expect(icon('Upgrader')).toBe('upgrader')
    expect(icon('Power-ups')).toBe('power-ups')
    expect(icon('Manager spin')).toBe('manager-spin')
    expect(icon('End case')).toBe('end-case')
    // The plain rules carry no picture
    expect(chips.slice(0, 6).every((c) => c.icon === undefined)).toBe(true)
    const pick = describeRuleChips(u, setupRules(QUICK_RULES, { ...base, managers: true }))
    expect(pick.find((c) => c.text === 'Manager pick')?.icon).toBe('manager-pick')
    expect(pick.some((c) => c.icon === 'end-case' || c.icon === 'power-ups')).toBe(false)
  })
})

describe('a lost Cup final’s share text', () => {
  it('names an opposing man of the match with his club, as the summary does', () => {
    let seen = 0
    for (let i = 0; i < 80 && seen < 2; i++) {
      const g = createGame(cupGameSettings(u, { teamName: 'Cup XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed: `r6-final-${i}`, hardMode: false, twists: true, size: 8 }, 'CXI'))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginArena(g, u)
      simArenaToEnd(g, u)
      const a = g.arena!
      const last = a.log[a.log.length - 1]
      if (a.won || a.log.length !== cupRoundCount(8) || !last.motmId || g.squad[last.motmId]) continue
      seen++
      const club = u.clubById[clubIdOfKey(last.opponent)]?.shortName ?? arenaClubShortName(u, last.opponent)
      const name = playerLookup(g, u)(last.motmId)!.name
      const line = arenaShareText(arenaShareInput(g, u)!).split('\n').find((l) => l.startsWith('⭐ Final MOTM: '))
      expect(line).toBeDefined()
      expect(line!.endsWith(` (${club})`)).toBe(true)
      expect(line).toContain(name.split(' ').slice(-1)[0])
    }
    expect(seen).toBeGreaterThan(0)
  }, 120_000)
})

/** The greedy's score of a man in a slot: his role rating there times condition and sharpness. */
function slotScore(p: PlayerSeason, slot: Formation['slots'][number], t: Tactics, state: StateLookup): number {
  const mods = liveModifiers(state(p.id))
  return roleRating(p, getRole(t.roles[slot.id] ?? DEFAULT_ROLE[slot.position]), slot.position) * mods.condition * mods.sharpness
}

function total(f: Formation, lineup: Lineup, t: Tactics, state: StateLookup): number {
  return f.slots.reduce((sum, s) => sum + slotScore(u.index[lineup[s.id]], s, t, state), 0)
}

/** An assistant-drafted Season squad on its hub (`beginSeason` runs the assistant's `autoPick`). */
function seasonHub(seed: string, formationId: string): Game {
  const g = createGame({ mode: 'season', seed, formationId, teamName: 'Test XI', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

describe('the assistant’s eleven (round 6, item 6)', () => {
  it('plays the natural centre-back W. Reid, not N. Kanté (DM/CM) out of position, and Kanté in midfield', () => {
    // The greedy filled the centre-backs first and took Kanté (DM/CM, 0.86 there) over W. Reid, a natural one
    const g = seasonHub('cb-4-3-3-20', '4-3-3')
    const at = (slot: string) => u.index[g.lineup[slot]]
    const f = getFormation('4-3-3')
    for (const s of f.slots.filter((x) => x.position === 'CB')) expect(at(s.id).positions).toContain('CB')
    const kante = Object.keys(g.squad).find((id) => u.index[id].name === 'N. Kanté')!
    const slot = f.slots.find((s) => g.lineup[s.id] === kante)
    expect(slot && ['DM', 'CM'].includes(slot.position)).toBe(true)
  })

  it('leaves a cover in a slot only when he outscores every natural man left out, and never scores below the greedy', () => {
    let drafts = 0
    let before = 0
    let after = 0
    for (const formationId of ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '5-3-2']) {
      const f = getFormation(formationId)
      const t = defaultTactics(formationId)
      for (let i = 0; i < 24; i++) {
        const g = seasonHub(`r6-xi-${formationId}-${i}`, formationId)
        const pool = Object.keys(g.squad).map((id) => u.index[id])
        const state: StateLookup = (id) => g.squad[id]
        const greedy = autoPickLineup(f, pool, t, () => true, state).lineup
        const mine = assistantLineup(f, pool, t, () => true, state).lineup
        // The hub's eleven is the assistant's
        expect(g.lineup).toEqual(mine)
        expect(total(f, mine, t, state)).toBeGreaterThanOrEqual(total(f, greedy, t, state) - 1e-9)
        const xi = new Set(Object.values(mine))
        const out = pool.filter((p) => !xi.has(p.id))
        const coverBesideNatural = (lineup: Lineup) => f.slots.some((s) => positionFactor(u.index[lineup[s.id]], s.position) < 1 && pool.some((q) => !Object.values(lineup).includes(q.id) && q.positions.includes(s.position)))
        drafts++
        if (coverBesideNatural(greedy)) before++
        if (coverBesideNatural(mine)) after++
        for (const s of f.slots) {
          const p = u.index[mine[s.id]]
          if (positionFactor(p, s.position) >= 1) continue
          for (const q of out.filter((x) => x.positions.includes(s.position))) expect(slotScore(p, s, t, state)).toBeGreaterThanOrEqual(slotScore(q, s, t, state))
        }
      }
    }
    // Measured: 28 of 120 drafts before, 3 after (each a cover who outscores the natural man, Haaland at right wing over a 77 and the like)
    expect(before).toBeGreaterThan(drafts / 6)
    expect(after).toBeLessThan(before / 3)
  }, 120_000)

  it('is the greedy when every slot already holds a natural man, and the AI keeps the greedy', () => {
    const f = getFormation('4-3-3')
    const t = defaultTactics('4-3-3')
    let same = 0
    let natural = 0
    for (const cs of u.clubSeasons.filter((c) => c.season === 2019)) {
      const greedy = autoPickLineup(f, cs.squad, t).lineup
      if (f.slots.some((s) => positionFactor(u.index[greedy[s.id]], s.position) < 1)) continue
      natural++
      if (f.slots.every((s) => assistantLineup(f, cs.squad, t).lineup[s.id] === greedy[s.id])) same++
    }
    expect(natural).toBeGreaterThan(5)
    expect(same).toBe(natural)
  })
})
