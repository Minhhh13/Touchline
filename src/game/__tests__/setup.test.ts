import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { DAILY_FORMATIONS, DAILY_RULES, DEFAULT_HOST_POSITION, dailyGameSettings, dailySettings, defaultHostClub, setupChips, shortNameFor, summariseSetup } from '../logic/setup'
import { FUN_TEAM_NAMES, randomTeamName } from '../logic/teamNames'
import { POWER_UPS_ICON } from '@engine/powerups'
import type { GameSettings } from '../types'

const u = loadTestUniverse()

/** The clubs with a squad in an English season, sorted by name the way the setup screen lists them. */
function clubsIn(season: number): string[] {
  return u.clubSeasons
    .filter((cs) => cs.leagueId === 'england' && cs.season === season)
    .map((cs) => cs.clubId)
    .sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b))
}

describe('the Daily puzzle', () => {
  it('maps a date to its season, host and formation exactly as the setup screen always has', () => {
    // Pinned: 25 October 2026 reads as 20261025, which indexes the complete English seasons, their clubs sorted by
    // id (times seven) and the five shapes (times three). Changing any of these changes everyone's puzzle.
    const d = dailySettings(u, 'daily-2026-10-25')
    expect(d).toEqual({ seed: 'daily-2026-10-25', leagueId: 'england', wheelLeagues: ['england'], season: 2017, host: 'swansea-city', formationId: '4-3-3', difficulty: 'calibrated', rules: { ...DAILY_RULES, leagues: ['england'] }, january: true, continental: false })
    const other = dailySettings(u, 'daily-2026-01-01')
    expect(other.season).toBe(2011)
    expect(other.host).toBe('liverpool')
    expect(other.formationId).toBe('3-5-2')
  })

  it('only ever names a complete English season, one of its clubs and one of its five shapes', () => {
    for (let day = 1; day <= 28; day++) {
      const d = dailySettings(u, `daily-2027-03-${String(day).padStart(2, '0')}`)
      const cs = u.clubSeasons.find((x) => x.clubId === d.host && x.season === d.season && x.leagueId === 'england')
      expect(cs?.complete).toBe(true)
      expect(DAILY_FORMATIONS).toContain(d.formationId)
    }
    // A malformed seed still lands on a puzzle rather than crashing
    const junk = dailySettings(u, 'garbage')
    expect(junk.host).toBeTruthy()
  })

  it('builds the complete settings for a direct start from the Home card, the team name being the only choice', () => {
    const s = dailyGameSettings(u, 'daily-2026-10-25')
    expect(s.mode).toBe('daily')
    expect(s.teamName).toBe('Touchline XI')
    expect(s.shortName).toBe('TX')
    expect(s.seed).toBe('daily-2026-10-25')
    expect(s.hostClubId).toBe('swansea-city')
    expect(s.leagueSeason).toBe(2017)
    expect(s.formationId).toBe('4-3-3')
    expect(s.rules).toEqual({ ...QUICK_RULES, respins: 2, twists: true, leagues: ['england'] })
    // The rules come from the Daily's own literal, not the quick defaults
    expect(s.rules).toEqual({ ...DAILY_RULES, leagues: ['england'] })
    expect(s.jobSecurity).toBe(false)
    expect(s.difficulty).toBe('calibrated')
    expect(s.continental).toBe(false)
    const named = dailyGameSettings(u, 'daily-2026-10-25', '  Red Star Ten  ')
    expect(named.teamName).toBe('Red Star Ten')
    expect(named.shortName).toBe('RST')
    expect(dailyGameSettings(u, 'daily-2026-10-25', '   ').teamName).toBe('Touchline XI')
  })

  it('derives the scoreboard code from the initials, or the first letters of a one-word name', () => {
    expect(shortNameFor('Touchline XI')).toBe('TX')
    expect(shortNameFor('Real Madrid Castilla Reserves')).toBe('RMC')
    expect(shortNameFor('Arsenal')).toBe('ARS')
    expect(shortNameFor('ab')).toBe('AB')
  })
})

describe('the default host club', () => {
  it('is the club nearest tenth in the real table of that season', () => {
    const clubs = clubsIn(2025)
    const host = defaultHostClub(u, 'england', 2025, clubs)
    const row = u.tables.england[2025].find((r) => r.clubId === host)!
    expect(row.position).toBe(DEFAULT_HOST_POSITION)
    expect(host).toBe('chelsea')
    // The alphabetical middle it replaces was an arbitrary club
    expect(clubs[Math.floor(clubs.length / 2)]).not.toBe(host)
  })

  it('takes the nearest place when tenth has no squad, higher place first on a tie', () => {
    const clubs = clubsIn(2025).filter((c) => c !== 'chelsea')
    const host = defaultHostClub(u, 'england', 2025, clubs)
    expect(u.tables.england[2025].find((r) => r.clubId === host)!.position).toBe(9)
  })

  it('falls back to the alphabetical middle when the table is missing', () => {
    const clubs = clubsIn(2025)
    expect(defaultHostClub(u, 'england', 1999, clubs)).toBe(clubs[Math.floor(clubs.length / 2)])
    expect(defaultHostClub(u, 'nowhere', 2025, clubs)).toBe(clubs[Math.floor(clubs.length / 2)])
    expect(defaultHostClub(u, 'england', 2025, [])).toBe('')
  })
})

describe('the choice summary line', () => {
  const base: GameSettings = {
    mode: 'quick',
    seed: 'K7Q2-MX9A',
    formationId: '4-3-3',
    teamName: 'Touchline XI',
    shortName: 'TXI',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'brentford',
    leagueSeason: 2025,
    rules: { ...QUICK_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
  }

  it('states the name, shape, host, league season, difficulty and seed in one line', () => {
    // Twists are the quick draft's default, so the default line does not mention them
    expect(QUICK_RULES.twists).toBe(true)
    expect(summariseSetup(u, base)).toBe('Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed K7Q2-MX9A')
  })

  it('names twists only when they differ from the default of the mode', () => {
    expect(summariseSetup(u, { ...base, rules: { ...base.rules, twists: false } })).toBe('Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed K7Q2-MX9A, no twists')
    expect(SEASON_RULES.twists).toBe(false)
    expect(summariseSetup(u, { ...base, mode: 'season', jobSecurity: true, rules: { ...SEASON_RULES, twists: true, leagues: ['england'] } })).toBe('Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed K7Q2-MX9A, twists, squad of 18')
    // The Daily always plays with twists, which is the quick default, so its line stays short
    expect(summariseSetup(u, dailyGameSettings(u, 'daily-2026-10-25'))).toBe('Touchline XI, 4-3-3, as Swansea City in the Premier League 2017-18, calibrated, seed daily-2026-10-25')
  })

  it('appends only the choices that are off the defaults', () => {
    const line = summariseSetup(u, {
      ...base,
      mode: 'season',
      difficulty: 'realistic',
      wheelLeagues: ['england', 'spain'],
      rules: { ...SEASON_RULES, squadSize: 20, fromSeason: 2014, toSeason: 2019, hardMode: true, twists: true, onlyClub: 'arsenal', leagues: ['england', 'spain'] },
      jobSecurity: false,
      continental: true,
    })
    expect(line).toBe('Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, realistic, seed K7Q2-MX9A, European Nights wheel of 2 leagues, 2014-15 to 2019-20, Arsenal only, hard mode, twists, squad of 20, no sack, Continental Cup')
    const quiet = summariseSetup(u, { ...base, mode: 'season', rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true })
    expect(quiet).toBe('Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed K7Q2-MX9A, squad of 18')
  })
})

describe('the chip row above Start', () => {
  const base: GameSettings = {
    mode: 'quick',
    seed: 'K7Q2-MX9A',
    formationId: '4-3-3',
    teamName: 'Touchline XI',
    shortName: 'TXI',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'brentford',
    leagueSeason: 2025,
    rules: { ...QUICK_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
  }
  const texts = (s: GameSettings) => setupChips(u, s).map((c) => c.text)

  it('always shows the shape, the club and season, the opposition and the seed, and nothing else at the defaults', () => {
    expect(texts(base)).toEqual(['4-3-3', 'Brentford 2025-26', 'Calibrated', 'Seed K7Q2-MX9A'])
    expect(setupChips(u, base).map((c) => c.key)).toEqual(['formation', 'host', 'opposition', 'seed'])
    // The Daily's chips state its fixed shape, club and season
    expect(texts(dailyGameSettings(u, 'daily-2026-10-25'))).toEqual(['4-3-3', 'Swansea City 2017-18', 'Calibrated', 'Seed daily-2026-10-25'])
  })

  it('adds a short chip for each choice off the defaults, the same ones the summary line names', () => {
    const managed: GameSettings = {
      ...base,
      mode: 'season',
      difficulty: 'realistic',
      wheelLeagues: ['england', 'spain'],
      rules: { ...SEASON_RULES, squadSize: 20, fromSeason: 2014, toSeason: 2019, hardMode: true, twists: true, onlyClub: 'arsenal', leagues: ['england', 'spain'] },
      jobSecurity: false,
      continental: true,
    }
    expect(texts(managed)).toEqual(['4-3-3', 'Brentford 2025-26', 'Realistic', 'Seed K7Q2-MX9A', '🌍 2 leagues', '2014-15 to 2019-20', 'Arsenal only', 'Hard', 'Twists', 'Squad of 20', 'No sack', 'Continental Cup'])
    const quick = texts({ ...base, january: false, continental: true, rules: { ...base.rules, benchPicks: 3, twists: false, modes: ['speedrun'], powerUps: true } })
    expect(quick.slice(4)).toEqual(['No twists', '⏱️ Speedrun', `${POWER_UPS_ICON} Power-ups`, 'No January', 'Bench 3', 'Continental run'])
    // Every chip stays short enough for a phone row
    for (const t of [...texts(managed), ...quick]) expect(t.length).toBeLessThanOrEqual(28)
  })
})

describe('the Randomise button for the team name', () => {
  it('only holds invented names: none is a club in any league pack, and each fits the field', () => {
    const all = loadTestUniverse(u.available.map((l) => l.id))
    const real = new Set(all.clubs.flatMap((c) => [c.name, c.shortName]).map((n) => n.toLowerCase()))
    expect(all.clubs.length).toBeGreaterThan(200)
    expect(new Set(FUN_TEAM_NAMES).size).toBe(FUN_TEAM_NAMES.length)
    for (const name of FUN_TEAM_NAMES) {
      expect(real.has(name.toLowerCase())).toBe(false)
      expect(name.length).toBeLessThanOrEqual(24)
      expect(name).not.toBe('Touchline XI')
    }
  })

  it('reaches every name across rolls and never repeats the one in the field', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const roll = i / 400
      const current = FUN_TEAM_NAMES[i % FUN_TEAM_NAMES.length]
      const next = randomTeamName(roll, current)
      expect(next).not.toBe(current)
      expect(FUN_TEAM_NAMES).toContain(next)
      seen.add(randomTeamName(roll))
    }
    expect(seen.size).toBe(FUN_TEAM_NAMES.length)
    // A roll at the edge of the range still lands on a name
    expect(FUN_TEAM_NAMES).toContain(randomTeamName(0.9999999))
    expect(FUN_TEAM_NAMES).toContain(randomTeamName(1))
  })

  it("never gives a head-to-head manager the other manager's name, whatever the case or spacing", () => {
    for (let i = 0; i < 400; i++) {
      const roll = i / 400
      const other = FUN_TEAM_NAMES[Math.floor(roll * FUN_TEAM_NAMES.length)]
      const mine = FUN_TEAM_NAMES[(i * 7) % FUN_TEAM_NAMES.length]
      const next = randomTeamName(roll, mine, [`  ${other.toUpperCase()} `])
      expect(next).not.toBe(other)
      expect(next).not.toBe(mine)
    }
  })
})
