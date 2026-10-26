/**
 * The Super League in a Quick Draft: which seasons play it, the field the quick season, the odds and the cups use, and
 * the names the screens give its sides ("Barcelona 2010-11"). The field itself is in `src/engine/superLeague.ts`, a
 * pure function of the universe and the Classic opt-in. Pure.
 */
import type { Game, GameSettings } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import type { SeasonTier } from '@engine/types'
import { aiRatingOffset, buildAiClubs, tierBlurb, tierLabel, type AiClub } from '@engine/season'
import { ordinal } from '@engine/universe'
import { buildSuperClubs, buildSuperRestClubs, SUPER_LEAGUE_NAME, SUPER_LEAGUE_RIVALS, superSeasons, superSideName } from '@engine/superLeague'

/** Whether a game's season is the Super League: a Quick Draft (or a challenge of one) whose rules ask for it. */
export function isSuperLeague(s: Pick<GameSettings, 'mode' | 'rules'>): boolean {
  return s.mode === 'quick' && s.rules.superLeague === true
}

/**
 * The league a quick season is played in and the handicap its AI sides carry: the real league season with its
 * calibration, or the Super League's nineteen at full strength (no calibration: the greatest sides are the point).
 */
export function quickLeague(u: LoadedUniverse, s: Pick<GameSettings, 'mode' | 'rules' | 'leagueId' | 'leagueSeason' | 'hostClubId' | 'difficulty'>): { ai: Record<string, AiClub>; offset: number } {
  if (isSuperLeague(s)) return { ai: buildSuperClubs(u, s.rules.classic), offset: 0 }
  const ai = buildAiClubs(u, s.leagueId, s.leagueSeason, s.hostClubId)
  return { ai, offset: aiRatingOffset(u, ai, s.difficulty ?? 'calibrated') }
}

/** The Super League's Continental Cup field: the next `n` greatest clubs after the league's nineteen, at full strength. */
export function superContinentalField(u: LoadedUniverse, s: Pick<GameSettings, 'rules'>, n: number): Record<string, AiClub> {
  return buildSuperRestClubs(u, s.rules.classic, n)
}

/** League games in a Super League season: every one of the nineteen twice. */
export const SUPER_LEAGUE_GAMES = 2 * SUPER_LEAGUE_RIVALS

/**
 * How the screens name an opponent of a quick season: the club's name, or in the Super League the club with the
 * season it enters with ("Barcelona 2010-11"). Draws nothing.
 */
export function sideNamer(game: Pick<Game, 'settings'>, u: LoadedUniverse): (clubId: string) => string {
  const name = (id: string) => u.clubById[id]?.name ?? id
  if (!isSuperLeague(game.settings)) return name
  const seasons = superSeasons(u, game.settings.rules.classic)
  return (id) => superSideName(name(id), seasons[id])
}

/** The league's name for the screens: the real league's, or "Super League". */
export function quickLeagueName(u: LoadedUniverse, s: Pick<GameSettings, 'mode' | 'rules' | 'leagueId'>): string {
  if (isSuperLeague(s)) return SUPER_LEAGUE_NAME
  return u.leagues.find((l) => l.id === s.leagueId)?.name ?? u.available.find((l) => l.id === s.leagueId)?.name ?? s.leagueId
}

/**
 * A season tier's headline in the Super League: the titles say whose ("Super League champions", "Super League
 * invincibles", "Perfect Super League season") and the bottom three is just that, since nobody goes down. Other tiers
 * read as in any league (`tierLabel`). Pure.
 */
export function superTierLabel(tier: SeasonTier, position?: number): string {
  switch (tier) {
    case 'PERFECT':
      return `Perfect ${SUPER_LEAGUE_NAME} season`
    case 'INVINCIBLE':
      return `${SUPER_LEAGUE_NAME} invincibles`
    case 'CHAMPIONS':
      return `${SUPER_LEAGUE_NAME} champions`
    case 'RELEGATED':
      return 'Bottom three'
    default:
      return tierLabel(tier, position)
  }
}

/** The line under the tier: as in any league, but the bottom three of the Super League go nowhere. Pure. */
export function superTierBlurb(tier: SeasonTier, position: number, teams = SUPER_LEAGUE_RIVALS + 1): string {
  return tier === 'RELEGATED' ? `${ordinal(position)} of ${teams}, in the bottom three.` : tierBlurb(tier, position, teams)
}

/** A quick season's tier headline: the Super League's own words, or the tier's (`tierLabel`). Pure. */
export function quickTierLabel(s: Pick<GameSettings, 'mode' | 'rules'>, tier: SeasonTier, position?: number): string {
  return isSuperLeague(s) ? superTierLabel(tier, position) : tierLabel(tier, position)
}

/** One line on the league for Setup and the pundits: "The 19 greatest sides in the data". */
export const SUPER_LEAGUE_LINE = `The ${SUPER_LEAGUE_RIVALS} greatest sides in the data`
