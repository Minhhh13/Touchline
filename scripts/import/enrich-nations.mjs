/**
 * Fill in nationalities for players the EA datasets never covered (mostly
 * 2008-2014 players who retired before FIFA 15) by asking Wikidata for the
 * citizenship of footballers with a matching name and date of birth.
 *
 *   node scripts/import/enrich-nations.mjs
 *
 * Writes scripts/import/nations-override.json, which build.mjs applies.
 * The file is committed so normal builds need no network access.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CACHE, SOURCES, ROOT } from './config.mjs'
import { nation } from './nations.mjs'

const OUT = path.join(ROOT, 'scripts', 'import', 'nations-override.json')
const ENDPOINT = 'https://query.wikidata.org/sparql'

async function main() {
  let existing = {}
  try {
    existing = JSON.parse(await readFile(OUT, 'utf8'))
  } catch {}

  const players = JSON.parse(await readFile(path.join(ROOT, 'public', 'data', 'england', 'players.json'), 'utf8'))
  const col = Object.fromEntries(players.columns.map((c, i) => [c, i]))
  const unknownIds = new Set(players.rows.filter((r) => r[col.nation] === 'UNK').map((r) => r[col.id]))
  console.log(`${unknownIds.size} players with unknown nationality`)

  const db = new DatabaseSync(path.join(CACHE, SOURCES.eurosoccer.dir, 'database.sqlite'), { readOnly: true })
  const targets = []
  for (const p of db.prepare('select player_api_id, player_name, player_fifa_api_id, birthday from Player').all()) {
    const id = p.player_fifa_api_id != null ? `s${p.player_fifa_api_id}` : `e${p.player_api_id}`
    if (!unknownIds.has(id)) continue
    targets.push({ id, name: p.player_name, dob: String(p.birthday).slice(0, 10) })
  }
  db.close()
  console.log(`${targets.length} to look up on Wikidata`)

  const results = { ...existing }
  const batchSize = 40
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize)
    const values = batch.map((t) => `("${t.name.replace(/"/g, '\\"')}"@en "${t.dob}T00:00:00Z"^^xsd:dateTime)`).join(' ')
    const query = `
SELECT ?label ?dobIn ?countryLabel ?sport WHERE {
  VALUES (?label ?dobIn) { ${values} }
  ?item rdfs:label ?label .
  ?item wdt:P31 wd:Q5 .
  ?item wdt:P569 ?dob .
  FILTER(?dob = ?dobIn)
  { ?item wdt:P1532 ?country . BIND(1 AS ?sport) } UNION { ?item wdt:P27 ?country . BIND(0 AS ?sport) }
  ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en")
}`
    try {
      const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'touchline-game-data/1.0 (open source football game; data enrichment)' } })
      if (!res.ok) {
        console.log(`  batch ${i}: HTTP ${res.status}`)
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      const json = await res.json()
      const byName = new Map()
      // Country for sport (P1532) beats citizenship (P27): sort so sport entries come first.
      const bindings = [...json.results.bindings].sort((x, y) => Number(y.sport?.value ?? 0) - Number(x.sport?.value ?? 0))
      for (const b of bindings) {
        const key = `${b.label.value}|${b.dobIn.value.slice(0, 10)}`
        if (!byName.has(key)) byName.set(key, [])
        byName.get(key).push(b.countryLabel.value)
      }
      let found = 0
      for (const t of batch) {
        const countries = byName.get(`${t.name}|${t.dob}`)
        if (!countries) continue
        // Prefer a country we can map; when several citizenships exist pick the first mappable.
        const mapped = countries.map((c) => nation(normaliseCountry(c)).code).filter((c) => c !== 'UNK')
        if (mapped.length) {
          results[t.id] = mapped[0]
          found++
        }
      }
      console.log(`  batch ${i / batchSize + 1}/${Math.ceil(targets.length / batchSize)}: ${found}/${batch.length} resolved`)
    } catch (e) {
      console.log(`  batch ${i}: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
  await writeFile(OUT, JSON.stringify(results, null, 0))
  console.log(`wrote ${Object.keys(results).length} overrides to ${OUT}`)
}

function normaliseCountry(c) {
  const map = {
    'United Kingdom': 'England',
    'Kingdom of the Netherlands': 'Netherlands',
    'Republic of Ireland': 'Republic of Ireland',
    'Ivory Coast': 'Ivory Coast',
    'Democratic Republic of the Congo': 'Congo DR',
    'Republic of the Congo': 'Congo',
    'Czech Republic': 'Czech Republic',
    'South Korea': 'Korea Republic',
    'Trinidad and Tobago': 'Trinidad and Tobago',
    'Federal Republic of Yugoslavia': 'Serbia',
    'Serbia and Montenegro': 'Serbia',
    'Socialist Federal Republic of Yugoslavia': 'Serbia',
    'Soviet Union': 'Russia',
    Czechoslovakia: 'Czech Republic',
    'Bosnia and Herzegovina': 'Bosnia and Herzegovina',
    'Cape Verde': 'Cape Verde',
    'The Gambia': 'Gambia',
    'Republic of Macedonia': 'North Macedonia',
    'North Macedonia': 'North Macedonia',
    'People\'s Republic of China': 'China PR',
  }
  return map[c] ?? c
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
