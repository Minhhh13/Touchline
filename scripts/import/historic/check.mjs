/**
 * Checks on the committed classic facts; exits non-zero when one fails.
 *
 *   node scripts/import/historic/check.mjs [england] [--rerun]
 *
 * Needs no network and no cache, so it can run in CI. With --rerun it also
 * rebuilds the facts from the fetch cache and requires a byte-identical file.
 *
 *  - every classic season has facts, for every club in its table;
 *  - every club-season says where its appearances come from (a validated
 *    table, or estimated) and has player goals within 5 of the club's goals
 *    for; fewer than 18 players or 2 keepers is reported as a warning (the
 *    table needs every entrant, so a thin club ships anyway);
 *  - every row has a Wikidata id, a birth date, an age of 15-42, a share in 0-1
 *    and no duplicate within its club-season;
 *  - at least 85% of rows carry the contemporary Wikipedia nationality code.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config.mjs'
import { classicSeasons } from './config.mjs'
import { FACTS_FILE } from './facts.mjs'

const args = process.argv.slice(2)
const league = args.find((a) => !a.startsWith('--')) ?? 'england'
const problems = []
const warnings = []
const text = fs.readFileSync(FACTS_FILE(league), 'utf8')
const facts = JSON.parse(text)
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, league, 'meta.json'), 'utf8'))
let rows = 0
let wikiNat = 0
for (const S of classicSeasons(league)) {
  const table = meta.historicTables?.[S] ?? meta.seasons.find((s) => s.season === S)?.table ?? []
  const fsn = facts.seasons.find((s) => s.season === S)
  if (!fsn) { problems.push(`${S}: no facts`); continue }
  for (const row of table) {
    const c = fsn.clubs.find((x) => x.clubId === row.clubId)
    if (!c) { problems.push(`${S} ${row.clubId}: no facts`); continue }
    if (!['table', 'estimated'].includes(c.appsSource)) problems.push(`${S} ${c.clubId}: appsSource ${c.appsSource}`)
    if (c.players.length < 18) warnings.push(`${S} ${c.clubId}: ${c.players.length} players`)
    if (c.players.filter((p) => p.coarse === 'GK').length < 2) warnings.push(`${S} ${c.clubId}: fewer than 2 keepers`)
    const goals = c.players.reduce((s, p) => s + p.goals, 0)
    if (Math.abs(goals - row.gf) > 5) problems.push(`${S} ${c.clubId}: player goals ${goals.toFixed(1)} vs GF ${row.gf}`)
    const seen = new Set()
    for (const p of c.players) {
      rows++
      if (p.natSrc === 'wikipedia') wikiNat++
      if (!/^Q\d+$/.test(p.qid ?? '')) problems.push(`${S} ${c.clubId}: ${p.name} has no Wikidata id`)
      if (!p.dob) problems.push(`${S} ${c.clubId}: ${p.name} has no birth date`)
      if (!(p.age >= 15 && p.age <= 42)) problems.push(`${S} ${c.clubId}: ${p.name} age ${p.age}`)
      if (!(p.share >= 0 && p.share <= 1)) problems.push(`${S} ${c.clubId}: ${p.name} share ${p.share}`)
      if (seen.has(p.qid)) problems.push(`${S} ${c.clubId}: ${p.qid} twice`)
      seen.add(p.qid)
    }
  }
}
if (wikiNat / Math.max(1, rows) < 0.85) problems.push(`contemporary nationality codes on ${(100 * wikiNat / rows).toFixed(1)}% of rows (< 85%)`)
if (args.includes('--rerun')) {
  const { buildFacts, stringifyFacts } = await import('./facts.mjs')
  if (stringifyFacts(buildFacts(league).facts) !== text) problems.push('rebuilding the facts from the cache does not give the committed file')
}
console.log(`${league}: ${facts.seasons.length} seasons, ${rows} rows, contemporary nationality ${(100 * wikiNat / Math.max(1, rows)).toFixed(1)}%`)
if (warnings.length) console.log(`${warnings.length} warning(s):\n  ` + warnings.join('\n  '))
if (problems.length) {
  console.log(`${problems.length} problem(s):\n  ` + problems.join('\n  '))
  process.exit(1)
}
console.log('All checks passed')
