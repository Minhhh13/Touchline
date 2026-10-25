/**
 * End-of-season awards, team of the season, records and share text.
 */
import type { PlayerSeason, SquadPlayer, TableRow, SeasonTier, Position } from './types'
import { FORMATION_BY_ID } from './formations'
import { TIER_LABEL } from './season'

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
  { id: 'final-whistle', title: 'Final Whistle', description: 'Win a one-off final.', icon: '🏟️' },
  { id: 'spot-kick-kings', title: 'Spot-Kick Kings', description: 'Win a shoot-out in the arena.', icon: '🥅' },
  { id: 'gauntlet-5', title: 'Five Rungs', description: 'Climb five rungs of the Gauntlet.', icon: '🪜' },
  { id: 'gauntlet-10', title: 'Last One Standing', description: 'Climb ten rungs of the Gauntlet.', icon: '🧗' },
  { id: 'gauntlet-15', title: 'Gauntlet Complete', description: 'Climb all fifteen rungs of the Gauntlet.', icon: '🏔️' },
  { id: 'giant-killer', title: 'Giant Killer', description: 'Beat a side with a real team strength of 85+ in the arena on Realistic.', icon: '🪓' },
  { id: 'cup-night', title: 'Cup Night', description: 'Lift the Cup.', icon: '🏆' },
  { id: 'cup-32', title: 'The Long Road', description: 'Win a 32-club Cup.', icon: '🛣️' },
  { id: 'giant-slayers', title: 'Giant Slayers', description: 'Win the Cup against the giants field.', icon: '⚔️' },
  { id: 'clean-run', title: 'Clean Run', description: 'Win the Cup without conceding a goal.', icon: '🧤' },
  { id: 'chain-champions', title: 'Dressing Room', description: 'Win the league with an unbroken teammate chain.', icon: '🔗' },
  { id: 'moneyball', title: 'Bargain Hunters', description: 'Win the league on a £150M cap or less (a bigger squad\'s cap counted back to its XI).', icon: '💰' },
  { id: 'arena-regular', title: 'Arena Regular', description: 'Play the Daily Arena seven days running.', icon: '🏟️' },
  { id: 'weekly-streak-4', title: 'Month of Sundays', description: 'Play the Weekly Challenge four weeks running.', icon: '🗓️' },
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
    `${s.teamName} as ${s.hostClubName}, ${seasonLabel}`,
    `${TIER_LABEL[s.tier]}${s.cupWon ? ' + CUP' : ''}${s.continentalWon ? ' + EUROPE' : ''}`,
    `${s.row.won}W ${s.row.drawn}D ${s.row.lost}L · ${s.row.points} pts · ${ordinal(s.position)}`,
    blocks,
  ]
  if (s.bootName) lines.push(`⚽ ${s.bootName} ${s.bootGoals}`)
  if (s.potsName) lines.push(`⭐ ${s.potsName}`)
  for (const line of s.extraLines ?? []) if (line.trim()) lines.push(line)
  if (s.seed) lines.push(`Seed ${s.seed}`)
  return lines.join('\n')
}

/** One user match of an arena run, as the share text prints it. */
export interface ArenaShareStep {
  /** The round's code: `F` for a final, `R7` for a rung. */
  code: string
  gf: number
  ga: number
  opponent: string
  pens?: { us: number; them: number }
}

export interface ArenaShareInput {
  /** The format's name (`Cup Final`). */
  mode: string
  teamName: string
  formationName: string
  /** `Premier League wheel`, `European Nights wheel`. */
  wheel: string
  /** The result in capitals (`WINNERS`) and its icon. */
  banner: string
  icon: string
  steps: ArenaShareStep[]
  motm?: string
  /** What the man of the match line calls him: `MOTM` unless set (`Final MOTM` in the Cup). */
  motmLabel?: string
  seed?: string
  /** The Gauntlet: one mark per rung printed in place of the per-match lines, then `lines` (the fall, the scorer). */
  strip?: string
  /** Lines after the strip, or after the per-match lines when there is no strip (the Cup's winner). */
  lines?: string[]
}

/** 🟩 won in 90 minutes, 🟨 level at 90 (penalties either way), 🟥 lost in 90. */
export function arenaStepMark(s: Pick<ArenaShareStep, 'gf' | 'ga'>): string {
  return s.gf > s.ga ? '🟩' : s.gf === s.ga ? '🟨' : '🟥'
}

/** `K. De Bruyne`: the first name to its initial, for the share text. */
export function initialName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name
}

/** `De Bruyne`: the name without its first part, for the Gauntlet's scorer line. */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : name
}

/**
 * The arena's share text:
 * TouchLine · Cup Final / the side and its wheel / the banner / one line per match / MOTM / the seed.
 * The Gauntlet prints its strip and lines in place of the per-match lines; the
 * Cup prints its lines after them.
 */
export function arenaShareText(s: ArenaShareInput, appName = 'TouchLine'): string {
  const lines = [`${appName} · ${s.mode}`, `${s.teamName} · ${s.formationName} · ${s.wheel}`, `${s.icon} ${s.banner}`]
  if (s.strip !== undefined) {
    if (s.strip) lines.push(s.strip)
    for (const l of s.lines ?? []) if (l.trim()) lines.push(l)
  } else {
    for (const st of s.steps) lines.push(`${st.code} ${arenaStepMark(st)} ${st.gf}-${st.ga} ${st.opponent}${st.pens ? ` (${st.pens.us}-${st.pens.them} pens)` : ''}`)
    for (const l of s.lines ?? []) if (l.trim()) lines.push(l)
  }
  if (s.motm) lines.push(`⭐ ${s.motmLabel ?? 'MOTM'}: ${initialName(s.motm)}`)
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
