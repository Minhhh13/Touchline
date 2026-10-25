/**
 * Registry of the leagues the game ships with, and how each dataset names them.
 */
import { CLUBS as ENGLAND } from './clubs-england.mjs'
import { LEAGUES as EUROPE } from './clubs-europe.mjs'

export const LEAGUES = {
  england: {
    id: 'england',
    name: 'Premier League',
    shortName: 'England',
    country: 'England',
    clubs: ENGLAND,
    fc24LeagueId: 13,
    eaNames: ['Premier League'],
    euroLeagueId: 1729,
    // The Premier League from its first season; 22 clubs (462 matches) until 1994-95, 20 (380) since
    openfootball: { repo: 'openfootball/england', file: '1-premierleague.txt', from: 1992, clubs: (season) => (season <= 1994 ? 22 : 20) },
  },
  ...EUROPE,
}

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[’']/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const aliasMaps = new Map()
function aliasMap(leagueId) {
  if (!aliasMaps.has(leagueId)) {
    const m = new Map()
    for (const club of LEAGUES[leagueId].clubs) for (const a of club.aliases) m.set(norm(a), club.id)
    aliasMaps.set(leagueId, m)
  }
  return aliasMaps.get(leagueId)
}

/** Resolve a dataset club name within a league to our club id, or undefined. */
export function clubIdIn(leagueId, name) {
  if (!name || !LEAGUES[leagueId]) return undefined
  const m = aliasMap(leagueId)
  const n = norm(name)
  if (m.has(n)) return m.get(n)
  const stripped = n.replace(/\b(fc|afc|cf|sc|ac|as|us|ss|ssc|rc|rcd|ud|sd|cd|ca|sv|vfl|vfb|tsg|fsv|bsc)\b/g, '').replace(/\s+/g, ' ').trim()
  if (stripped && m.has(stripped)) return m.get(stripped)
  return undefined
}

export const FC24_LEAGUE_BY_ID = Object.fromEntries(Object.values(LEAGUES).map((l) => [l.fc24LeagueId, l.id]))
export const EA_LEAGUE_BY_NAME = Object.fromEntries(Object.values(LEAGUES).flatMap((l) => l.eaNames.map((n) => [n, l.id])))
export const EURO_LEAGUE_BY_ID = Object.fromEntries(Object.values(LEAGUES).map((l) => [l.euroLeagueId, l.id]))
