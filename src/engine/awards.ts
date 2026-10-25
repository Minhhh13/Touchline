/**
 * End-of-season awards, team of the season, records and share text.
 */
import type { PlayerSeason, SquadPlayer, TableRow, SeasonTier, Position } from './types'
import { FORMATION_BY_ID } from './formations'
import { tierLabel } from './season'

export interface AwardWinner {
  playerSeasonId: string
  name: string
  value: string
}

export interface SeasonAwards {
  playerOfTheSeason?: AwardWinner
  goldenBoot?: AwardWinner
  playmaker?: AwardWinner
  goldenGlove?: AwardWinner
  youngPlayer?: AwardWinner
  teamOfTheSeason: Array<{ slotId: string; position: Position; playerSeasonId: string; name: string; avgRating: number }>
}

export function computeAwards(squad: Array<{ p: PlayerSeason; s: SquadPlayer }>, matchweeks = 38): SeasonAwards {
  const withApps = squad.filter((x) => x.s.seasonStats.apps > 0)
  const avg = (x: { s: SquadPlayer }) => (x.s.seasonStats.apps ? x.s.seasonStats.ratingSum / x.s.seasonStats.apps : 0)
  const qualified = withApps.filter((x) => x.s.seasonStats.apps >= Math.min(15, Math.max(5, Math.floor(matchweeks * 0.4))))
  const pots = [...qualified].sort((a, b) => avg(b) - avg(a))[0]
  const boot = [...withApps].sort((a, b) => b.s.seasonStats.goals - a.s.seasonStats.goals || avg(b) - avg(a))[0]
  const pm = [...withApps].sort((a, b) => b.s.seasonStats.assists - a.s.seasonStats.assists || avg(b) - avg(a))[0]
  const gk = [...withApps].filter((x) => x.p.positions[0] === 'GK').sort((a, b) => b.s.seasonStats.cleanSheets - a.s.seasonStats.cleanSheets || avg(b) - avg(a))[0]
  const young = [...qualified].filter((x) => x.p.age <= 23).sort((a, b) => avg(b) - avg(a))[0]

  const f = FORMATION_BY_ID['4-3-3']
  const used = new Set<string>()
  const tots: SeasonAwards['teamOfTheSeason'] = []
  for (const slot of f.slots) {
    const best = [...qualified].filter((x) => !used.has(x.p.id) && x.p.positions.includes(slot.position)).sort((a, b) => avg(b) - avg(a))[0] ?? [...qualified].filter((x) => !used.has(x.p.id)).sort((a, b) => avg(b) - avg(a))[0]
    if (!best) continue
    used.add(best.p.id)
    tots.push({ slotId: slot.id, position: slot.position, playerSeasonId: best.p.id, name: best.p.name, avgRating: Math.round(avg(best) * 100) / 100 })
  }
  const w = (x: { p: PlayerSeason; s: SquadPlayer } | undefined, value: (x: { p: PlayerSeason; s: SquadPlayer }) => string) => (x ? { playerSeasonId: x.p.id, name: x.p.name, value: value(x) } : undefined)
  return {
    playerOfTheSeason: w(pots, (x) => `${avg(x).toFixed(2)} avg rating`),
    goldenBoot: w(boot && boot.s.seasonStats.goals > 0 ? boot : undefined, (x) => `${x.s.seasonStats.goals} goals`),
    playmaker: w(pm && pm.s.seasonStats.assists > 0 ? pm : undefined, (x) => `${x.s.seasonStats.assists} assists`),
    goldenGlove: w(gk, (x) => `${x.s.seasonStats.cleanSheets} clean sheets`),
    youngPlayer: w(young, (x) => `${avg(x).toFixed(2)} avg rating at ${x.p.age}`),
    teamOfTheSeason: tots,
  }
}

export interface Achievement {
  id: string
  title: string
  description: string
  icon: string
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'perfect', title: '38-0', description: 'Win every league match in a season.', icon: '💎' },
  { id: 'invincible', title: 'Invincibles', description: 'Go a whole league season unbeaten and win it.', icon: '🛡️' },
  { id: 'champions', title: 'Champions', description: 'Win the league.', icon: '🏆' },
  { id: 'centurions', title: 'Centurions', description: 'Reach 100 points.', icon: '💯' },
  { id: 'double', title: 'The Double', description: 'Win the league and the cup in the same season.', icon: '🏆🏆' },
  { id: 'cup', title: 'Cup Winners', description: 'Lift the cup.', icon: '🥇' },
  { id: 'continental', title: 'Kings of the Continent', description: 'Win the Continental Cup.', icon: '🌍' },
  { id: 'treble', title: 'The Treble', description: 'League, cup and Continental Cup in one season.', icon: '👑👑👑' },
  { id: 'boot30', title: 'Thirty Goals', description: 'A player scores 30 league goals in a season.', icon: '👟' },
  { id: 'glove20', title: 'Wall', description: 'A goalkeeper keeps 20 clean sheets.', icon: '🧱' },
  { id: 'hard-champions', title: 'Blindfolded', description: 'Win the league drafting in hard mode.', icon: '🙈' },
  { id: 'one-club-champions', title: 'Loyalty', description: 'Win the league with a one-club draft.', icon: '❤️' },
  { id: 'one-nation-champions', title: 'International', description: 'Win the league with a one-nation draft.', icon: '🌐' },
  { id: 'quick-perfect', title: 'Quick 38-0', description: 'A perfect season in a quick draft.', icon: '⚡' },
  { id: 'daily-streak-7', title: 'Regular', description: 'Play the daily challenge seven days running.', icon: '📅' },
  { id: 'dynasty-3', title: 'Dynasty', description: 'Win three league titles in a row.', icon: '👑' },
  { id: 'survivor', title: 'Survivor', description: 'Keep your job with board confidence under 20 at some point.', icon: '🪑' },
  { id: 'dealmaker', title: 'Dealmaker', description: 'Sign a player for less than 70% of his opening asking price.', icon: '🤝' },
  { id: 'record-points', title: 'Record Books', description: 'Set a new league points record on Realistic difficulty.', icon: '📜' },
]

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]))

export interface SeasonSummaryForShare {
  teamName: string
  tier: SeasonTier
  row: TableRow
  position: number
  cupWon: boolean
  continentalWon?: boolean
  leagueSeason: number
  /** The club whose place the side takes in a managed season; empty for a quick season, whose XI is the user's own team. */
  hostClubName: string
  mode: string
  seed?: string
  potsName?: string
  bootName?: string
  bootGoals?: number
  /** Extra lines a mode or feature appends (one nation, a record, a twist, a challenge verdict), printed before the seed. */
  extraLines?: string[]
}

export function shareText(s: SeasonSummaryForShare, appName = 'Touchline'): string {
  const blocks = formBlocks(s.row)
  const seasonLabel = `${s.leagueSeason}-${String((s.leagueSeason + 1) % 100).padStart(2, '0')}`
  const lines = [
    `${appName} · ${s.mode}`,
    s.hostClubName ? `${s.teamName} as ${s.hostClubName}, ${seasonLabel}` : `${s.teamName}, ${seasonLabel}`,
    `${tierLabel(s.tier, s.position)}${s.cupWon ? ' + Cup' : ''}${s.continentalWon ? ' + Europe' : ''}`,
    `${s.row.won}-${s.row.drawn}-${s.row.lost} · ${s.row.points} pts · ${ordinal(s.position)}`,
    blocks,
  ]
  if (s.bootName) lines.push(`⚽ ${s.bootName} ${s.bootGoals}`)
  if (s.potsName) lines.push(`⭐ ${s.potsName}`)
  for (const line of s.extraLines ?? []) if (line.trim()) lines.push(line)
  if (s.seed) lines.push(`Seed ${s.seed}`)
  return lines.join('\n')
}

function formBlocks(row: TableRow): string {
  const w = '🟩'.repeat(Math.min(row.won, 46))
  const d = '🟨'.repeat(Math.min(row.drawn, 46))
  const l = '🟥'.repeat(Math.min(row.lost, 46))
  return w + d + l
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
