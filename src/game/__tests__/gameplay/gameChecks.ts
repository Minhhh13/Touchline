/**
 * Gameplay sweep: checks on a whole game (not one match), flagged through the recorder so every mode reports alike.
 * Cups that skip rounds, venue runs, ages, contracts, money, ratings and awards.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { CupTie } from '@engine/season'
import { USER_TEAM } from '@engine/season'
import type { Fixture, PlayerSeason } from '@engine/types'
import { playerLookup } from '../../logic/players'
import type { Game, QuickBracketTie } from '../../types'
import { flag, tick } from './recorder'

const ROUNDS = ['R32', 'R16', 'QF', 'SF', 'F']

/** A knockout's rounds: none skipped, each round half the one before, its sides the winners of the one before. */
export function cupChecks(ties: CupTie[], label: string, opts: { userOut?: boolean } = {}): void {
  tick('cupChecks')
  const byRound = new Map<string, CupTie[]>()
  for (const t of ties) byRound.set(t.round, [...(byRound.get(t.round) ?? []), t])
  const present = ROUNDS.filter((r) => byRound.has(r))
  if (!present.length) return
  const first = ROUNDS.indexOf(present[0])
  for (let i = first; i < first + present.length; i++) if (!byRound.has(ROUNDS[i])) flag('cup-skips-round', `${label}: ${present.join(',')}`)
  for (let i = 0; i < present.length; i++) {
    const r = byRound.get(present[i])!
    const want = 2 ** (ROUNDS.length - 1 - ROUNDS.indexOf(present[i]))
    // The user's cup holds only the user's ties once they are drawn (an AI round is summarised elsewhere)
    if (r.length !== want && r.length !== 1) flag('cup-round-size', `${label}: ${present[i]} has ${r.length} ties, want ${want}`)
    for (const t of r) {
      if (t.homeTeamId === t.awayTeamId) flag('cup-self-tie', `${label}: ${t.homeTeamId}`)
      if (t.winnerId && t.winnerId !== t.homeTeamId && t.winnerId !== t.awayTeamId) flag('cup-winner-not-in-tie', `${label}: ${t.winnerId}`)
      if (t.result && t.winnerId) {
        const h = t.result.homeGoals + (t.result.penalties?.home ?? 0) * 0.01
        const a = t.result.awayGoals + (t.result.penalties?.away ?? 0) * 0.01
        const w = h > a ? t.homeTeamId : a > h ? t.awayTeamId : null
        if (w !== t.winnerId) flag('cup-winner-vs-score', `${label}: ${t.result.homeGoals}-${t.result.awayGoals} pens ${JSON.stringify(t.result.penalties)} winner ${t.winnerId}`)
      }
    }
    if (i > 0) {
      const prev = byRound.get(present[i - 1])!
      const winners = new Set(prev.map((t) => t.winnerId).filter(Boolean) as string[])
      const sides = r.flatMap((t) => [t.homeTeamId, t.awayTeamId])
      if (prev.length === want * 2) for (const s of sides) if (!winners.has(s)) flag('cup-side-not-a-winner', `${label}: ${s} in ${present[i]}`)
      if (prev.length === 1 && r.length === 1 && !winners.has(r[0].homeTeamId) && !winners.has(r[0].awayTeamId)) flag('cup-user-path-broken', `${label}: ${present[i]}`)
    }
  }
  void opts
}

/** A post-season quick cup's bracket: halving rounds, each round's sides last round's winners. */
export function bracketChecks(rounds: QuickBracketTie[][], label: string): void {
  tick('bracketChecks')
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i]
    if (i > 0 && r.length * 2 !== rounds[i - 1].length) flag('bracket-round-size', `${label}: round ${i} has ${r.length}, before ${rounds[i - 1].length}`)
    for (const t of r) {
      const w = t.hg > t.ag ? t.home : t.ag > t.hg ? t.away : t.pens ? (t.pens.home > t.pens.away ? t.home : t.away) : null
      if (w !== t.winner) flag('bracket-winner-vs-score', `${label}: ${t.home} ${t.hg}-${t.ag} ${t.away} pens ${JSON.stringify(t.pens)} winner ${t.winner}`)
      if (t.hg < 0 || t.ag < 0 || t.hg > 12 || t.ag > 12) flag('bracket-impossible-score', `${label}: ${t.hg}-${t.ag}`)
      if (t.pens && t.pens.home === t.pens.away) flag('bracket-drawn-shootout', `${label}`)
    }
    if (i > 0) {
      const winners = new Set(rounds[i - 1].map((t) => t.winner))
      for (const t of r) for (const s of [t.home, t.away]) if (!winners.has(s)) flag('bracket-side-not-a-winner', `${label}: ${s} in round ${i}`)
    }
  }
  if (rounds.length && rounds.at(-1)!.length !== 1) flag('bracket-no-final', `${label}: last round has ${rounds.at(-1)!.length}`)
}

/** The longest home or away run of every side in a fixture list, flagged above two (TL-05). */
export function venueChecks(fixtures: Array<Pick<Fixture, 'matchweek' | 'homeTeamId' | 'awayTeamId'>>, label: string, from = 0, balanced = true): number {
  tick('venueChecks')
  const bySide = new Map<string, Array<{ mw: number; home: boolean }>>()
  for (const f of fixtures) {
    if (f.matchweek <= from) continue
    bySide.set(f.homeTeamId, [...(bySide.get(f.homeTeamId) ?? []), { mw: f.matchweek, home: true }])
    bySide.set(f.awayTeamId, [...(bySide.get(f.awayTeamId) ?? []), { mw: f.matchweek, home: false }])
  }
  let longest = 0
  for (const [side, games] of bySide) {
    games.sort((a, b) => a.mw - b.mw)
    let run = 0
    let last: boolean | null = null
    for (const g of games) {
      run = g.home === last ? run + 1 : 1
      last = g.home
      longest = Math.max(longest, run)
      if (run === 3) flag(side === USER_TEAM ? 'venue-run-over-two-user' : 'venue-run-over-two', `${label}: ${side} ${g.home ? 'home' : 'away'} x3 to mw ${g.mw}`)
    }
    const homes = games.filter((g) => g.home).length
    if (balanced && Math.abs(homes * 2 - games.length) > 1) flag('venue-imbalance', `${label}: ${side} ${homes} home of ${games.length}`)
  }
  return longest
}

function ratingProblems(p: PlayerSeason, label: string): void {
  if (!(p.overall >= 1 && p.overall <= 99)) flag('rating-out-of-range', `${label}: ${p.name} overall ${p.overall}`)
  for (const [k, v] of Object.entries(p.attributes)) if (typeof v === 'number' && !(v >= 1 && v <= 99)) flag('attribute-out-of-range', `${label}: ${p.name} ${k} ${v}`)
  if (!(p.age >= 14 && p.age <= 45)) flag('age-out-of-range', `${label}: ${p.name} ${p.age}`)
  if (!(p.wage >= 0) || !Number.isFinite(p.wage)) flag('wage-negative', `${label}: ${p.name} ${p.wage}`)
}

/** The squad's players, money and contracts, at any point of a managed game. */
export function squadChecks(g: Game, u: LoadedUniverse, label: string): void {
  tick('squadChecks')
  const look = playerLookup(g, u)
  for (const id of Object.keys(g.squad)) {
    const p = look(id)
    if (!p) {
      flag('squad-player-unknown', `${label}: ${id}`)
      continue
    }
    ratingProblems(p, label)
    const c = g.contracts[id]
    if (g.settings.mode === 'season' || g.settings.mode === 'dynasty') {
      if (!c) flag('no-contract', `${label}: ${p.name}`)
      else if (!(c.years >= 0) || c.years > 6) flag('contract-years', `${label}: ${p.name} ${c.years}`)
    }
    const s = g.squad[id]
    if (s.injury && !(s.injury.weeksOut >= 0)) flag('injury-weeks', `${label}: ${p.name} ${s.injury.weeksOut}`)
    if (s.suspension < 0) flag('suspension-negative', `${label}: ${p.name}`)
    for (const k of ['condition', 'morale', 'sharpness', 'familiarity'] as const) if (!(s[k] >= 0 && s[k] <= 100)) flag('meter-out-of-range', `${label}: ${p.name} ${k} ${s[k]}`)
  }
  for (const id of Object.keys(g.contracts)) if (!g.squad[id]) flag('contract-without-player', `${label}: ${id}`)
  const f = g.finances
  if (f) {
    for (const [k, v] of Object.entries(f)) if (typeof v === 'number' && !Number.isFinite(v)) flag('money-not-finite', `${label}: ${k} ${v}`)
    if (f.wageCap < 0) flag('wage-cap-negative', `${label}: ${f.wageCap}`)
    if (f.wagesPaid < 0) flag('wages-paid-negative', `${label}: ${f.wagesPaid}`)
    if (f.budget < -0.001) flag('budget-negative', `${label}: ${f.budget}`)
  }
}

/** The season's awards: winners in the squad, one award each, team of the season with no man twice. */
export function awardChecks(g: Game, label: string): void {
  tick('awardChecks')
  const a = g.awards
  if (!a) return
  for (const k of ['playerOfTheSeason', 'goldenBoot', 'playmaker', 'goldenGlove', 'youngPlayer'] as const) {
    const w = a[k]
    if (w && !g.squad[w.playerSeasonId]) flag('award-winner-not-in-squad', `${label}: ${k} ${w.name}`)
  }
  const ids = a.teamOfTheSeason.map((t) => t.playerSeasonId)
  if (new Set(ids).size !== ids.length) flag('team-of-season-duplicate', `${label}: ${ids.join(',')}`)
  const slots = a.teamOfTheSeason.map((t) => t.slotId)
  if (new Set(slots).size !== slots.length) flag('team-of-season-slot-twice', label)
  const boot = a.goldenBoot
  if (boot) {
    const goals = g.squad[boot.playerSeasonId]?.seasonStats.goals
    if (goals !== undefined && boot.value !== `${goals} goals` && boot.value !== `${goals} goal`) flag('golden-boot-value', `${label}: ${boot.value} vs ${goals}`)
  }
}

/** Ages and contracts across a dynasty's summers, by real player id. */
export class DynastyWatch {
  private last = new Map<string, { age: number; years: number; year: number; name: string; renewed: boolean }>()
  check(g: Game, u: LoadedUniverse, label: string): void {
    tick('dynasty')
    const look = playerLookup(g, u)
    const now = new Map<string, { age: number; years: number; year: number; name: string; renewed: boolean }>()
    for (const id of Object.keys(g.squad)) {
      const p = look(id)
      if (!p) continue
      const c = g.contracts[id]
      now.set(p.playerId, { age: p.age, years: c?.years ?? -1, year: g.year, name: p.name, renewed: !!c?.renewed })
    }
    for (const [pid, n] of now) {
      const before = this.last.get(pid)
      if (!before || before.year === n.year) continue
      const gap = n.year - before.year
      if (n.age < before.age) flag('age-backwards', `${label}: ${n.name} ${before.age} -> ${n.age}`)
      else if (n.age !== before.age + gap) flag('age-not-plus-one', `${label}: ${n.name} ${before.age} -> ${n.age} over ${gap}`)
      if (before.years >= 0 && n.years >= before.years && !n.renewed && n.years !== -1) flag('contract-not-running-down', `${label}: ${n.name} ${before.years} -> ${n.years}`)
    }
    this.last = now
  }
}
