/**
 * Network step of the classic-seasons import. Run by hand, never by build.mjs
 * or CI; like enrich-nations.mjs it only refreshes a cache and the committed
 * facts file is the input of record.
 *
 *   node scripts/import/historic/fetch.mjs [england] [--step seasons|players|wikidata|all]
 *
 * 1. seasons:  the English Wikipedia club-season article of every club in each
 *              classic table ("1992–93 Manchester United F.C. season").
 * 2. players:  every player linked from those articles' squad lists, stats
 *              tables and league scorer lines (wikitext, redirect, Wikidata id).
 * 3. wikidata: the Wikidata entity of every player, then of every club and
 *              national team in their P54 spells (to tell national teams apart).
 *
 * Everything lands in $DATA_CACHE/historic (see cache.mjs). About 300 article
 * requests and 150 batched entity requests from cold; nothing on a warm cache.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config.mjs'
import { classicSeasons, clubSeasonTitle, altClubSeasonTitle, BATCH } from './config.mjs'
import { fetchWpPages, wpPage, fetchWdEntities, wdEntity, requestCount } from './cache.mjs'

const args = process.argv.slice(2)
const step = args.includes('--step') ? args[args.indexOf('--step') + 1] : 'all'
const league = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--step') ?? 'england'
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, league, 'meta.json'), 'utf8'))

/** (season, clubId, title) for every club in every classic table. */
export function clubSeasonList(m = meta, lg = league) {
  const out = []
  for (const s of classicSeasons(lg)) {
    const table = m.historicTables?.[s] ?? m.seasons.find((x) => x.season === s)?.table
    if (!table) throw new Error(`no ${s} table in ${lg}/meta.json: build the tables first`)
    for (const row of table) {
      const first = clubSeasonTitle(s, row.clubId)
      const alt = altClubSeasonTitle(s, row.clubId)
      // the article is the first title that exists (once both are cached); before the fetch, the first
      const title = wpPage(first)?.missing && wpPage(alt) && !wpPage(alt).missing ? alt : first
      out.push({ season: s, clubId: row.clubId, row, title, alt })
    }
  }
  return out
}

let list = clubSeasonList()
if (step === 'seasons' || step === 'all') {
  console.log(`club-season articles: ${list.length}`)
  // the articles' own Wikidata ids are not needed (the club is found through its players' spells)
  fetchWpPages(list.map((x) => x.title), { size: BATCH.pages, label: 'club-season articles', ids: false })
  fetchWpPages(list.filter((x) => wpPage(x.title)?.missing).map((x) => x.alt), { size: BATCH.pages, label: 'alternative titles', ids: false })
  list = clubSeasonList()
  const missing = list.filter((x) => wpPage(x.title)?.missing)
  if (missing.length) console.log(`  MISSING articles: ${missing.map((x) => x.title).join('; ')}`)
}

if (step === 'players' || step === 'all') {
  const { parseSeasonArticle, linkedTitles } = await import('./parse-season.mjs')
  const titles = new Set()
  for (const x of list) {
    const page = wpPage(x.title)
    if (!page || page.missing) continue
    for (const t of linkedTitles(parseSeasonArticle(page.text, { season: x.season, row: x.row }))) titles.add(t)
  }
  console.log(`player pages: ${titles.size} linked titles`)
  fetchWpPages([...titles].sort(), { size: BATCH.players, label: 'player pages' })
}

if (step === 'wikidata' || step === 'all') {
  const { parseSeasonArticle, linkedTitles } = await import('./parse-season.mjs')
  const qids = new Set()
  for (const x of list) {
    const page = wpPage(x.title)
    if (!page || page.missing) continue
    for (const t of linkedTitles(parseSeasonArticle(page.text, { season: x.season, row: x.row }))) {
      const p = wpPage(t)
      if (p?.qid) qids.add(p.qid)
    }
  }
  console.log(`player entities: ${qids.size}`)
  fetchWdEntities([...qids].sort(), { label: 'player entities' })
  // second level: the teams of every P54 spell and the nationality items (labels, P31 national-team class)
  const second = new Set()
  for (const q of qids) {
    const e = wdEntity(q)
    for (const c of e?.claims?.P54 ?? []) second.add(c.v)
    for (const p of ['P1532', 'P27', 'P413']) for (const c of e?.claims?.[p] ?? []) second.add(c.v)
  }
  console.log(`team, country and position entities: ${second.size}`)
  fetchWdEntities([...second].sort(), { label: 'team entities' })
}
console.log(`done, ${requestCount()} requests`)
