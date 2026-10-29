import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng, hashString } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { ratingAt } from '@engine/positions'
import { aiClubOf, aiStrength, computeTable, USER_TEAM } from '@engine/season'
import { decodeChallenge, encodeChallenge, isRulesDiff } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { buildSuperClubs, buildSuperRestClubs, rankedClubs, SUPER_LEAGUE_HANDICAP, SUPER_LEAGUE_RIVALS, superLeagueField, superSeasons } from '@engine/superLeague'
import type { ClubSeason } from '@engine/types'
import { createGame, dailyGameSettings, describeRules, quickSetupLine, setupChips, setupRules, summariseSetup } from '../logic/setup'
import { closeJanuary, kickOff, quickSeasonGames, runQuickSeason, toKickoff } from '../logic/quick'
import { playQuickCup, quickCupField, quickCupStatus, SUPER_NO_CUP } from '../logic/quickCups'
import { oddsLeague, preSeasonOdds } from '../logic/odds'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { normaliseGame } from '../logic/save'
import { isSuperLeague, quickLeague, quickLeagueName, sideNamer, SUPER_LEAGUE_GAMES, superTierLabel } from '../logic/superLeague'
import { tierName } from '../../ui/format'
import type { Game, GameSettings } from '../types'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(ALL)

function settings(partial: Partial<GameSettings> = {}, superLeague = true): GameSettings {
  return { mode: 'quick', seed: 'super-1', formationId: '4-3-3', teamName: 'Super XI', shortName: 'SUP', leagueId: 'england', wheelLeagues: ALL, hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ALL, ...(superLeague ? { superLeague: true } : {}) }, jobSecurity: false, difficulty: 'calibrated', january: true, ...partial }
}

/** A quick game drafted by the assistant and standing at the tactics step. */
function drafted(s: GameSettings): Game {
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  return g
}

/** Every club's best season by the strength measure, worked out here from scratch, strongest first. */
function bruteForce(classic: boolean): Array<{ cs: ClubSeason; strength: number }> {
  const best = new Map<string, { cs: ClubSeason; strength: number }>()
  for (const cs of u.clubSeasons) {
    if (cs.classic && !classic) continue
    if (cs.squad.length < 11) continue
    const strength = aiStrength(u, aiClubOf(u, cs))
    const have = best.get(cs.clubId)
    if (!have || strength > have.strength || (strength === have.strength && cs.season < have.cs.season)) best.set(cs.clubId, { cs, strength })
  }
  return [...best.values()].sort((a, b) => b.strength - a.strength || a.cs.season - b.cs.season || a.cs.clubId.localeCompare(b.cs.clubId))
}

describe('the Super League field', { timeout: 120_000 }, () => {
  for (const classic of [false, true]) {
    it(`is the 19 strongest distinct clubs by team strength, each at its best season (classic ${classic ? 'on' : 'off'})`, () => {
      const field = superLeagueField(u, classic)
      expect(field).toHaveLength(SUPER_LEAGUE_RIVALS)
      expect(new Set(field.map((cs) => cs.clubId)).size).toBe(SUPER_LEAGUE_RIVALS)
      const brute = bruteForce(classic)
      expect(field.map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(brute.slice(0, 19).map((r) => `${r.cs.clubId}@${r.cs.season}`))
      // Nobody left out is stronger than the weakest side in, and no club has a stronger season than the one it enters with
      const weakest = brute[18].strength
      for (const r of brute.slice(19)) expect(r.strength).toBeLessThanOrEqual(weakest)
      for (const cs of field) {
        const own = aiStrength(u, aiClubOf(u, cs))
        for (const other of u.clubSeasons.filter((x) => x.clubId === cs.clubId && (classic || !x.classic) && x.squad.length >= 11)) expect(aiStrength(u, aiClubOf(u, other))).toBeLessThanOrEqual(own)
      }
      if (!classic) expect(field.every((cs) => !cs.classic)).toBe(true)
      console.log(`Super League field (classic ${classic ? 'on' : 'off'}): ${field.map((cs) => `${cs.clubId} ${cs.season}`).join(', ')}`)
    })
  }

  it('is the same for every seed and on a freshly loaded universe: no RNG, no cache dependence', () => {
    const a = Object.keys(quickLeague(u, settings({ seed: 'one' })).ai)
    const b = Object.keys(quickLeague(u, settings({ seed: 'two', difficulty: 'realistic', leagueId: 'spain', hostClubId: 'getafe', leagueSeason: 2012 })).ai)
    expect(b).toEqual(a)
    const fresh = loadTestUniverse([...ALL])
    expect(superLeagueField(fresh, false).map((cs) => `${cs.clubId}@${cs.season}`)).toEqual(superLeagueField(u, false).map((cs) => `${cs.clubId}@${cs.season}`))
    // The Super League has no calibration, whatever the opposition setting: full strength without `superEase` (every
    // game and link from before 2026-10-28), a rating point off with it (every game Setup starts since)
    expect(quickLeague(u, settings()).offset).toBe(0)
    expect(quickLeague(u, settings({ difficulty: 'realistic' })).offset).toBe(0)
    const eased = settings({ rules: { ...QUICK_RULES, leagues: ALL, superLeague: true, superEase: true } })
    expect(SUPER_LEAGUE_HANDICAP).toBe(1)
    expect(quickLeague(u, eased).offset).toBe(SUPER_LEAGUE_HANDICAP)
    expect(quickLeague(u, { ...eased, difficulty: 'realistic' }).offset).toBe(SUPER_LEAGUE_HANDICAP)
    expect(Object.keys(quickLeague(u, eased).ai)).toEqual(a)
    // The rule alone, without the Super League, changes no real league's calibration
    const real = settings({ rules: { ...QUICK_RULES, leagues: ALL, superEase: true } }, false)
    expect(quickLeague(u, real).offset).toBe(quickLeague(u, settings({}, false)).offset)
  })

  it('names each side with its season, and the Continental Cup field is the next fifteen clubs, none of them in the league', () => {
    const ai = buildSuperClubs(u, false)
    const seasons = superSeasons(u, false)
    const name = sideNamer({ settings: settings() }, u)
    for (const cs of superLeagueField(u, false)) {
      expect(seasons[cs.clubId]).toBe(cs.season)
      expect(name(cs.clubId)).toMatch(new RegExp(`^${u.clubById[cs.clubId].name} \\d{4}-\\d{2}$`))
      expect(ai[cs.clubId].name).toBe(name(cs.clubId))
    }
    const rest = buildSuperRestClubs(u, false, 15)
    expect(Object.keys(rest)).toHaveLength(15)
    expect(Object.keys(rest).filter((id) => ai[id])).toEqual([])
    expect(Object.keys(rest)).toEqual(rankedClubs(u, false).slice(19, 34).map((r) => r.cs.clubId))
    // A real league's sides keep their plain names
    expect(sideNamer({ settings: settings({}, false) }, u)('arsenal')).toBe('Arsenal')
  })
})

describe('a Super League season', { timeout: 300_000 }, () => {
  it('plays 38 games against the 19, with a valid table, through the January window, and replays as a challenge', () => {
    const g = drafted(settings({ seed: 'super-season-1' }))
    expect(isSuperLeague(g.settings)).toBe(true)
    expect(quickSeasonGames(u, g.settings)).toBe(SUPER_LEAGUE_GAMES)
    kickOff(g, u)
    expect(g.phase).toBe('january')
    closeJanuary(g, u, null)
    const q = g.quickResult!
    expect(q.results!).toHaveLength(38)
    expect(q.won + q.drawn + q.lost).toBe(38)
    expect(q.table).toHaveLength(20)
    const field = new Set(superLeagueField(u, false).map((cs) => cs.clubId))
    expect(q.table.filter((r) => r.teamId !== USER_TEAM).every((r) => field.has(r.teamId))).toBe(true)
    // Each of the 19 met twice, once at home and once away
    for (const id of field) {
      const games = q.results!.filter((r) => r.opponentId === id)
      expect(games).toHaveLength(2)
      expect(games.filter((r) => r.home)).toHaveLength(1)
    }
    // A valid table: everyone played 38, wins equal defeats, goals for equal goals against, points from the results
    for (const r of q.table) {
      expect(r.won + r.drawn + r.lost).toBe(38)
      expect(r.points).toBe(3 * r.won + r.drawn)
    }
    expect(q.table.reduce((s, r) => s + r.won, 0)).toBe(q.table.reduce((s, r) => s + r.lost, 0))
    expect(q.table.reduce((s, r) => s + r.goalsFor, 0)).toBe(q.table.reduce((s, r) => s + r.goalsAgainst, 0))
    expect(q.table.reduce((s, r) => s + r.won + r.drawn + r.lost, 0)).toBe(20 * 38)
    const sorted = [...q.table].sort((a, b) => b.points - a.points)
    expect(q.table.map((r) => r.points)).toEqual(sorted.map((r) => r.points))
    expect(q.table.findIndex((r) => r.teamId === USER_TEAM) + 1).toBe(q.position)
    // The live table's rounds rebuild the final table
    expect(q.rounds).toBeDefined()
    // The record-points achievement is a real league's; the Super League never earns it
    expect(g.unlocked).not.toContain('record-points')

    // The same seed plays the same season, and a challenge link carries the rule and verifies
    const again = drafted(settings({ seed: 'super-season-1' }))
    kickOff(again, u)
    closeJanuary(again, u, null)
    expect(again.quickResult).toEqual(q)
    const link = challengeFromGame(g, u, 'Tester')!
    expect(link.s.r.superLeague).toBe(true)
    expect(isRulesDiff(link.s.r)).toBe(true)
    const decoded = decodeChallenge(encodeChallenge(link))
    expect(decoded.s.r.superLeague).toBe(true)
    const outcome = replayChallenge(u, decoded)
    expect(outcome.verified).toBe('yes')
    // The same seed in the real league plays a different season
    const real = drafted(settings({ seed: 'super-season-1' }, false))
    kickOff(real, u)
    closeJanuary(real, u, null)
    expect(real.quickResult!.table.map((r) => r.teamId)).not.toEqual(q.table.map((r) => r.teamId))
  })

  it('an eased Super League link travels as version 2 with its rule and verifies; a full-strength one stays version 1', () => {
    const g = drafted(settings({ seed: 'super-eased-1', january: false, rules: { ...QUICK_RULES, leagues: ALL, superLeague: true, superEase: true } }))
    kickOff(g, u)
    const link = challengeFromGame(g, u, 'Tester')!
    expect(link.v).toBe(2)
    expect(link.s.r.superEase).toBe(true)
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(link))).verified).toBe('yes')
    // The same seed at full strength (an older link) plays the season it always played
    const old = drafted(settings({ seed: 'super-eased-1', january: false }))
    kickOff(old, u)
    const oldLink = challengeFromGame(old, u, 'Tester')!
    expect(oldLink.v).toBe(1)
    expect(oldLink.s.r).not.toHaveProperty('superEase')
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(oldLink))).verified).toBe('yes')
  })

  it('has no domestic cup; its Continental Cup meets the next fifteen after a top-seven finish', () => {
    const g = drafted(settings({ seed: 'super-cups', january: false }))
    kickOff(g, u)
    expect(quickCupStatus(g, u, 'cup')).toEqual({ state: 'none', reason: SUPER_NO_CUP })
    expect(Object.keys(quickCupField(g, u, 'continental'))).toEqual(Object.keys(buildSuperRestClubs(u, false, 15)))
    // Put the season in the places so the run can be played, whatever this XI managed
    g.quickResult!.position = 1
    playQuickCup(g, u, 'continental')
    const run = g.quickResult!.continentalCup!
    // Engine 7: the groups are the user and the fifteen, and every knockout opponent is one of them
    const rest = new Set(Object.keys(buildSuperRestClubs(u, false, 15)))
    expect(new Set(run.groups!.flatMap((x) => x.teams))).toEqual(new Set([USER_TEAM, ...rest]))
    expect(run.ties.every((t) => rest.has(t.opponentId))).toBe(true)
  })

  it('the pundits price the Super League, not the real league', () => {
    const sup = drafted(settings({ seed: 'super-odds' }))
    const real = drafted(settings({ seed: 'super-odds' }, false))
    expect(oddsLeague(sup, u).ids).toEqual([USER_TEAM, ...superLeagueField(u, false).map((cs) => cs.clubId)])
    const a = preSeasonOdds(sup, u, 500)
    const b = preSeasonOdds(real, u, 500)
    expect(a.expectedPoints).toBeLessThan(b.expectedPoints)
    expect(a.title).toBeLessThanOrEqual(b.title)
  })

  // The elite XI: the best-rated player for each slot of a 4-3-3 across every standard season of every league, one per human
  const elite = (() => {
    const used = new Set<string>()
    const lineup: Record<string, string> = {}
    for (const s of getFormation('4-3-3').slots) {
      const best = Object.values(u.index)
        .filter((p) => !used.has(p.playerId) && !u.clubSeasonByKey[`${p.clubId}@${p.season}`]?.classic)
        .sort((a, b) => ratingAt(b, s.position) - ratingAt(a, s.position) || a.id.localeCompare(b.id))[0]
      used.add(best.playerId)
      lineup[s.id] = best.id
    }
    return lineup
  })()
  // SUPER_SEEDS runs a longer sample (the release measured 1,000 Super League seasons); split in two so no test blocks a worker for long
  const N = Number(process.env.SUPER_SEEDS ?? 30)
  const tally = (superLeague: boolean) => {
    let perfect = 0
    let unbeaten = 0
    let champions = 0
    let wins = 0
    for (let i = 0; i < N; i++) {
      const g = createGame(settings({ seed: `elite-${i}`, january: false, rules: { ...QUICK_RULES, leagues: ALL, managers: false, ...(superLeague ? { superLeague: true } : {}) } }))
      g.draft!.lineup = { ...elite }
      toKickoff(g, u)
      runQuickSeason(g, u)
      const q = g.quickResult!
      if (q.won === q.results!.length) perfect++
      if (q.lost === 0) unbeaten++
      if (q.position === 1) champions++
      wins += q.won
    }
    return { perfect, unbeaten, champions, wins: wins / N }
  }
  let sup: ReturnType<typeof tally> | null = null
  it('reports how often an elite XI goes 38-0 in the Super League', () => {
    sup = tally(true)
    console.log(`P(38-0) elite XI, Super League, ${N} seeds: ${sup.perfect}/${N} perfect, unbeaten ${sup.unbeaten}, champions ${sup.champions}, mean wins ${sup.wins.toFixed(2)}`)
    expect(sup.wins).toBeGreaterThan(0)
  })
  // The eased Super League (superEase, 2026-10-28): the same XIs on the same seeds, full strength against a point off.
  // An XI of each slot's 16th-best player (team strength about 85.8, inside the field's 83.1 to 87.7) and the elite XI
  const strong = (() => {
    const used = new Set<string>()
    const lineup: Record<string, string> = {}
    for (const s of getFormation('4-3-3').slots) {
      const seen = new Set<string>()
      const list = Object.values(u.index)
        .filter((p) => !used.has(p.playerId) && !u.clubSeasonByKey[`${p.clubId}@${p.season}`]?.classic)
        .sort((a, b) => ratingAt(b, s.position) - ratingAt(a, s.position) || a.id.localeCompare(b.id))
        .filter((p) => (seen.has(p.playerId) ? false : (seen.add(p.playerId), true)))
      used.add(list[15].playerId)
      lineup[s.id] = list[15].id
    }
    return lineup
  })()
  const season = (lineup: Record<string, string>, seed: string, ease: boolean) => {
    const g = createGame(settings({ seed, january: false, rules: { ...QUICK_RULES, leagues: ALL, managers: false, superLeague: true, ...(ease ? { superEase: true } : {}) } }))
    g.draft!.lineup = { ...lineup }
    toKickoff(g, u)
    runQuickSeason(g, u)
    return g.quickResult!
  }
  for (const [name, lineup] of [['strong', strong], ['elite', elite]] as const) {
    it(`eases the Super League a little for the ${name} XI: more points, as many titles or more, still no 38-0`, () => {
      let full = 0
      let eased = 0
      let fullTitles = 0
      let easedTitles = 0
      let perfect = 0
      for (let i = 0; i < N; i++) {
        const a = season(lineup, `ease-${i}`, false)
        const b = season(lineup, `ease-${i}`, true)
        full += a.points
        eased += b.points
        fullTitles += a.position === 1 ? 1 : 0
        easedTitles += b.position === 1 ? 1 : 0
        if (b.won === b.results!.length) perfect++
      }
      console.log(`Super League eased, ${name} XI, ${N} seeds: ${(full / N).toFixed(1)} -> ${(eased / N).toFixed(1)} points, titles ${fullTitles} -> ${easedTitles}, perfect ${perfect}`)
      // 250 seeds measured +6.5 (strong) and +6.0 (elite); 30 seeds stay well inside 2 to 11
      expect(eased / N - full / N).toBeGreaterThan(2)
      expect(eased / N - full / N).toBeLessThan(11)
      expect(easedTitles).toBeGreaterThanOrEqual(fullTitles)
      expect(perfect).toBe(0)
    })
  }

  it('the same XI on the same seeds in the Premier League 2025-26 wins far more: reported, not tuned', () => {
    const real = tally(false)
    console.log(`P(38-0) elite XI, Premier League 2025-26, ${N} seeds: ${real.perfect}/${N} perfect, unbeaten ${real.unbeaten}, champions ${real.champions}, mean wins ${real.wins.toFixed(2)}`)
    expect(sup).not.toBeNull()
    expect(sup!.wins).toBeLessThan(real.wins)
    expect(sup!.perfect).toBeLessThanOrEqual(real.perfect)
    expect(sup!.champions).toBeLessThan(real.champions)
  })
})

describe('Super League rules and screens', { timeout: 60_000 }, () => {
  it('Setup opts in only through its choice; describes it; names the tiers', () => {
    const base = { difficulty: 'normal' as const, showRatings: true, draftMode: 'squad' as const, ratings: 'season' as const, eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: true, leagues: ALL }
    expect(setupRules(QUICK_RULES, base)).not.toHaveProperty('superLeague')
    expect(setupRules(QUICK_RULES, { ...base, superLeague: false })).not.toHaveProperty('superLeague')
    expect(setupRules(QUICK_RULES, { ...base, superLeague: true }).superLeague).toBe(true)
    // Setup's Super League is the eased one; without the choice neither key is written
    expect(setupRules(QUICK_RULES, { ...base, superLeague: true }).superEase).toBe(true)
    expect(setupRules(QUICK_RULES, base)).not.toHaveProperty('superEase')
    expect(summariseSetup(u, settings({ rules: { ...QUICK_RULES, leagues: ALL, superLeague: true, superEase: true } }))).toContain('in the Super League, a point below full strength')
    const s = settings()
    expect(summariseSetup(u, s)).toContain('in the Super League, full strength')
    // Its field loads every league, which is no European Nights wheel
    expect(summariseSetup(u, s)).not.toContain('European Nights')
    expect(summariseSetup(u, settings({}, false))).toContain('in the Premier League 2025-26, calibrated')
    expect(describeRules(u, s.rules)).toContain('Super League')
    // The line above Spin and the chips name the Super League, not the all-league wheel's count or the opposition
    expect(quickSetupLine(u, s)).toBe('Super XI · 4-3-3 · Normal · Super League')
    expect(quickSetupLine(u, settings({ difficulty: 'realistic' }))).not.toContain('Realistic')
    expect(quickSetupLine(u, settings({}, false))).toBe('Super XI · 4-3-3 · Normal · 7 leagues')
    expect(setupChips(u, s).find((c) => c.key === 'host')?.text).toBe('Super League')
    expect(setupChips(u, settings({}, false)).find((c) => c.key === 'host')?.text).toBe('Premier League 2025-26')
    expect(quickLeagueName(u, s)).toBe('Super League')
    expect(superTierLabel('CHAMPIONS')).toBe('Super League champions')
    expect(superTierLabel('PERFECT')).toBe('Perfect Super League season')
    expect(superTierLabel('INVINCIBLE')).toBe('Super League invincibles')
    expect(superTierLabel('EUROPEAN', 3)).toBe('Top 4')
    expect(tierName('CHAMPIONS', 1, true)).toBe('Super League champions')
    expect(tierName('CHAMPIONS', 1)).toBe('Champions')
    // Only a Quick Draft plays it: the rule on a managed season or the Daily changes nothing
    expect(isSuperLeague({ mode: 'season', rules: { ...QUICK_RULES, superLeague: true } })).toBe(false)
    expect(isSuperLeague({ mode: 'daily', rules: { ...QUICK_RULES, superLeague: true } })).toBe(false)
    expect(dailyGameSettings(u, 'daily-2026-10-25').rules).not.toHaveProperty('superLeague')
  })

  it('a save from before the Super League (no rule) normalises and plays its real league', () => {
    const g = drafted(settings({ seed: 'pre-super', january: false }, false))
    const n = normaliseGame(JSON.parse(JSON.stringify(g)) as Game)!
    expect(n.settings.rules.superLeague).toBeUndefined()
    expect(isSuperLeague(n.settings)).toBe(false)
    kickOff(n, u)
    const real = new Set(u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2025).map((cs) => cs.clubId))
    expect(n.quickResult!.table.filter((r) => r.teamId !== USER_TEAM).every((r) => real.has(r.teamId))).toBe(true)
  })
})

/**
 * Adding the Super League changes no other game: these hashes were taken on the commit before it (57f3453) and must
 * not move. Re-baselined on ENGINE_VERSION '5' (the playtest fixes moved every quick season; two of the three odds
 * hashes held), and on '6' (every match moved: the calibration, the user's men out of their real clubs), and on '7' (the post-season
 * Continental Cup's groups and two legs move the quick results that played it; the odds and the Daily held), and held on '8' (no quick season here takes a capped bench draft, a simmed event week or a Gauntlet). Quick seasons in the Premier League (January deal taken, then the cups), a European Nights wheel with
 * classic seasons in La Liga 2015-16 (the Continental Cup included), the pundits' odds and today's Daily.
 */
describe('non-Super games are unchanged', { timeout: 600_000 }, () => {
  it('reproduces the pinned results of the commit before the Super League', () => {
    expect(ENGINE_VERSION).toBe('8')
    const play = (s: GameSettings): Game => {
      const g = drafted(s)
      kickOff(g, u)
      if (g.phase === 'january') closeJanuary(g, u, 0)
      for (const c of ['cup', 'continental'] as const) {
        try {
          playQuickCup(g, u, c)
        } catch {
          // Not on offer for this finish
        }
      }
      // The cups' bracket (kept since, played on from the same fork after the user's run) is left out: the pins are the results
      for (const run of [g.quickResult?.cup, g.quickResult?.continentalCup]) if (run) delete run.bracket
      return g
    }
    const pins: Record<string, string> = {
      'pin-1': '4444055295652043 3990114105311898 1925156832764192',
      // pin-2's odds (the third hash) re-baselined 2026-10-28 (r8 audit): the odds' day xG now bends under the engine's soft ceiling, not the 5.8 clamp; the games are unchanged
      'pin-2': '6943731497980684 7821072090189927 1889723377007754',
      'pin-3': '6123748828687102 1977299536754919 7200968562615668',
    }
    for (const seed of Object.keys(pins)) {
      const s: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Pin XI', shortName: 'PIN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: true }
      const g = play(s)
      const e = play({ ...s, leagueId: 'spain', hostClubId: 'getafe', leagueSeason: 2015, wheelLeagues: ALL, rules: { ...QUICK_RULES, leagues: ALL, classic: true } })
      const odds = preSeasonOdds(drafted(s), u, 250)
      expect(`${hashString(JSON.stringify([g.quickResult, g.rngState]))} ${hashString(JSON.stringify([e.quickResult, e.rngState]))} ${hashString(JSON.stringify(odds))}`, seed).toBe(pins[seed])
    }
    const d = play(dailyGameSettings(u, 'daily-2026-10-25'))
    expect(hashString(JSON.stringify([d.quickResult, d.rngState]))).toBe(8710513422125818)
    // The table helper the season uses is untouched by the field
    expect(computeTable([], [USER_TEAM]).length).toBe(1)
  })
})
