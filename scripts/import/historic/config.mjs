/**
 * Settings for the classic-seasons import (Premier League 1992-93 to 2007-08).
 *
 * The network step (`fetch.mjs`) writes raw responses under
 * `$DATA_CACHE/historic/`; `facts.mjs` turns that cache into the committed
 * `facts-<league>.json`; `index.mjs` (called by build.mjs) reads only the
 * committed files and the existing dataset cache, never the network.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CACHE } from '../config.mjs'

export const HISTORIC_DIR = path.dirname(fileURLToPath(import.meta.url))
export const HISTORIC_CACHE = path.join(CACHE, 'historic')
export const WP_CACHE = path.join(HISTORIC_CACHE, 'wp')
export const WD_CACHE = path.join(HISTORIC_CACHE, 'wd')

/** Classic seasons per league (start years). Only England so far. */
export const CLASSIC = {
  england: { from: 1992, to: 2007 },
}
export function classicSeasons(league) {
  const r = CLASSIC[league]
  return r ? Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i) : []
}

export const USER_AGENT = 'TouchLine-data-import/1.0 (open-data import for a fan football game; facts only, cached; contact: repo owner)'
/** Minimum pause between two requests to the same host, in ms (Wikipedia and Wikidata ask for polite, serial use). */
export const PAUSE_MS = { 'en.wikipedia.org': 4000, 'www.wikidata.org': 2000, api: 12000 }
/** Pages per batched request (api.php allows 50 titles; content responses stay a few MB). */
export const BATCH = { pages: 20, players: 25, entities: 40 }

/** "1992–93", "1999–2000", "2000–01": the season prefix English Wikipedia uses in article titles. */
export function wikiSeason(s) {
  return `${s}–${s + 1 === 2000 ? '2000' : String((s + 1) % 100).padStart(2, '0')}`
}

/**
 * English Wikipedia article of each club that played in the Premier League
 * 1992-93 to 2007-08. The club-season article is "<season> <title> season";
 * a renamed article resolves through its redirect.
 */
export const ENWIKI_CLUB = {
  arsenal: 'Arsenal F.C.',
  'aston-villa': 'Aston Villa F.C.',
  barnsley: 'Barnsley F.C.',
  'birmingham-city': 'Birmingham City F.C.',
  'blackburn-rovers': 'Blackburn Rovers F.C.',
  'bolton-wanderers': 'Bolton Wanderers F.C.',
  'bradford-city': 'Bradford City A.F.C.',
  'charlton-athletic': 'Charlton Athletic F.C.',
  chelsea: 'Chelsea F.C.',
  'coventry-city': 'Coventry City F.C.',
  'crystal-palace': 'Crystal Palace F.C.',
  'derby-county': 'Derby County F.C.',
  everton: 'Everton F.C.',
  fulham: 'Fulham F.C.',
  'ipswich-town': 'Ipswich Town F.C.',
  'leeds-united': 'Leeds United F.C.',
  'leicester-city': 'Leicester City F.C.',
  liverpool: 'Liverpool F.C.',
  'manchester-city': 'Manchester City F.C.',
  'manchester-united': 'Manchester United F.C.',
  middlesbrough: 'Middlesbrough F.C.',
  'newcastle-united': 'Newcastle United F.C.',
  'norwich-city': 'Norwich City F.C.',
  'nottingham-forest': 'Nottingham Forest F.C.',
  'oldham-athletic': 'Oldham Athletic A.F.C.',
  portsmouth: 'Portsmouth F.C.',
  'queens-park-rangers': 'Queens Park Rangers F.C.',
  reading: 'Reading F.C.',
  'sheffield-united': 'Sheffield United F.C.',
  'sheffield-wednesday': 'Sheffield Wednesday F.C.',
  southampton: 'Southampton F.C.',
  sunderland: 'Sunderland A.F.C.',
  'swindon-town': 'Swindon Town F.C.',
  'tottenham-hotspur': 'Tottenham Hotspur F.C.',
  watford: 'Watford F.C.',
  'west-bromwich-albion': 'West Bromwich Albion F.C.',
  'west-ham-united': 'West Ham United F.C.',
  'wigan-athletic': 'Wigan Athletic F.C.',
  wimbledon: 'Wimbledon F.C.',
  'wolverhampton-wanderers': 'Wolverhampton Wanderers F.C.',
}
export const clubSeasonTitle = (season, clubId) => `${wikiSeason(season)} ${ENWIKI_CLUB[clubId]} season`
/** The same title with the other suffix (F.C. / A.F.C.), tried when the first is not an article. */
export const altClubSeasonTitle = (season, clubId) => {
  const t = ENWIKI_CLUB[clubId]
  const alt = / A\.F\.C\.$/.test(t) ? t.replace(/ A\.F\.C\.$/, ' F.C.') : t.replace(/ F\.C\.$/, ' A.F.C.')
  return `${wikiSeason(season)} ${alt} season`
}
