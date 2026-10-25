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
/** Season start years with a results file we try to fetch. */
export const OPENFOOTBALL_SEASONS = Array.from({ length: 27 }, (_, i) => 2000 + i) // 2000-01 .. 2026-27
export const DATA_DIR = path.join(ROOT, 'public', 'data')

export function seasonSlug(startYear) {
  const end = String((startYear + 1) % 100).padStart(2, '0')
  return `${startYear}-${end}`
}
