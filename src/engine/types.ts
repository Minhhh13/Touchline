/**
 * Core domain types shared by the engine, the game store and the UI.
 */

export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'CM' | 'AM' | 'LW' | 'RW' | 'ST'

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'ATT'

/** All attributes are on a 1..99 scale. */
export interface Attributes {
  pace: number
  shooting: number
  passing: number
  dribbling: number
  defending: number
  physical: number
  /** Decision making, composure, work-rate, leadership rolled into one. */
  mentality: number
  /** Reflexes, handling, positioning. Only meaningful for goalkeepers. */
  goalkeeping: number
}

export type AttributeKey = keyof Attributes

/** Hidden traits in [0, 1]. Not shown directly, but they shape the season. */
export interface Traits {
  /** How often the player performs to their rating (1 = metronome). */
  consistency: number
  /** Likelihood of picking up injuries (1 = glass). */
  injuryProneness: number
  /** Raises their game in important matches. */
  bigMatch: number
  /** Affects development, morale stability and discipline. */
  professionalism: number
}

export interface Club {
  id: string
  /** League the club belongs to in this data pack. */
  leagueId: string
  name: string
  shortName: string
  /** Three-letter code for compact UI. */
  code: string
  city: string
  nickname: string
  founded: number
  colours: { primary: string; secondary: string }
  /** Traditional playing identity, used when the club is an AI opponent. */
  style: PlayStyle
  /** Historic rivals, for derby matches. */
  rivals: string[]
}

/**
 * One player's attributes and context in one specific season.
 * This is the unit that the wheel drafts, exactly like a "player season" in 38-0.
 */
export interface PlayerSeason {
  /** Unique per player-season: `${playerId}@${season}@${clubId}`. */
  id: string
  /** Stable across seasons for the same human being. */
  playerId: string
  name: string
  nationality: string
  /** Age during the season. */
  age: number
  clubId: string
  /** Season start year: 2004 means the 2004-05 season. */
  season: number
  /** Natural positions, primary first. */
  positions: Position[]
  attributes: Attributes
  traits: Traits
  /** Overall rating at the primary position, 1..99. */
  overall: number
  /** Market value in today's money, GBP millions. */
  value: number
  /** Weekly wage, GBP thousands. */
  wage: number
  foot: 'L' | 'R'
  /** Height in cm, 0 if unknown. */
  height: number
  /** Accolades earned that season, e.g. "Champion". */
  accolades: string[]
}

export interface ClubSeason {
  clubId: string
  leagueId: string
  season: number
  /** Final league position that season (1..20); undefined if not in the top flight. */
  position: number
  points: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  champions: boolean
  /** False while the real season is still being played. */
  complete: boolean
  squad: PlayerSeason[]
}

export interface LeagueSeasonRow {
  clubId: string
  position: number
  points: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
}

export interface LeagueInfo {
  id: string
  name: string
  shortName: string
  country: string
  firstSeason: number
  lastSeason: number
  playerSeasons: number
  players: number
  clubs: number
}

export interface Universe {
  /** Seed the universe was generated from. */
  seed: string
  /** Leagues currently loaded. */
  leagues: LeagueInfo[]
  clubs: Club[]
  /** Only top-flight club-seasons, which is what the wheel can land on. */
  clubSeasons: ClubSeason[]
  /** League tables by league id, then season start year. */
  tables: Record<string, Record<number, LeagueSeasonRow[]>>
  firstSeason: number
  lastSeason: number
  /** Fast lookup by player-season id. */
  index: Record<string, PlayerSeason>
}

export interface FormationSlot {
  id: string
  position: Position
  /** Pitch coordinates in percent, x = 0 left touchline, y = 0 own goal line. */
  x: number
  y: number
}

export interface Formation {
  id: string
  name: string
  slots: FormationSlot[]
  /** Short description of what the shape is good at. */
  blurb: string
}

export type Mentality = 'defensive' | 'balanced' | 'attacking'
export type Pressing = 'low' | 'mid' | 'high'
export type Tempo = 'slow' | 'standard' | 'fast'
export type Width = 'narrow' | 'standard' | 'wide'

export type DefensiveLine = 'deep' | 'standard' | 'high'
export type PassingStyle = 'short' | 'mixed' | 'direct'

export interface Tactics {
  formationId: string
  mentality: Mentality
  pressing: Pressing
  tempo: Tempo
  width: Width
  defensiveLine: DefensiveLine
  passing: PassingStyle
  /** Role id per formation slot id. Missing slots use the position's default role. */
  roles: Record<string, string>
  /** Designated set-piece takers (player-season ids). Missing = best available on the pitch. */
  setPieces?: { penalties?: string; freeKicks?: string; corners?: string }
}

/** Broad tactical identity of an AI-controlled club. */
export type PlayStyle = 'possession' | 'counter' | 'direct' | 'press' | 'defensive' | 'balanced'

export interface Injury {
  description: string
  /** Matchweeks remaining before the player is available again. */
  weeksOut: number
}

/**
 * A drafted player's live state over the course of a season.
 * Static identity lives on the `PlayerSeason`, dynamic state lives here.
 */
export interface SquadPlayer {
  playerSeasonId: string
  /** 0..100 physical freshness. Drops with minutes, recovers between matches. */
  condition: number
  /** 0..100 happiness. Playing time, results, and form move it. */
  morale: number
  /** 0..100 match sharpness. Rises with minutes, decays on the bench. */
  sharpness: number
  /** 0..100 familiarity with the manager's system. Rises with starts. */
  familiarity: number
  /** Recent match ratings (most recent last), used for form. */
  recentRatings: number[]
  /** Minutes played in each of the last six matchweeks (most recent last), league and cup together; absent on older saves. */
  recentMinutes?: number[]
  injury: Injury | null
  /** Matches remaining of a suspension. */
  suspension: number
  yellowCards: number
  seasonStats: {
    apps: number
    starts: number
    goals: number
    assists: number
    minutes: number
    ratingSum: number
    cleanSheets: number
    motm: number
  }
}

/** Mapping from formation slot id to player-season id. */
export type Lineup = Record<string, string>

export type MatchEventType =
  | 'goal'
  | 'penalty'
  | 'own_goal'
  | 'yellow'
  | 'red'
  | 'injury'
  | 'substitution'
  | 'chance'
  | 'save'
  | 'kickoff'
  | 'half_time'
  | 'full_time'

export interface MatchEvent {
  minute: number
  type: MatchEventType
  /** 'home' | 'away' */
  side: 'home' | 'away'
  /** Primary player involved (scorer, carded player, injured player, player coming off). */
  playerId?: string
  playerName?: string
  /** Secondary player (assister, player coming on). */
  secondaryId?: string
  secondaryName?: string
  text: string
  /** Where a shot was taken from (goals, penalties, own goals, chances and saves): x 0..100 along the pitch towards the attacking goal, y 0..100 across. Absent on results written before the pitch views. */
  position?: { x: number; y: number }
}

export interface PlayerMatchStats {
  playerSeasonId: string
  minutes: number
  goals: number
  assists: number
  rating: number
  yellow: boolean
  red: boolean
  injured: Injury | null
}

export interface MatchTeamSheet {
  teamId: string
  teamName: string
  lineup: Lineup
  bench: string[]
  tactics: Tactics
  /** Pre-computed per-unit strengths, see ratings.ts. */
  strength: TeamStrength
}

export interface TeamStrength {
  goalkeeping: number
  defence: number
  midfield: number
  attack: number
  /** 0..1, how evenly distributed the quality is across units. */
  balance: number
  /** -5..+5 rating points from chemistry links. */
  chemistry: number
  /** Overall team rating used for AI opponents and quick comparisons. */
  overall: number
}

export interface MatchResult {
  homeTeamId: string
  awayTeamId: string
  homeGoals: number
  awayGoals: number
  events: MatchEvent[]
  homeStats: PlayerMatchStats[]
  awayStats: PlayerMatchStats[]
  /** Expected goals used for the simulation, for post-match analysis. */
  xg: { home: number; away: number }
  motmId?: string
}

export interface Fixture {
  matchweek: number
  homeTeamId: string
  awayTeamId: string
  result?: MatchResult
}

export interface TableRow {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
  /** Last 5 results, oldest first: 'W' | 'D' | 'L'. */
  form: Array<'W' | 'D' | 'L'>
}

export type SeasonTier =
  | 'PERFECT'
  | 'INVINCIBLE'
  | 'CHAMPIONS'
  | 'TITLE_RACE'
  | 'EUROPEAN'
  | 'MID_TABLE'
  | 'RELEGATION_BATTLE'
  | 'RELEGATED'
