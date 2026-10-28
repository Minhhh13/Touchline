/**
 * The words of the storylines (`src/game/logic/storylines.ts`): match
 * previews, the running stories of a season and a Dynasty summer's review.
 * Names, places and seasons go through `format.ts`; where a line has several
 * wordings one is picked by a pure hash of what is already known
 * (`flavour.ts`), so the same week always reads the same. Display only: no
 * React, no store, no RNG.
 */
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM } from '@engine/season'
import { fillTemplate, pickVariant } from '@game/logic/flavour'
import type { FormLetter, MatchPreview, Meeting, Stake, Storyline, SummerReview, Watch } from '@game/logic/storylines'
import { clubName, clubShort, ordinal, seasonLabel } from './format'

const ROUND_NAME: Record<string, string> = { R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', F: 'Final', W: 'Winners' }

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** A team id as a name: the user's side by its own name, a club by its short name. */
function sideName(u: LoadedUniverse, teamName: string, id: string): string {
  return id === USER_TEAM ? teamName : clubShort(u, id)
}

/** One varied line: a template from `bank` picked by `key`, filled with `vars`. */
function say(bank: readonly string[], key: string, vars: Record<string, string | number> = {}): string {
  return fillTemplate(pickVariant(bank, key), vars)
}

// ---------------------------------------------------------------------------------------------------------------
// Match previews

export type PreviewLineId = 'stake' | 'derby' | 'form' | 'meetings' | 'watch-theirs' | 'watch-ours' | 'old-boys'

export interface PreviewLine {
  id: PreviewLineId
  label: string
  text: string
}

const count = (f: FormLetter[], o: FormLetter) => f.filter((x) => x === o).length

/** A line on the two sides' form, from the user's last five and theirs. */
export function formLine(ours: FormLetter[], theirs: FormLetter[], opp: string, key: string): string {
  if (!ours.length && !theirs.length) return 'No league form to go on yet.'
  const n = theirs.length
  if (n && count(theirs, 'W') >= 4) return say(['{opp} come in flying: {w} wins in their last {n}.', '{opp} are in form, {w} wins from {n}.'], key, { opp, w: count(theirs, 'W'), n })
  if (count(ours, 'W') >= 4) return say(['You have won {w} of your last {n}.', 'Your side is rolling: {w} wins in {n}.'], key, { w: count(ours, 'W'), n: ours.length })
  if (n && count(theirs, 'L') >= 3) return say(['{opp} are struggling: {l} defeats in their last {n}.', 'Catch {opp} while they are down: {l} defeats in {n}.'], key, { opp, l: count(theirs, 'L'), n })
  if (count(ours, 'L') >= 3) return say(['Your side needs a result: {l} defeats in the last {n}.', 'A run of {l} defeats in {n} to put right.'], key, { l: count(ours, 'L'), n: ours.length })
  if (n && !theirs.includes('L') && n >= 3) return `${opp} are unbeaten in their last ${n}.`
  if (ours.length >= 3 && !ours.includes('L')) return `You are unbeaten in your last ${ours.length}.`
  return say(['Little to choose between the sides on form.', 'Form says this one is close.'], key)
}

/** "2-0 at home, MW 5", from the user's side, a shoot-out included. */
export function meetingLabel(m: Meeting): string {
  const where = m.home ? 'at home' : 'away'
  const pens = m.pens ? ` (${m.pens.ours}-${m.pens.theirs} on penalties)` : ''
  const when = m.comp === 'league' ? `MW ${m.matchweek}` : m.comp === 'cup' ? 'in the Cup' : 'in the Continental Cup'
  return `${m.gf}-${m.ga} ${where}${pens}, ${when}`
}

function meetingsLine(ms: Meeting[], opp: string): string {
  if (!ms.length) return `The first meeting with ${opp} this season.`
  const w = ms.filter((m) => m.gf > m.ga || (m.pens && m.pens.ours > m.pens.theirs)).length
  const l = ms.filter((m) => m.gf < m.ga || (m.pens && m.pens.ours < m.pens.theirs)).length
  const tally = ms.length > 1 ? ` · won ${w}, lost ${l}` : ''
  return `${ms.map(meetingLabel).join('; ')}${tally}.`
}

/** What the match means, in words. */
export function stakeLine(s: Stake, opp: string, key: string, u: LoadedUniverse, teamName: string): string {
  switch (s.kind) {
    case 'title-decider':
      return s.gap > 0 ? `A title decider: you are ${plural(s.gap, 'point')} ahead of ${opp}.` : s.gap < 0 ? `A title decider: ${opp} are ${plural(-s.gap, 'point')} ahead of you.` : `A title decider, level on points with ${opp}.`
    case 'title':
      if (s.leaderId === USER_TEAM) return s.gap > 0 ? say(['Top of the table, {gap} clear: a win keeps the chasers at bay.', 'Leaders by {gap}. Do not blink.'], key, { gap: plural(s.gap, 'point') }) : 'Top on goal difference alone: the title race could not be tighter.'
      return say(['{gap} off the top: three points keep the pressure on {leader}.', 'Chasing {leader}, {gap} behind.'], key, { gap: plural(-s.gap, 'point'), leader: sideName(u, teamName, s.leaderId) })
    case 'europe':
      return s.gap >= 0 ? 'In the top four for now: every point counts.' : `${plural(-s.gap, 'point')} off the top four.`
    case 'six-pointer':
      return say(['A relegation six-pointer: both sides in the bottom six.', 'Six points on the line at the wrong end of the table.'], key)
    case 'survival':
      return s.gap > 0 ? `${plural(s.gap, 'point')} above the drop zone.` : s.gap < 0 ? `In the drop zone, ${plural(-s.gap, 'point')} from safety.` : 'Level on points with the drop zone.'
    case 'leapfrog':
      return s.gap === 0 ? `Level with ${opp}: a win lifts you above them.` : `${plural(-s.gap, 'point')} behind ${opp}: a win could take you past them.`
    case 'final':
      return say(['A cup final. Silverware on the line.', 'One game for a trophy.'], key)
    case 'semi':
      return say(['A semi-final: one win from the final.', 'Win this and you are in the final.'], key)
    case 'knockout':
      return `${ROUND_NAME[s.round] ?? 'A knockout tie'}: lose and you are out.`
  }
}

function watchText(w: Watch, side: 'ours' | 'theirs', opp: string): string {
  if (w.why === 'goals') return `${w.name}: ${plural(w.goals, 'goal')} in ${plural(w.apps, 'game')} this season.`
  if (w.why === 'form') return `${w.name}: averaging ${w.form?.toFixed(1)} in recent games.`
  return side === 'theirs' ? `${w.name}, the best player at ${opp} (${w.overall}).` : `${w.name}, your best player on the day (${w.overall}).`
}

/** The preview's lines, strongest first: the stake, the derby, form, the meetings, the men to watch, the old boys. */
export function previewLines(p: MatchPreview, u: LoadedUniverse, teamName: string, key: string): PreviewLine[] {
  const opp = clubShort(u, p.opponentId)
  const k = `${key}|${p.comp}|${p.opponentId}`
  const out: PreviewLine[] = []
  if (p.stake) out.push({ id: 'stake', label: 'At stake', text: stakeLine(p.stake, opp, `${k}|stake`, u, teamName) })
  if (p.derby) {
    const text =
      p.derby.kind === 'named'
        ? say([`The ${p.derby.name}. Bragging rights on the line.`, `It is the ${p.derby.name}: form goes out of the window.`], `${k}|derby`)
        : p.derby.kind === 'city'
          ? `A ${p.derby.city} derby: the whole city will be watching.`
          : say(['A rivalry game: this one means more to the fans.', 'Old rivals. Nobody wants to lose this one.'], `${k}|derby`)
    out.push({ id: 'derby', label: 'Derby', text })
  }
  out.push({ id: 'form', label: 'Form', text: formLine(p.form.ours, p.form.theirs, opp, `${k}|form`) })
  out.push({ id: 'meetings', label: 'This season', text: meetingsLine(p.meetings, opp) })
  if (p.watch.theirs) out.push({ id: 'watch-theirs', label: 'Watch for', text: watchText(p.watch.theirs, 'theirs', opp) })
  if (p.watch.ours) out.push({ id: 'watch-ours', label: 'Your man', text: watchText(p.watch.ours, 'ours', opp) })
  if (p.oldBoys.length) {
    const shown = p.oldBoys.slice(0, 3)
    const text = shown.length === 1 ? `${shown[0].name} played for ${clubName(u, p.opponentId)} in ${seasonLabel(shown[0].season)}.` : `${list(shown.map((b) => b.name))} all played for ${clubName(u, p.opponentId)}.`
    out.push({ id: 'old-boys', label: 'Old club', text })
  }
  return out
}

/** The preview's headline: the competition, home or away, and the opponent. */
export function previewTitle(p: MatchPreview, u: LoadedUniverse): string {
  const comp = p.comp === 'league' ? `MW ${p.matchweek}` : `${p.comp === 'cup' ? 'Cup' : 'Continental Cup'} ${ROUND_NAME[p.round ?? 'R16']?.toLowerCase() ?? 'tie'}`
  return `${comp}: ${p.home ? 'v' : 'at'} ${clubName(u, p.opponentId)}`
}

// ---------------------------------------------------------------------------------------------------------------
// Running storylines

export interface StoryText {
  title: string
  text: string
  /** A few words for a chip. */
  chip: string
}

/** A storyline in words, varied by `key` (the game, its year and the matchweek). */
export function storylineText(s: Storyline, u: LoadedUniverse, teamName: string, key: string): StoryText {
  const k = `${key}|${s.id}`
  switch (s.kind) {
    case 'title-race': {
      const rival = sideName(u, teamName, s.rivalId)
      const left = s.toPlay === 1 ? 'one game to play' : `${s.toPlay} to play`
      const text = s.position === 1 ? (s.gap > 0 ? `${plural(s.gap, 'point')} clear of ${rival} with ${left}.` : `Level on points with ${rival} at the top, ${left}.`) : `${plural(-s.gap, 'point')} behind ${rival} with ${left}.`
      let trend = ''
      if (s.before !== null && s.before !== s.gap) {
        const closer = Math.abs(s.gap) < Math.abs(s.before)
        if (s.position === 1) trend = closer ? say([' The gap is closing.', ' The chasers are closing in.'], k) : say([' Pulling clear.', ' The lead grows.'], k)
        else trend = closer ? say([' Closing in.', ' The gap is coming down.'], k) : say([' It is slipping away.', ' The gap grows.'], k)
      }
      const chip = s.position === 1 ? (s.gap > 0 ? `Title race: ${s.gap} clear` : 'Title race: level') : `Title race: ${-s.gap} behind`
      return { title: 'Title race', text: `${text}${trend}`, chip }
    }
    case 'relegation': {
      const left = s.toPlay === 1 ? 'one game to play' : `${s.toPlay} to play`
      const text = s.gap > 0 ? `${plural(s.gap, 'point')} above the drop with ${left}.` : s.gap < 0 ? `In the bottom three, ${plural(-s.gap, 'point')} from safety, ${left}.` : `Level on points with the drop zone, ${left}.`
      let trend = ''
      if (s.before !== null && s.before !== s.gap) trend = s.gap > s.before ? say([' Climbing away.', ' Moving the right way.'], k) : say([' The trapdoor is opening.', ' Heading the wrong way.'], k)
      const chip = s.gap > 0 ? `Relegation fight: ${s.gap} above` : s.gap < 0 ? `Relegation fight: ${-s.gap} adrift` : 'Relegation fight: level'
      return { title: 'Relegation fight', text: `${text}${trend}`, chip }
    }
    case 'golden-boot': {
      const rival = s.rival ? `${s.rival.name} (${sideName(u, teamName, s.rival.teamId)})` : null
      let text: string
      if (s.rank === 1) text = rival ? (s.rival!.goals === s.goals ? `${s.name} is level at the top of the scoring charts with ${rival}, on ${s.goals}.` : `${s.name} leads the scoring charts with ${s.goals}, ${plural(s.goals - s.rival!.goals, 'goal')} ahead of ${rival}.`) : `${s.name} leads the scoring charts with ${s.goals}.`
      else text = `${s.name} has ${plural(s.goals, 'goal')}, ${ordinal(s.rank)} in the charts${rival ? `, ${plural(s.rival!.goals - s.goals, 'goal')} behind ${rival}` : ''}.`
      return { title: 'Golden Boot race', text, chip: `Golden Boot: ${s.name} ${s.goals}` }
    }
    case 'winning-run':
      return { title: 'Winning run', text: say(['{n} league wins in a row.', 'Won the last {n} in the league. Who stops this?', '{n} straight league wins and counting.'], k, { n: s.length }), chip: `${s.length} wins in a row` }
    case 'unbeaten-run':
      return { title: 'Unbeaten run', text: say(['Unbeaten in {n} league games.', '{n} league games without defeat.'], k, { n: s.length }), chip: `Unbeaten in ${s.length}` }
    case 'losing-run':
      return { title: 'Losing streak', text: say(['{n} league defeats in a row.', 'Lost the last {n} in the league. Something has to change.', '{n} straight defeats: the slump has to end somewhere.'], k, { n: s.length }), chip: `${s.length} defeats in a row` }
    case 'winless-run':
      return { title: 'Winless run', text: say(['No win in {n} league games.', '{n} league games without a win.'], k, { n: s.length }), chip: `${s.length} without a win` }
    case 'milestone': {
      const what = s.stat === 'apps' ? 'appearances' : 'goals'
      let text: string
      if (s.reached) text = s.stat === 'apps' ? say(['{name} has now played {t} games for the club.', '{t} appearances for the club: a milestone for {name}.'], k, { name: s.name, t: s.target }) : say(['{name} has scored {t} goals for the club.', 'Goal number {t} for the club: take a bow, {name}.'], k, { name: s.name, t: s.target })
      else if (s.stat === 'apps') text = `${s.name} is one game from ${s.target} appearances for the club.`
      else text = `${s.name} needs ${plural(s.target - s.value, 'more goal')} for ${s.target} for the club.`
      return { title: 'Milestone', text, chip: s.reached ? `${s.name}: ${s.target} ${what}` : `${s.name} nears ${s.target} ${what}` }
    }
    case 'old-club': {
      const when = s.comp === 'league' ? 'this week' : 'midweek'
      return { title: 'Old club', text: say(['{name} meets {club} {when}, the club of {season}.', 'A return for {name}: {club}, from {season}, come up {when}.'], k, { name: s.name, club: clubName(u, s.clubId), when, season: seasonLabel(s.season) }), chip: `${s.name} v old club` }
    }
    case 'pressure': {
      const where = s.position ? ` The board want ${ordinal(s.target)}; you are ${ordinal(s.position)}.` : ''
      const text = s.canSack ? `Board confidence is down to ${s.confidence}.${where} The job is on the line.` : `Board confidence is down to ${s.confidence}.${where}`
      return { title: 'Under pressure', text, chip: `Board confidence ${s.confidence}` }
    }
    case 'run-in': {
      const lead = s.toPlay === 1 ? 'The last day.' : `${s.toPlay} games to play.`
      let where: string
      if (s.position === 1) where = s.gapTop > 0 ? ` Top, ${plural(s.gapTop, 'point')} clear.` : ' Top on goal difference.'
      else if (s.gapTop >= -6 && s.position <= 3) where = ` ${ordinal(s.position)}, ${plural(-s.gapTop, 'point')} off the top.`
      else if (s.gapSafety <= 3) where = s.gapSafety > 0 ? ` ${plural(s.gapSafety, 'point')} above the drop.` : ` ${plural(-s.gapSafety, 'point')} from safety.`
      else where = s.position <= s.target ? ` ${ordinal(s.position)}, on course for the board's ${ordinal(s.target)}.` : ` ${ordinal(s.position)}; the board want ${ordinal(s.target)}.`
      return { title: 'The run-in', text: `${lead}${where}`, chip: s.toPlay === 1 ? 'The last day' : `${s.toPlay} to play` }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A Dynasty summer

export interface SummerText {
  headline: string
  /** The story of last season, a line each. */
  lines: Array<{ id: 'finish' | 'goals' | 'cups' | 'awards' | 'before' | 'era' | 'legend'; text: string }>
}

const HEADLINES: Record<SummerReview['headline'], readonly string[]> = {
  treble: ['The Treble! {team} win everything in {season}.', 'League, Cup and Continental Cup: {team} make history in {season}.'],
  perfect: ['Perfection: {team} win every league game of {season}.', 'Played them all, beat them all: {team} in {season}.'],
  double: ['Double winners: {team} take the league and a cup in {season}.', 'Two trophies for {team} in {season}.'],
  invincible: ['Invincibles: {team} go the whole league season unbeaten.', 'Unbeaten champions: {team} in {season}.'],
  champions: ['Champions! {team} win the {league} in {season}.', '{team} are champions of the {league}.'],
  relegated: ['{team} finish {pos} in {season}: a season to forget.', 'Down among the dead men: {team} finish {pos}.'],
  cup: ['Cup winners: {team} lift silverware in {season}.', 'A trophy for {team}: {pos} in the league, and a cup in the cabinet.'],
  europe: ['{team} finish {pos}: a top-four season.', 'A top-four finish for {team} in {season}.'],
  climb: ['Up {climb} places: {team} finish {pos} in {season}.', '{team} climb to {pos}, {climb} places better than the year before.'],
  slide: ['Down {slide} places: {team} slip to {pos} in {season}.', 'A step back: {team} finish {pos}, {slide} places down.'],
  steady: ['{team} finish {pos} in {season}.', 'Steady going: {pos} for {team} in {season}.'],
}

/** The summer's headline and the card's lines, from the review and the league's name. */
export function summerText(r: SummerReview, u: LoadedUniverse, key: string): SummerText {
  const rec = r.record
  const league = u.leagues.find((l) => l.id === rec.leagueId)?.name ?? 'league'
  const vars = { team: rec.teamName, season: seasonLabel(rec.leagueSeason), league, pos: ordinal(rec.position), climb: r.climb ?? 0, slide: -(r.climb ?? 0) }
  const headline = say(HEADLINES[r.headline], `${key}|summer|${rec.year}`, vars)
  const lines: SummerText['lines'] = [
    { id: 'finish', text: `${ordinal(rec.position)} on ${plural(rec.points, 'point')}, won ${rec.won}, drew ${rec.drawn}, lost ${rec.lost}.` },
    { id: 'goals', text: `${plural(rec.goalsFor, 'goal')} scored, ${rec.goalsAgainst} conceded.` },
  ]
  const cups: string[] = []
  if (rec.cupWon) cups.push('won the Cup')
  if (rec.continentalWon) cups.push('won the Continental Cup')
  // Engine 7's group stage: out in the groups is never "reached the knockouts"
  else if (rec.continentalRun === 'G') cups.push('went out in the Continental Cup group stage')
  else if (rec.continentalRun && rec.continentalRun !== 'W') cups.push(`reached the Continental Cup ${ROUND_NAME[rec.continentalRun]?.toLowerCase() ?? 'knockouts'}`)
  if (cups.length) lines.push({ id: 'cups', text: `${list(cups).replace(/^./, (c) => c.toUpperCase())}.` })
  const awards: string[] = []
  if (rec.bootName && rec.bootGoals) awards.push(`${rec.bootName} top scorer with ${rec.bootGoals}`)
  if (rec.potsName) awards.push(`${rec.potsName} player of the season`)
  if (awards.length) lines.push({ id: 'awards', text: `${awards.join('; ')}.` })
  if (r.previous) lines.push({ id: 'before', text: `The year before: ${ordinal(r.previous.position)} on ${plural(r.previous.points, 'point')}.` })
  if (r.seasons > 1) lines.push({ id: 'era', text: `${plural(r.titles, 'league title')} in ${r.seasons} seasons in charge.` })
  if (r.legend) lines.push({ id: 'legend', text: `All-time top scorer: ${r.legend.name}, ${plural(r.legend.goals, 'goal')} in ${plural(r.legend.apps, 'game')}.` })
  return { headline, lines }
}
