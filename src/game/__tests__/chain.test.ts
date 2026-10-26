import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, isComplete, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { ACHIEVEMENTS } from '@engine/awards'
import { decodeChallenge, encodeChallenge, payloadVersionFor, rulesDiff, rulesFromPayload } from '@engine/challenge'
import { beginSeason, createGame, summariseSetup } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { challengeFromGame, challengeSettings, replayChallenge, settingsFromChallenge } from '../logic/challenge'
import { chainCodes, chainLine, chainOfGame, chainRecord, earnsChainChampions } from '../logic/chain'
import { normaliseGame } from '../logic/save'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse()

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'quick',
    seed: 'CHAIN-1',
    formationId: '4-3-3',
    teamName: 'Chain XI',
    shortName: 'CHN',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...QUICK_RULES, leagues: ['england'], chain: true },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function drafted(partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

describe('the teammate chain: lines and links', () => {
  it('an unbroken quick chain counts its links, prints its club codes and names itself in the setup line', () => {
    const g = drafted()
    runQuickSeason(g, u)
    const c = chainOfGame(g)!
    expect(c.clubs).toHaveLength(11)
    expect(c.broken).toEqual([])
    expect(chainLine(g)).toBe('🔗 Teammate chain · 11 links')
    const codes = chainCodes(u, g)!
    expect(codes).toHaveLength(1)
    expect(codes[0].split('→')).toEqual(c.clubs.map((id) => u.clubById[id].code))
    expect(summariseSetup(u, g.settings)).toContain('teammate chain')
    // Without the chain, nothing is said
    const plain = drafted({ rules: { ...QUICK_RULES, leagues: ['england'] } })
    runQuickSeason(plain, u)
    expect(chainOfGame(plain)).toBeNull()
    expect(chainLine(plain)).toBeNull()
    expect(chainCodes(u, plain)).toBeNull()
    expect(summariseSetup(u, plain.settings)).not.toContain('chain')
  })

  it('a broken chain says how often it broke, and the card marks each break', () => {
    // One nation narrows the teammates until the chain breaks; the record keeps where
    let seen = 0
    for (let i = 0; i < 10; i++) {
      const g = drafted({ seed: `chain-bra-${i}`, rules: { ...QUICK_RULES, leagues: ['england'], chain: true, onlyNation: 'BRA' } })
      const c = chainRecord(g.draft!)
      const rows = g.draft!.history.filter((h) => h.pickedId)
      expect(c.broken).toEqual(rows.flatMap((h, j) => (h.chainBroken ? [j] : [])))
      if (!c.broken.length) continue
      seen++
      const n = c.broken.length
      expect(chainLine(g)).toBe(`🔗 Teammate chain · broken ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`}`)
      expect(chainCodes(u, g)!.join('').split('/')).toHaveLength(n + 1)
    }
    expect(seen).toBeGreaterThan(3)
  }, 30000)

  it('the rule is off unless set: an unset or false chain adds nothing to a link, a set one makes it v2', () => {
    // Main's rulesDiff always writes the difficulty and the manager rule; nothing else, so no chain key
    expect(rulesDiff({ ...QUICK_RULES, leagues: ['england'], chain: undefined })).toEqual({ difficulty: 'normal', managers: true })
    expect(payloadVersionFor(rulesDiff({ ...QUICK_RULES, chain: true }), 'quick')).toBe(2)
  })

  it('a chain link travels as v2, round-trips, replays and verifies; without the chain the picks do not replay', () => {
    const g = drafted({ seed: 'GHOST-CHAIN' })
    runQuickSeason(g, u)
    const c = challengeFromGame(g, u, 'Minh')!
    expect(c.v).toBe(2)
    expect(c.s.r).toEqual({ difficulty: 'normal', managers: true, chain: true })
    const back = decodeChallenge(encodeChallenge(c))
    expect(back).toEqual(c)
    expect(rulesFromPayload(back).chain).toBe(true)
    const out = replayChallenge(u, back)
    expect(out.verified).toBe('yes')
    expect(out.result).toEqual(c.c)
    expect(settingsFromChallenge(back, 'Friend XI', 'FXI', challengeSettings(back, out)).rules.chain).toBe(true)
    // The same picks on a wheel without the chain land elsewhere
    expect(replayChallenge(u, { ...back, s: { ...back.s, r: {} } }).verified).toBe('no')
  }, 30000)
})

describe('Dressing Room', () => {
  it('is a title with an unbroken chain, in the chain\'s own season', () => {
    expect(ACHIEVEMENTS.some((a) => a.id === 'chain-champions')).toBe(true)
    const game = (chain: boolean | undefined, broken: number[], mode: GameSettings['mode'] = 'quick', year = 1) => ({ year, settings: { mode, rules: { chain } }, teammateChain: { clubs: ['arsenal', 'chelsea'], broken } })
    expect(earnsChainChampions(game(true, []))).toBe(true)
    expect(earnsChainChampions(game(true, [1]))).toBe(false)
    expect(earnsChainChampions(game(undefined, []))).toBe(false)
    expect(earnsChainChampions(game(true, [], 'season'))).toBe(true)
    expect(earnsChainChampions(game(true, [], 'dynasty', 2))).toBe(false)
  })

  it('the quick season unlocks it on a chained title and only then', () => {
    // Seeds found by sweeping 60 chained England drafts (2 titles, mean 50.6 points; unchained 16 titles, 69.6); re-swept
    // over 100 on main's Quick Draft defaults when main merged in (titles on 53 and 78, both unbroken), and on ENGINE_VERSION
    // '5' (titles on 4 and 53, both unbroken)
    for (const [seed, champion] of [['chain-measure-53', true], ['chain-measure-4', true], ['chain-measure-0', false]] as const) {
      const g = drafted({ seed })
      runQuickSeason(g, u)
      expect(g.quickResult!.position === 1, seed).toBe(champion)
      expect(chainOfGame(g)!.broken, seed).toEqual([])
      expect(g.unlocked.includes('chain-champions'), seed).toBe(champion)
    }
    // The same title without the chain earns nothing of the kind
    const plain = drafted({ seed: 'chain-measure-53', rules: { ...QUICK_RULES, leagues: ['england'] } })
    runQuickSeason(plain, u)
    expect(plain.unlocked).not.toContain('chain-champions')
  }, 60000)
})

describe('the teammate chain in a managed season', () => {
  it('binds the first draft only: its record outlives the draft, and the Dynasty summer draft has no chain', () => {
    const g = drafted({ mode: 'dynasty', seed: 'chain-dynasty', leagueSeason: 2015, hostClubId: 'leicester-city', rules: { ...SEASON_RULES, leagues: ['england'], chain: true } })
    expect(isComplete(g.draft!)).toBe(true)
    const record = chainRecord(g.draft!)
    expect(record.clubs).toHaveLength(18)
    beginSeason(g, u)
    expect(g.draft).toBeNull()
    expect(g.teammateChain).toEqual(record)
    expect(chainOfGame(g)).toEqual(record)
    expect(chainLine(g)).toMatch(/^🔗 Teammate chain · /)
    // Eighteen codes take two lines of the card, the second carrying the chain on
    const lines = chainCodes(u, g)!
    expect(lines).toHaveLength(2)
    expect(lines[0].split(/[→/]/)).toHaveLength(11)
    expect(lines[1]).toMatch(/^[→/]/)
    expect(lines.join('').split(/[→/]/)).toEqual(record.clubs.map((id) => u.clubById[id].code))
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    expect(g.unlocked.includes('chain-champions')).toBe(g.history.at(-1)!.position === 1 && record.broken.length === 0)
    advanceToNextSeason(g, u)
    expect(g.phase).toBe('draft')
    expect(g.draft!.rules.chain).toBeUndefined()
    expect(g.settings.rules.chain).toBe(true)
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    expect(g.draft!.chainFrom).toBeUndefined()
    beginSeason(g, u)
    // Year two is the market's: the chain no longer reads on the summary
    expect(chainOfGame(g)).toBeNull()
    expect(chainLine(g)).toBeNull()
  }, 120000)

  it('an older save, from before the chain, reads as unchained', () => {
    const g = drafted({ rules: { ...QUICK_RULES, leagues: ['england'] } })
    runQuickSeason(g, u)
    const old = JSON.parse(JSON.stringify(g)) as Game
    delete (old as unknown as Record<string, unknown>).teammateChain
    const n = normaliseGame(old)!
    expect(n.settings.rules.chain).toBeUndefined()
    expect(chainOfGame(n)).toBeNull()
    expect(earnsChainChampions(n)).toBe(false)
  })
})
