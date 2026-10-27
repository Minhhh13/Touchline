/**
 * The pundit's verdict: one or two short sentences under a season's result on
 * the summary (a Quick Draft, the Daily and the Weekly, a Season, each Dynasty
 * year), picked from the result by a pure hash of the season's id so the same
 * season always reads the same. It reads only the finished record, the tier
 * and the cups; Season Story's own lines are untouched. Display only. Pure: no
 * React, no store, no RNG.
 */
import type { SeasonTier } from '@engine/types'
import type { Game } from '../types'
import { fillTemplate, flavourChance, pickVariant } from './flavour'

export interface VerdictInput {
  /** The season's id (`${game.id}-${game.year}`): the hash's key. */
  key: string
  tier: SeasonTier
  position: number
  /** Clubs in the league. */
  clubs: number
  won: number
  drawn: number
  lost: number
  points: number
  goalsFor: number
  goalsAgainst: number
  team: string
  sacked?: boolean
  cupWon?: boolean
  continentalWon?: boolean
  /** A Dynasty: seasons played so far (this one included) and league titles among them. */
  dynasty?: { seasons: number; titles: number }
}

export const VERDICT_LINES = {
  sacked: ['The board had seen enough. Hard to argue.', 'Results like that cost managers their jobs.', 'A short reign, and not a happy one.'],
  treble: ['League, Cup and Continental Cup. Words fail me.', 'The Treble. Put it in the history books.', 'Three trophies. Greatness, simple as that.'],
  perfect: ['Every game won. I have never seen anything like it.', 'Perfection. There is nothing more to say.', 'Not a point dropped all season. Unrepeatable. Probably.', 'Played them all, beat them all.'],
  invincible: ['Unbeaten all season. That is a special group.', 'Champions without a defeat. Invincible is the only word.', 'Nobody could lay a glove on them.'],
  double: ['League and cup. A season to remember.', 'The Double. Greedy, and rightly so.', 'Two trophies, and they looked hungry for more.'],
  champions: ['Worthy champions. The best side over the season.', 'Champions, and nobody can argue.', 'They kept their nerve when it mattered. Champions.', 'The title is theirs, and it was earned.', 'Top of the pile when it counted.'],
  titleRace: ['So close. They will learn from that run-in.', 'Pushed it all the way, but second is the first loser.', 'A title challenge to be proud of, even without the trophy.', 'Nearly. The gap is small, but it is there.'],
  european: ['A good season. Europe beckons.', 'Solid, and a European place to show for it.', 'They belong in the top half, no question.', 'Plenty to build on.'],
  midTable: ['Mid-table. Neither here nor there.', 'Safe, steady, unspectacular.', 'A season that will be forgotten by the summer.', 'Comfortable, but nothing to get excited about.'],
  survived: ['They survived, and that is all that matters.', 'Too close for comfort, but they stayed up.', 'Lived dangerously and got away with it.', 'Safe. Just. Lessons to learn.'],
  relegated: ['Relegated. A long summer of questions ahead.', 'Not good enough, and the table does not lie.', 'Down they go. Painful to watch.', 'The drop. They never got going.'],
} as const

export const STAT_LINES = {
  attack: ['The goals flowed all season.', 'Frightening going forward.', 'Nobody could live with that attack.'],
  defence: ['The defence was a brick wall.', 'Built on a miserly back line.', 'Goals against them were rare as hen’s teeth.'],
  leaky: ['That defence needs work, though.', 'Too many goals conceded, mind.', 'They have to tighten up at the back.'],
  draws: ['Too many draws to be truly great.', 'Points left on the table in all those draws.'],
} as const

export const DYNASTY_LINES = {
  decade: ['A decade in charge. Some going.', 'Ten years and counting: an era, not a spell.'],
  dominant: ['{titles} titles in {seasons} seasons. This is a dynasty.', 'Title after title: {titles} from {seasons}.', 'They own this league now: {titles} titles in {seasons} years.'],
  building: ['Season {seasons} of the project, and it is taking shape.', '{seasons} seasons in, the foundations are there.', 'Year {seasons}. Patience is running out for some.'],
} as const

/** The verdict's tier line. */
function tierBank(i: VerdictInput): readonly string[] {
  if (i.sacked) return VERDICT_LINES.sacked
  const title = i.position === 1 && i.tier !== 'RELEGATED'
  if (title && i.cupWon && i.continentalWon) return VERDICT_LINES.treble
  if (i.tier === 'PERFECT') return VERDICT_LINES.perfect
  if (i.tier === 'INVINCIBLE') return VERDICT_LINES.invincible
  if (title && (i.cupWon || i.continentalWon)) return VERDICT_LINES.double
  switch (i.tier) {
    case 'CHAMPIONS':
      return VERDICT_LINES.champions
    case 'TITLE_RACE':
      return VERDICT_LINES.titleRace
    case 'EUROPEAN':
      return VERDICT_LINES.european
    case 'MID_TABLE':
      return VERDICT_LINES.midTable
    case 'RELEGATION_BATTLE':
      return VERDICT_LINES.survived
    case 'RELEGATED':
      return VERDICT_LINES.relegated
    default:
      return title ? VERDICT_LINES.champions : VERDICT_LINES.midTable
  }
}

/** A second sentence when a number stands out: the attack, the defence, the draws; null otherwise. */
function statBank(i: VerdictInput): readonly string[] | null {
  const games = i.won + i.drawn + i.lost
  if (!games || i.tier === 'PERFECT') return null
  if (i.goalsFor / games >= 2.4) return STAT_LINES.attack
  if (i.goalsAgainst / games <= 0.6) return STAT_LINES.defence
  if (i.goalsAgainst / games >= 1.7 && i.position <= Math.ceil(i.clubs / 2)) return STAT_LINES.leaky
  if (i.drawn / games >= 0.35) return STAT_LINES.draws
  return null
}

/** The pundit's verdict on a finished season. */
export function punditVerdict(i: VerdictInput): string {
  const first = fillTemplate(pickVariant(tierBank(i), `${i.key}|verdict`), { team: i.team })
  const d = i.dynasty
  if (d && d.seasons >= 2 && !i.sacked) {
    const bank = d.seasons >= 10 ? DYNASTY_LINES.decade : d.titles >= 2 && d.titles * 2 >= d.seasons ? DYNASTY_LINES.dominant : DYNASTY_LINES.building
    return `${first} ${fillTemplate(pickVariant(bank, `${i.key}|dynasty`), { seasons: d.seasons, titles: d.titles })}`
  }
  const stat = statBank(i)
  return stat && flavourChance(`${i.key}|stat`, 2, 3) ? `${first} ${pickVariant(stat, `${i.key}|stat`)}` : first
}

/** The verdict's input from a finished game: the quick result, or the last season of the history. Null without one. */
export function verdictInputOf(game: Pick<Game, 'id' | 'year' | 'settings' | 'tier' | 'quickResult' | 'history' | 'season'>, clubs: number): VerdictInput | null {
  const q = game.quickResult
  const last = game.history.at(-1)
  const rec = q ?? last
  if (!rec) return null
  const dynasty = game.settings.mode === 'dynasty' ? { seasons: game.history.length, titles: game.history.filter((h) => h.position === 1 && h.tier !== 'RELEGATED').length } : undefined
  return {
    key: `${game.id}-${game.year}`,
    tier: game.tier ?? rec.tier,
    position: rec.position,
    clubs,
    won: rec.won,
    drawn: rec.drawn,
    lost: rec.lost,
    points: rec.points,
    goalsFor: rec.goalsFor,
    goalsAgainst: rec.goalsAgainst,
    team: game.settings.teamName,
    ...(game.season?.sacked ? { sacked: true } : {}),
    cupWon: q ? q.cup?.reached === 'W' : !!last?.cupWon,
    continentalWon: q ? q.europe?.reached === 'W' || q.continentalCup?.reached === 'W' : !!last?.continentalWon,
    ...(dynasty ? { dynasty } : {}),
  }
}
