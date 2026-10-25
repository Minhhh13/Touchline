import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CACHE = process.env.DATA_CACHE || path.join(ROOT, '.cache', 'datasets')

/**
 * Public dataset sources. Kaggle datasets download through an unauthenticated
 * redirect to a signed storage URL. All of these are published under open
 * licences by their authors; see docs/DATA.md for attribution.
 */
export const SOURCES = {
  fc24: {
    url: 'https://www.kaggle.com/api/v1/datasets/download/stefanoleone992/ea-sports-fc-24-complete-player-dataset',
    zip: 'fc24.zip',
    dir: 'fc24',
    files: ['male_players.csv', 'male_teams.csv'],
    licence: 'CC0 1.0',
    credit: 'Stefano Leone, "EA Sports FC 24 complete player dataset" (Kaggle)',
  },
  fc25: {
    url: 'https://www.kaggle.com/api/v1/datasets/download/nyagami/ea-sports-fc-25-database-ratings-and-stats',
    zip: 'fc25.zip',
    dir: 'fc25',
    files: ['male_players.csv'],
    licence: 'Apache 2.0',
    credit: 'nyagami, "EA SPORTS FC 25 database, ratings and stats" (Kaggle)',
  },
  fc26: {
    url: 'https://www.kaggle.com/api/v1/datasets/download/justdhia/ea-sports-fc-26-player-ratings',
    zip: 'fc26.zip',
    dir: 'fc26',
    files: ['ea_fc26_players.csv'],
    licence: 'CC0 1.0',
    credit: 'justdhia, "EA Sports FC 26 Player Ratings" (Kaggle)',
  },
  fc27: {
    url: 'https://www.kaggle.com/api/v1/datasets/download/mikedpad/ea-sports-fc27-player-ratings',
    zip: 'fc27.zip',
    dir: 'fc27',
    files: ['players.csv'],
    licence: 'Unofficial non-commercial snapshot of EA public ratings (see dataset README)',
    credit: 'mikedpad, "EA SPORTS FC 27 Player Ratings" (Kaggle)',
  },
  eurosoccer: {
    url: 'https://www.kaggle.com/api/v1/datasets/download/hugomathien/soccer',
    zip: 'eurosoccer.zip',
    dir: 'eurosoccer',
    files: ['database.sqlite'],
    licence: 'ODbL',
    credit: 'Hugo Mathien, "European Soccer Database" (Kaggle)',
  },
}

export const OPENFOOTBALL_BASE = 'https://raw.githubusercontent.com'
/** Last season start year with a results file we try to fetch (the current season). */
export const OPENFOOTBALL_LAST = 2026
/** Season start years with a results file we try to fetch for a league without its own `openfootball.from`. */
export const OPENFOOTBALL_SEASONS = Array.from({ length: OPENFOOTBALL_LAST - 1999 }, (_, i) => 2000 + i) // 2000-01 .. 2026-27
/** The seasons to fetch for one league: England's files start with the Premier League in 1992-93. */
export function openfootballSeasons(league) {
  const from = league?.openfootball?.from ?? 2000
  return Array.from({ length: OPENFOOTBALL_LAST - from + 1 }, (_, i) => from + i)
}
/**
 * Path of a season's folder inside an openfootball repository: seasons before
 * 2000-01 live under `archive/<decade>s/` (1999-00 is in `archive/1990s`).
 */
export function openfootballPath(season) {
  const slug = seasonSlug(season)
  return season < 2000 ? `archive/${Math.floor(season / 10) * 10}s/${slug}` : slug
}
export const DATA_DIR = path.join(ROOT, 'public', 'data')

export function seasonSlug(startYear) {
  const end = String((startYear + 1) % 100).padStart(2, '0')
  return `${startYear}-${end}`
}
