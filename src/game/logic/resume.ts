import { seasonLabel } from '@engine/universe'
import { arenaStatus } from './arena'
import type { Game } from '../types'

/**
 * Where a waiting game stands, for Home's resume strips: "Drafting", "Kick-off", "January window", "Matchweek 12 of 38
 * · 2025-26", an arena run's own line ("Quarter-final next"), or "Season complete". Pure, display only.
 */
export function resumeStatus(g: Game): string {
  if (g.arena) return arenaStatus(g)
  if (g.phase === 'draft') return 'Drafting'
  if (g.phase === 'kickoff') return 'Kick-off'
  if (g.phase === 'january') return 'January window'
  if (g.phase === 'summary') return 'Season complete'
  if (g.season) return `Matchweek ${g.season.matchweek} of ${g.season.matchweeks} · ${seasonLabel(g.settings.leagueSeason)}`
  return 'In progress'
}
