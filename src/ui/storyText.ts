/**
 * The words of the storylines (`src/game/logic/storylines.ts`): match
 * previews, the running stories of a season and a Dynasty summer's review.
 * Every line goes through `t()` (the `story` catalogue, `i18n/en/story.ts`);
 * where a line has several wordings (keys `_0`, `_1`…) one is picked by a pure
 * hash of what is already known (`flavour.ts`), so the same week always reads
 * the same. Display only: no React, no store, no RNG.
 */
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM } from '@engine/season'
import { pickVariant } from '@game/logic/flavour'
import type { FormLetter, MatchPreview, Meeting, Stake, Storyline, SummerReview, Watch } from '@game/logic/storylines'
import { clubName, clubShort, seasonLabel } from './format'
import { translator } from './i18n'
import { story } from './i18n/en/story'

const t = translator(story)

const points = (n: number) => t('points', { n })
const goals = (n: number) => t('goals', { n })
const games = (n: number) => t('games', { n })

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return t('listAnd', { head: names.slice(0, -1).join(t('listSep')), last: names[names.length - 1] })
}

/** A message the catalogue holds, or null. */
const known = (k: string) => (t.has(k) ? t(k) : null)

/** A round's name ("Quarter-final"), or null for a round with no name. */
function roundName(round: string | undefined, lower = false): string | null {
  return lower ? known(`roundLower_${round}`) : known(`round_${round}`)
}

/** A team id as a name: the user's side by its own name, a club by its short name. */
function sideName(u: LoadedUniverse, teamName: string, id: string): string {
  return id === USER_TEAM ? teamName : clubShort(u, id)
}

/** One of a line's wordings (`stem_0`, `stem_1`…), picked by `key`: the same week always reads the same. */
const pick = <K extends string>(keys: readonly K[], key: string): K => pickVariant(keys, key)

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
  if (!ours.length && !theirs.length) return t('noForm')
  const n = theirs.length
  if (n && count(theirs, 'W') >= 4) return t(pick(['theirsHot_0', 'theirsHot_1'], key), { opp, w: count(theirs, 'W'), n })
  if (count(ours, 'W') >= 4) return t(pick(['oursHot_0', 'oursHot_1'], key), { w: count(ours, 'W'), n: ours.length })
  if (n && count(theirs, 'L') >= 3) return t(pick(['theirsCold_0', 'theirsCold_1'], key), { opp, l: count(theirs, 'L'), n })
  if (count(ours, 'L') >= 3) return t(pick(['oursCold_0', 'oursCold_1'], key), { l: count(ours, 'L'), n: ours.length })
  if (n && !theirs.includes('L') && n >= 3) return t('theirsUnbeaten', { opp, n })
  if (ours.length >= 3 && !ours.includes('L')) return t('oursUnbeaten', { n: ours.length })
  return t(pick(['formEven_0', 'formEven_1'], key))
}

/** "2-0 at home, MW 5", from the user's side, a shoot-out included. */
export function meetingLabel(m: Meeting): string {
  const pens = m.pens ? t('meetingPens', { ours: m.pens.ours, theirs: m.pens.theirs }) : ''
  const when = m.comp === 'league' ? t('meetingMw', { n: m.matchweek }) : m.comp === 'cup' ? t('meetingCup') : t('meetingContinental')
  return t('meeting', { gf: m.gf, ga: m.ga, home: m.home ? 'yes' : 'no', pens, when })
}

function meetingsLine(ms: Meeting[], opp: string): string {
  if (!ms.length) return t('firstMeeting', { opp })
  const w = ms.filter((m) => m.gf > m.ga || (m.pens && m.pens.ours > m.pens.theirs)).length
  const l = ms.filter((m) => m.gf < m.ga || (m.pens && m.pens.ours < m.pens.theirs)).length
  const tally = ms.length > 1 ? t('meetingsTally', { w, l }) : ''
  return t('meetings', { list: ms.map(meetingLabel).join(t('meetingsSep')), tally })
}

/** What the match means, in words. */
export function stakeLine(s: Stake, opp: string, key: string, u: LoadedUniverse, teamName: string): string {
  switch (s.kind) {
    case 'title-decider':
      return s.gap > 0 ? t('deciderAhead', { gap: points(s.gap), opp }) : s.gap < 0 ? t('deciderBehind', { gap: points(-s.gap), opp }) : t('deciderLevel', { opp })
    case 'title':
      if (s.leaderId === USER_TEAM) return s.gap > 0 ? t(pick(['topClear_0', 'topClear_1'], key), { gap: points(s.gap) }) : t('topOnGd')
      return t(pick(['chasing_0', 'chasing_1'], key), { gap: points(-s.gap), leader: sideName(u, teamName, s.leaderId) })
    case 'europe':
      return s.gap >= 0 ? t('topFour') : t('offTopFour', { gap: points(-s.gap) })
    case 'six-pointer':
      return t(pick(['sixPointer_0', 'sixPointer_1'], key))
    case 'survival':
      return s.gap > 0 ? t('aboveDrop', { gap: points(s.gap) }) : s.gap < 0 ? t('inDrop', { gap: points(-s.gap) }) : t('levelDrop')
    case 'leapfrog':
      return s.gap === 0 ? t('leapLevel', { opp }) : t('leapBehind', { gap: points(-s.gap), opp })
    case 'final':
      return t(pick(['final_0', 'final_1'], key))
    case 'semi':
      return t(pick(['semi_0', 'semi_1'], key))
    case 'knockout':
      return t('knockout', { round: roundName(s.round) ?? t('knockoutTie') })
  }
}

function watchText(w: Watch, side: 'ours' | 'theirs', opp: string): string {
  if (w.why === 'goals') return t('watchGoals', { name: w.name, goals: goals(w.goals), games: games(w.apps) })
  if (w.why === 'form') return t('watchForm', { name: w.name, form: w.form?.toFixed(1) ?? '' })
  return t(side === 'theirs' ? 'watchTheirs' : 'watchOurs', { name: w.name, opp, overall: w.overall })
}

/** The preview's lines, strongest first: the stake, the derby, form, the meetings, the men to watch, the old boys. */
export function previewLines(p: MatchPreview, u: LoadedUniverse, teamName: string, key: string): PreviewLine[] {
  const opp = clubShort(u, p.opponentId)
  const k = `${key}|${p.comp}|${p.opponentId}`
  const out: PreviewLine[] = []
  const line = (id: PreviewLineId, text: string) => out.push({ id, label: t(`label_${id}`), text })
  if (p.stake) line('stake', stakeLine(p.stake, opp, `${k}|stake`, u, teamName))
  if (p.derby) line('derby', p.derby.kind === 'named' ? t(pick(['derbyNamed_0', 'derbyNamed_1'], `${k}|derby`), { name: p.derby.name }) : p.derby.kind === 'city' ? t('derbyCity', { city: p.derby.city }) : t(pick(['rivalry_0', 'rivalry_1'], `${k}|derby`)))
  line('form', formLine(p.form.ours, p.form.theirs, opp, `${k}|form`))
  line('meetings', meetingsLine(p.meetings, opp))
  if (p.watch.theirs) line('watch-theirs', watchText(p.watch.theirs, 'theirs', opp))
  if (p.watch.ours) line('watch-ours', watchText(p.watch.ours, 'ours', opp))
  if (p.oldBoys.length) {
    const shown = p.oldBoys.slice(0, 3)
    const club = clubName(u, p.opponentId)
    line('old-boys', shown.length === 1 ? t('oldBoy', { name: shown[0].name, club, season: seasonLabel(shown[0].season) }) : t('oldBoys', { names: list(shown.map((b) => b.name)), club }))
  }
  return out
}

/** The preview's headline: the competition, home or away, and the opponent. */
export function previewTitle(p: MatchPreview, u: LoadedUniverse): string {
  const vars = { home: p.home ? 'yes' : 'no', club: clubName(u, p.opponentId) }
  if (p.comp === 'league') return t('titleMw', { ...vars, n: p.matchweek })
  const round = roundName(p.round ?? 'R16', true) ?? t('tie')
  return t(p.comp === 'cup' ? 'titleCup' : 'titleContinental', { ...vars, round })
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
      const left = s.toPlay === 1 ? t('oneToPlay') : t('toPlay', { n: s.toPlay })
      const text = s.position === 1 ? (s.gap > 0 ? t('raceClear', { gap: points(s.gap), rival, left }) : t('raceLevel', { rival, left })) : t('raceBehind', { gap: points(-s.gap), rival, left })
      let trend = ''
      if (s.before !== null && s.before !== s.gap) {
        const closer = Math.abs(s.gap) < Math.abs(s.before)
        if (s.position === 1) trend = t(pick(closer ? ['leadClosing_0', 'leadClosing_1'] : ['leadGrowing_0', 'leadGrowing_1'], k))
        else trend = t(pick(closer ? ['chaseClosing_0', 'chaseClosing_1'] : ['chaseSlipping_0', 'chaseSlipping_1'], k))
      }
      const chip = s.position === 1 ? (s.gap > 0 ? t('raceChipClear', { n: s.gap }) : t('raceChipLevel')) : t('raceChipBehind', { n: -s.gap })
      return { title: t('raceTitle'), text: `${text}${trend}`, chip }
    }
    case 'relegation': {
      const left = s.toPlay === 1 ? t('oneToPlay') : t('toPlay', { n: s.toPlay })
      const text = s.gap > 0 ? t('dropAbove', { gap: points(s.gap), left }) : s.gap < 0 ? t('dropIn', { gap: points(-s.gap), left }) : t('dropLevel', { left })
      let trend = ''
      if (s.before !== null && s.before !== s.gap) trend = t(pick(s.gap > s.before ? ['climbing_0', 'climbing_1'] : ['sinking_0', 'sinking_1'], k))
      const chip = s.gap > 0 ? t('dropChipAbove', { n: s.gap }) : s.gap < 0 ? t('dropChipAdrift', { n: -s.gap }) : t('dropChipLevel')
      return { title: t('dropTitle'), text: `${text}${trend}`, chip }
    }
    case 'golden-boot': {
      const rival = s.rival ? t('bootRival', { name: s.rival.name, side: sideName(u, teamName, s.rival.teamId) }) : null
      let text: string
      if (s.rank === 1) text = rival ? (s.rival!.goals === s.goals ? t('bootLevel', { name: s.name, rival, n: s.goals }) : t('bootLeads', { name: s.name, n: s.goals, gap: goals(s.goals - s.rival!.goals), rival })) : t('bootLeadsAlone', { name: s.name, n: s.goals })
      else text = rival ? t('bootChasing', { name: s.name, goals: goals(s.goals), rank: s.rank, gap: goals(s.rival!.goals - s.goals), rival }) : t('bootChasingAlone', { name: s.name, goals: goals(s.goals), rank: s.rank })
      return { title: t('bootTitle'), text, chip: t('bootChip', { name: s.name, n: s.goals }) }
    }
    case 'winning-run':
      return { title: t('winRunTitle'), text: t(pick(['winRun_0', 'winRun_1', 'winRun_2'], k), { n: s.length }), chip: t('winRunChip', { n: s.length }) }
    case 'unbeaten-run':
      return { title: t('unbeatenRunTitle'), text: t(pick(['unbeatenRun_0', 'unbeatenRun_1'], k), { n: s.length }), chip: t('unbeatenRunChip', { n: s.length }) }
    case 'losing-run':
      return { title: t('loseRunTitle'), text: t(pick(['loseRun_0', 'loseRun_1', 'loseRun_2'], k), { n: s.length }), chip: t('loseRunChip', { n: s.length }) }
    case 'winless-run':
      return { title: t('winlessRunTitle'), text: t(pick(['winlessRun_0', 'winlessRun_1'], k), { n: s.length }), chip: t('winlessRunChip', { n: s.length }) }
    case 'milestone': {
      const vars = { name: s.name, t: s.target }
      let text: string
      if (s.reached) text = t(pick(s.stat === 'apps' ? ['appsReached_0', 'appsReached_1'] : ['goalsReached_0', 'goalsReached_1'], k), vars)
      else if (s.stat === 'apps') text = t('appsNear', vars)
      else text = t('goalsNear', { ...vars, more: t('moreGoals', { n: s.target - s.value }) })
      return { title: t('milestoneTitle'), text, chip: t(s.reached ? 'milestoneChip' : 'milestoneChipNear', { ...vars, stat: s.stat }) }
    }
    case 'old-club': {
      const when = s.comp === 'league' ? t('thisWeek') : t('midweek')
      return { title: t('oldClubTitle'), text: t(pick(['oldClub_0', 'oldClub_1'], k), { name: s.name, club: clubName(u, s.clubId), when, season: seasonLabel(s.season) }), chip: t('oldClubChip', { name: s.name }) }
    }
    case 'pressure': {
      const where = s.position ? t('boardWhere', { target: s.target, pos: s.position }) : ''
      return { title: t('pressureTitle'), text: t(s.canSack ? 'pressureSack' : 'pressure', { n: s.confidence, where }), chip: t('pressureChip', { n: s.confidence }) }
    }
    case 'run-in': {
      const lead = s.toPlay === 1 ? t('lastDay') : t('gamesToPlay', { n: s.toPlay })
      let where: string
      if (s.position === 1) where = s.gapTop > 0 ? t('runTop', { gap: points(s.gapTop) }) : t('runTopGd')
      else if (s.gapTop >= -6 && s.position <= 3) where = t('runOffTop', { pos: s.position, gap: points(-s.gapTop) })
      else if (s.gapSafety <= 3) where = s.gapSafety > 0 ? t('runAboveDrop', { gap: points(s.gapSafety) }) : t('runFromSafety', { gap: points(-s.gapSafety) })
      else where = t(s.position <= s.target ? 'runOnCourse' : 'runOffCourse', { pos: s.position, target: s.target })
      return { title: t('runTitle'), text: `${lead}${where}`, chip: s.toPlay === 1 ? t('runChipLast') : t('runChip', { n: s.toPlay }) }
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

/** A summer headline's two wordings (`head_treble_0`, `head_treble_1`…). */
const headlines = (stem: string) => [`${stem}_0`, `${stem}_1`] as Array<keyof typeof story.messages>

/** The summer's headline and the card's lines, from the review and the league's name. */
export function summerText(r: SummerReview, u: LoadedUniverse, key: string): SummerText {
  const rec = r.record
  const league = u.leagues.find((l) => l.id === rec.leagueId)?.name ?? t('league')
  const vars = { team: rec.teamName, season: seasonLabel(rec.leagueSeason), league, pos: rec.position, climb: r.climb ?? 0, slide: -(r.climb ?? 0) }
  const headline = t(pick(headlines(`head_${r.headline}`), `${key}|summer|${rec.year}`), vars)
  const lines: SummerText['lines'] = [
    { id: 'finish', text: t('summerFinish', { pos: rec.position, points: points(rec.points), w: rec.won, d: rec.drawn, l: rec.lost }) },
    { id: 'goals', text: t('summerGoals', { goals: goals(rec.goalsFor), against: rec.goalsAgainst }) },
  ]
  const cups: string[] = []
  if (rec.cupWon) cups.push(t('wonCup'))
  const first = !cups.length
  // A run out in the groups (engine 7, `G`) reads "the group stage", a knockout run its round
  const reached = rec.continentalRun && rec.continentalRun !== 'W' ? roundName(rec.continentalRun, true) ?? t('knockouts') : null
  if (rec.continentalWon) cups.push(t(first ? 'wonContinentalFirst' : 'wonContinental'))
  else if (reached) cups.push(t(first ? 'reachedContinentalFirst' : 'reachedContinental', { round: reached }))
  if (cups.length) lines.push({ id: 'cups', text: t('cupsLine', { list: list(cups) }) })
  const awards: string[] = []
  if (rec.bootName && rec.bootGoals) awards.push(t('topScorer', { name: rec.bootName, n: rec.bootGoals }))
  if (rec.potsName) awards.push(t('playerOfSeason', { name: rec.potsName }))
  if (awards.length) lines.push({ id: 'awards', text: t('awardsLine', { list: awards.join(t('awardsSep')) }) })
  if (r.previous) lines.push({ id: 'before', text: t('yearBefore', { pos: r.previous.position, points: points(r.previous.points) }) })
  if (r.seasons > 1) lines.push({ id: 'era', text: t('era', { titles: t('leagueTitles', { n: r.titles }), n: r.seasons }) })
  if (r.legend) lines.push({ id: 'legend', text: t('legend', { name: r.legend.name, goals: goals(r.legend.goals), games: games(r.legend.apps) }) })
  return { headline, lines }
}
