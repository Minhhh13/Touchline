/**
 * The medical view: each fit player's injury risk for the next match, with the
 * reasons. It mirrors the engine's own injury terms (`disciplineAndInjuries` in
 * `src/engine/match.ts` and `trainingInjuries` in `week.ts`): proneness,
 * the condition band and tired legs on a low-stamina outfielder, plus the
 * week's training focus and the physio. Recent minutes are shown as a load
 * warning: they cost condition, which is where the engine feels them. Read-only.
 */
import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import { fatigueInjuryFactor } from '@engine/depth'
import { staffTier } from '@engine/staff'
import { TRAINING, TRAINING_LABEL } from '@engine/training'
import { squadPlayers } from './players'

export type RiskBand = 'low' | 'medium' | 'high'

/** The engine's per-match injury chance at index 1 (`0.021 × index`). */
export const MATCH_INJURY_BASE = 0.021
/** The engine's weekly training injury chance at index 1, before the focus and physio. */
export const TRAINING_INJURY_BASE = 0.006
/** Index bands: under 0.85 is low, under 1.1 medium, anything higher high. */
export const RISK_MEDIUM = 0.85
export const RISK_HIGH = 1.1
/** Minutes over the last three recorded matchweeks that count as a heavy load. */
export const HEAVY_LOAD = 240

/** The engine's condition band (`condF` in `disciplineAndInjuries`). */
export function conditionFactor(condition: number): number {
  return condition < 55 ? 2 : condition < 70 ? 1.45 : condition < 80 ? 1.1 : 1
}

export interface InjuryRisk {
  id: string
  name: string
  band: RiskBand
  /** (0.5 + proneness) × condition band × tired legs: 1 is the engine's base rate. */
  index: number
  /** Chance of an injury in a full match, per cent, to one decimal. */
  matchPct: number
  /** Chance of a training knock this week, per cent, to one decimal. */
  trainingPct: number
  /** Minutes over the last three recorded matchweeks. */
  load: number
  reasons: string[]
}

export function injuryRiskOf(game: Game, p: PlayerSeason, s: SquadPlayer): InjuryRisk {
  const prone = p.traits.injuryProneness
  const cond = s.condition
  const condF = conditionFactor(cond)
  const legs = p.positions[0] === 'GK' ? 1 : fatigueInjuryFactor(p.attributes.stamina, cond)
  const index = Math.round((0.5 + prone) * condF * legs * 100) / 100
  const t = TRAINING[game.training]
  const physio = staffTier(game.staff, 'physio')
  const physioF = physio === 2 ? 0.55 : physio === 1 ? 0.75 : 1
  const load = (s.recentMinutes ?? []).slice(-3).reduce((a, m) => a + m, 0)
  const reasons: string[] = []
  if (prone >= 0.6) reasons.push('Very injury-prone')
  else if (prone >= 0.45) reasons.push('Injury-prone')
  if (cond < 80) reasons.push(`Condition ${Math.round(cond)}`)
  if (legs > 1.03) reasons.push(`Low stamina (${p.attributes.stamina}) on tired legs`)
  if (load >= HEAVY_LOAD) reasons.push(`${load} minutes in three weeks`)
  if (t.injuryRisk > 1) reasons.push(`${TRAINING_LABEL[game.training]} training`)
  const band: RiskBand = index >= RISK_HIGH ? 'high' : index >= RISK_MEDIUM ? 'medium' : 'low'
  return {
    id: p.id,
    name: p.name,
    band,
    index,
    matchPct: Math.round(MATCH_INJURY_BASE * index * 1000) / 10,
    trainingPct: Math.round(TRAINING_INJURY_BASE * t.injuryRisk * (0.5 + prone) * physioF * 1000) / 10,
    load,
    reasons,
  }
}

export interface MedicalReport {
  /** Fit players, highest risk first. */
  risks: InjuryRisk[]
  /** Injured players, longest out first. */
  out: Array<{ id: string; name: string; description: string; weeksOut: number }>
  /** The physio's tier (0 to 2) and what he does. */
  physio: number
}

/** The medical centre for the whole squad. */
export function medicalReport(game: Game, u: LoadedUniverse): MedicalReport {
  const risks: InjuryRisk[] = []
  const out: MedicalReport['out'] = []
  for (const { p, s } of squadPlayers(game, u)) {
    if (s.injury) out.push({ id: p.id, name: p.name, description: s.injury.description, weeksOut: s.injury.weeksOut })
    else risks.push(injuryRiskOf(game, p, s))
  }
  risks.sort((a, b) => b.index - a.index || a.id.localeCompare(b.id))
  out.sort((a, b) => b.weeksOut - a.weeksOut || a.id.localeCompare(b.id))
  return { risks, out, physio: staffTier(game.staff, 'physio') }
}

/** The starter most at risk when he is in the high band, for the briefing. */
export function riskiestStarter(game: Game, u: LoadedUniverse): InjuryRisk | undefined {
  const xi = new Set(Object.values(game.lineup))
  return medicalReport(game, u).risks.find((r) => xi.has(r.id) && r.band === 'high' && (game.squad[r.id]?.suspension ?? 0) <= 0)
}
