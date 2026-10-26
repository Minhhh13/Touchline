/*
 * Every screen's hideable boxes for the Boxes control (`components/Boxes.tsx`). Essential controls are not listed and
 * cannot be hidden: the play and continue buttons, the draft's reel and landed squad, the result banner, decisions such
 * as offers for your players and job offers. Ids are storage values: never rename one (a new id starts shown).
 * The match-day dashboard's sets sit with its widget registry, in `matchday/widgetIds.ts`.
 */
import type { BoxSet } from './boxes'

const set = (screen: string, title: string, boxes: Array<[string, string]>, min?: number): BoxSet => ({ screen, title, boxes: boxes.map(([id, label]) => ({ id, label })), ...(min === undefined ? {} : { min }) })

/** The Dugout's head: the club strip and the assistant's briefing (the play buttons always stay). */
export const DUGOUT_HEAD = set('dugout', 'Dugout', [['club-header', 'Club header'], ['briefing', "Assistant's briefing"]], 0)

/**
 * The Dugout's tabs, by tab id (the Cup, Continental Cup and Inbox tabs are one box each). An open window's listings
 * (with Next market day) and the offers for your players always stay, so that tab may hide every box listed.
 */
export const DUGOUT_TABS: Record<string, BoxSet> = {
  squad: set('dugout-squad', 'Squad tab', [['squad-list', 'Squad list'], ['pitch', 'Pitch'], ['depth', 'Depth chart']]),
  next: set('dugout-next', 'Next match tab', [['opposition', 'Opposition report'], ['match-up', 'Unit against unit'], ['team-talk', 'Team talk']]),
  tactics: set('dugout-tactics', 'Tactics tab', [['formation', 'Formation'], ['instructions', 'Team instructions'], ['training', 'Training'], ['set-pieces', 'Set pieces'], ['roles', 'Roles']]),
  dressing: set('dugout-dressing', 'Dressing room tab', [['hierarchy', 'Hierarchy'], ['groups', 'Groups and atmosphere'], ['happiness', 'Happiness']]),
  planner: set('dugout-planner', 'Planner tab', [['squad-planner', 'Depth and needs'], ['contracts', 'Contracts'], ['medical', 'Medical']]),
  fixtures: set('dugout-fixtures', 'Fixtures tab', [['calendar', 'Season calendar'], ['fixture-list', 'Fixtures and results']]),
  table: set('dugout-table', 'Table tab', [['league-table', 'League table'], ['season-so-far', 'Season so far']]),
  stats: set('dugout-stats', 'Stats tab', [['records', 'Season records'], ['league-stats', 'League statistics'], ['data-hub', 'Data hub']]),
  market: set('dugout-market', 'Market tab', [['recruitment', 'Recruitment'], ['scout-reports', 'Scout reports'], ['shortlist', 'Shortlist'], ['values', 'Squad values']], 0),
  window: set('dugout-window', 'Market tab (window open)', [['recruitment', 'Recruitment'], ['scout-reports', 'Scout reports'], ['approach', 'Approach any player'], ['shortlist', 'Shortlist'], ['done-deals', 'Done deals'], ['log', 'Market log']], 0),
  club: set('dugout-club', 'Club tab', [['board', 'Board'], ['requests', 'Board requests'], ['finances', 'Finances'], ['staff', 'Backroom staff'], ['contracts', 'Contracts'], ['legends', 'Club legends'], ['achievements', 'Achievements']]),
}

/** Every Dugout set, for Reset. */
export const DUGOUT_ALL: BoxSet[] = [DUGOUT_HEAD, ...Object.values(DUGOUT_TABS)]

/** The draft's side boxes (the reel and the landed squad are where the picks happen, so they stay). */
export const DRAFT = set('draft', 'Draft', [['needs', 'Still need'], ['log', 'Draft log'], ['pitch', 'Pitch'], ['bench', 'Bench']], 0)

/** The summary's boxes beside the result (the result banner, job offers and challenge boxes always stay). */
export const SUMMARY = set('summary', 'Summary', [
  ['games', 'Game by game'],
  ['story', 'Season story'],
  ['january', 'January business'],
  ['bench', 'The bench'],
  ['europe', 'Continental Cup run'],
  ['records', 'Record books'],
  ['xi', 'Your XI'],
  ['awards', 'Awards'],
  ['squad-stats', 'Squad statistics'],
  ['table', 'Final table'],
  ['finances', 'Finances'],
  ['history', 'Dynasty history'],
  ['share', 'Share card and text'],
])

/** The quick season's playback (the January window, a decision, always stays). */
export const PLAYBACK = set('playback', 'Season', [['games', 'Game by game'], ['table', 'Live table'], ['chart', 'Position chart'], ['bench', 'The bench']])

/** The post-match report (the scoreboard and Continue always stay). */
export const REPORT = set('report', 'Match report', [['goals', 'Goals'], ['stats', 'Match stats'], ['charts', 'Charts'], ['people', 'Ratings and notes']])

/** Explore database, the Seasons view. */
export const EXPLORE = set('explore', 'Seasons', [['table', 'League table'], ['squad', 'Squad']])

/** The Profile page. */
export const PROFILE = set('profile', 'Profile', [
  ['manager', 'Manager and settings'],
  ['cabinet', 'Trophy cabinet'],
  ['room', 'Trophy Room'],
  ['chase', 'The 38-0 chase'],
  ['achievements', 'Achievements'],
  ['save', 'Save data'],
  ['seasons', 'Best seasons'],
  ['runs', 'Best runs'],
  ['runins', 'Run-ins'],
])

/** Every set outside the dashboard, for the tests. */
export const ALL_SETS: BoxSet[] = [...DUGOUT_ALL, DRAFT, SUMMARY, PLAYBACK, REPORT, EXPLORE, PROFILE]
