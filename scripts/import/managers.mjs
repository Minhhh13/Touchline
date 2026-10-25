/**
 * The managers of every club-season in the packs, from Wikidata's head coach statements (P286, with their start time
 * P580 and end time P582 qualifiers), for the Quick Draft's manager pick.
 *
 *   node scripts/import/managers.mjs
 *
 * Polite: SPARQL only, one request at a time with a pause between them, a retry that honours Retry-After, and every
 * response cached under `.cache/managers/` (gitignored), so a second run sends nothing. Wikidata is CC0.
 *
 * Writes `src/engine/data/managers.json`, which the game bundles (it is small and changes only when this runs):
 *   { source, generatedAt, managers: { <qid>: [name, style] }, seasons: { <clubId>: { <season>: [qid, ...] } } }
 * The first qid of a club-season is the man in charge for longest between July and June, a second one only when he
 * was in charge for a good part of the season too. A club-season with no usable statement is left out (the game
 * offers invented archetypes in its place).
 *
 * The style is ours, not Wikidata's: a short list of well-known managers is written below by hand; anyone else gets
 * the style of the clubs he managed in the packs (the club's playing style, or youth when his squads were young).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { ROOT } from './config.mjs'
import { LEAGUES } from './leagues.mjs'

const ENDPOINT = 'https://query.wikidata.org/sparql'
const UA = 'touchline-game-data/1.0 (open source football game; manager facts; polite batch script)'
const CACHE_DIR = path.join(ROOT, '.cache', 'managers')
const OUT = path.join(ROOT, 'src', 'engine', 'data', 'managers.json')
const PAUSE_MS = 1500
/** Wikidata's country of each league's clubs (P17); Monaco plays in Ligue 1. */
const COUNTRY = { england: ['Q145', 'Q21'], spain: ['Q29'], italy: ['Q38'], germany: ['Q183'], france: ['Q142', 'Q235'], netherlands: ['Q55', 'Q29999'], portugal: ['Q45'] }
/** Clubs whose label search finds the wrong item or none: our club id to its Wikidata item. */
const CLUB_QID = {
  chelsea: 'Q9616', 'fc-barcelona': 'Q7156', almeria: 'Q10407', huesca: 'Q11971', livorno: 'Q6767', portimonense: 'Q621120', 'uniao-madeira': 'Q1762119',
}
/** Styles of well-known managers, by the name Wikidata gives them. Our own reading of how their sides played. */
const KNOWN_STYLES = {
  'Jürgen Klopp': 'pressing', 'Pep Guardiola': 'attacking', 'José Mourinho': 'defensive', 'Diego Simeone': 'defensive', 'Arsène Wenger': 'youth',
  'Alex Ferguson': 'attacking', 'Carlo Ancelotti': 'balanced', 'Antonio Conte': 'defensive', 'Mauricio Pochettino': 'pressing', 'Thomas Tuchel': 'pressing',
  'Julian Nagelsmann': 'pressing', 'Ralf Rangnick': 'pressing', 'Marcelo Bielsa': 'pressing', 'Gian Piero Gasperini': 'pressing', 'Maurizio Sarri': 'attacking',
  'Tony Pulis': 'set-pieces', 'Sam Allardyce': 'set-pieces', 'Sean Dyche': 'set-pieces', 'Mikel Arteta': 'pressing', 'Unai Emery': 'balanced',
  'Zinedine Zidane': 'balanced', 'Luis Enrique': 'attacking', 'Xavi': 'attacking', 'Rafael Benítez': 'defensive', 'Roberto Mancini': 'balanced',
  'Massimiliano Allegri': 'defensive', 'Claudio Ranieri': 'defensive', 'Jupp Heynckes': 'balanced', 'Hansi Flick': 'attacking', 'Erik ten Hag': 'attacking',
  'Louis van Gaal': 'youth', 'Ronald Koeman': 'balanced', 'Ange Postecoglou': 'attacking', 'Roberto De Zerbi': 'attacking', 'Brendan Rodgers': 'attacking',
  'Eddie Howe': 'pressing', 'Thomas Frank': 'set-pieces', 'Marco Silva': 'attacking', 'David Moyes': 'defensive', 'Roy Hodgson': 'defensive',
  'Harry Redknapp': 'attacking', 'Gareth Southgate': 'balanced', 'Frank Lampard': 'youth', 'Ole Gunnar Solskjær': 'balanced', 'Xabi Alonso': 'pressing',
  'Lucien Favre': 'attacking', 'Peter Bosz': 'pressing', 'Christian Streich': 'youth', 'Zdeněk Zeman': 'attacking', 'Luciano Spalletti': 'attacking',
  'Simone Inzaghi': 'balanced', 'Stefano Pioli': 'pressing', 'Ernesto Valverde': 'balanced', 'Manuel Pellegrini': 'attacking', 'Jorge Jesus': 'attacking',
  'Sérgio Conceição': 'pressing', 'Rúben Amorim': 'pressing', 'André Villas-Boas': 'pressing', 'Leonardo Jardim': 'youth', 'Christophe Galtier': 'balanced',
  'Laurent Blanc': 'attacking', 'Rudi Garcia': 'attacking', 'Marcelino': 'pressing', 'Quique Setién': 'attacking', 'Jürgen Röber': 'balanced',
}
/** A club's playing style (meta.json) as a manager style. */
const FROM_CLUB = { press: 'pressing', possession: 'attacking', counter: 'balanced', direct: 'set-pieces', defensive: 'defensive', balanced: 'balanced' }
/** Average age of a club-season's best sixteen under which its manager counts as a youth coach. */
const YOUNG_SQUAD = 24.6

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function sparql(query) {
  const key = createHash('sha1').update(query).digest('hex')
  const file = path.join(CACHE_DIR, `${key}.json`)
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {}
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `query=${encodeURIComponent(query)}` })
    if (res.ok) {
      const json = await res.json()
      await writeFile(file, JSON.stringify(json))
      await sleep(PAUSE_MS)
      return json
    }
    const wait = Number(res.headers.get('retry-after')) || 10 * (attempt + 1)
    console.log(`  HTTP ${res.status}, waiting ${wait}s`)
    await sleep(wait * 1000)
  }
  throw new Error('Wikidata did not answer')
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Every club in the packs with its seasons, league and the names worth searching for. */
async function packClubs() {
  const leagues = JSON.parse(await readFile(path.join(ROOT, 'public', 'data', 'leagues.json'), 'utf8')).leagues
  const clubs = new Map()
  for (const l of leagues) {
    const meta = JSON.parse(await readFile(path.join(ROOT, 'public', 'data', l.id, 'meta.json'), 'utf8'))
    const players = JSON.parse(await readFile(path.join(ROOT, 'public', 'data', l.id, 'players.json'), 'utf8'))
    const col = Object.fromEntries(players.columns.map((c, i) => [c, i]))
    const table = Object.fromEntries((LEAGUES[l.id]?.clubs ?? []).map((c) => [c.id, c]))
    for (const c of meta.clubs) clubs.set(c.id, { id: c.id, league: l.id, style: c.style, names: [...new Set([c.name, c.shortName, ...(table[c.id]?.aliases ?? [])])], seasons: new Map() })
    for (const r of players.rows) {
      const club = clubs.get(r[col.club])
      if (!club) continue
      const s = r[col.season]
      if (!club.seasons.has(s)) club.seasons.set(s, [])
      club.seasons.get(s).push({ ovr: r[col.ovr], age: r[col.age] })
    }
  }
  return [...clubs.values()]
}

/** Names Wikidata may label a club with: ours, and each with the usual suffixes. */
function labelVariants(names) {
  const out = new Set()
  for (const n of names) {
    out.add(n)
    for (const suffix of [' F.C.', ' FC', ' A.F.C.', ' CF', ' C.F.']) out.add(n + suffix)
  }
  return [...out]
}

async function resolveClubs(clubs) {
  const qid = {}
  for (const c of clubs) if (CLUB_QID[c.id]) qid[c.id] = CLUB_QID[c.id]
  const todo = clubs.filter((c) => !qid[c.id])
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8)
    const values = batch.flatMap((c) => labelVariants(c.names).map((n) => `("${esc(n)}"@en "${c.id}")`)).join(' ')
    const q = `SELECT DISTINCT ?item ?club ?country ?sitelinks WHERE {
  VALUES (?label ?club) { ${values} }
  { ?item rdfs:label ?label } UNION { ?item skos:altLabel ?label }
  ?item wdt:P31 wd:Q476028 .
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks }
}`
    const json = await sparql(q)
    for (const c of batch) {
      const want = COUNTRY[c.league] ?? []
      const rows = json.results.bindings.filter((b) => b.club.value === c.id)
      const scored = new Map()
      for (const b of rows) {
        const id = b.item.value.split('/').pop()
        const country = b.country?.value.split('/').pop()
        const prev = scored.get(id) ?? { id, country: false, links: 0 }
        if (country && want.includes(country)) prev.country = true
        prev.links = Math.max(prev.links, Number(b.sitelinks?.value ?? 0))
        scored.set(id, prev)
      }
      // The club of the right country with the most Wikipedia articles: the senior men's side, not a namesake
      const best = [...scored.values()].filter((x) => x.country).sort((a, b) => b.links - a.links)[0]
      if (best) qid[c.id] = best.id
    }
    console.log(`  clubs ${Math.min(i + 8, todo.length)}/${todo.length}`)
  }
  return qid
}

function day(iso) {
  return iso ? Date.parse(iso.slice(0, 10)) : NaN
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(path.dirname(OUT), { recursive: true })
  const clubs = await packClubs()
  console.log(`${clubs.length} clubs in the packs`)
  const qid = await resolveClubs(clubs)
  const missing = clubs.filter((c) => !qid[c.id]).map((c) => c.id)
  console.log(`${Object.keys(qid).length} clubs resolved; unresolved: ${missing.join(', ') || 'none'}`)

  // Head coach statements of every resolved club, with their dates and any role qualifier (caretakers)
  const spells = new Map()
  const names = {}
  const ids = Object.entries(qid)
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25)
    const q = `SELECT ?club ?mgr ?mgrLabel ?start ?end ?role WHERE {
  VALUES ?club { ${batch.map(([, q]) => `wd:${q}`).join(' ')} }
  ?club p:P286 ?st . ?st ps:P286 ?mgr .
  OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } OPTIONAL { ?st pq:P2868 ?role }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`
    const json = await sparql(q)
    for (const b of json.results.bindings) {
      const clubQ = b.club.value.split('/').pop()
      const m = b.mgr.value.split('/').pop()
      if (!/^Q\d+$/.test(m) || !b.mgrLabel || /^Q\d+$/.test(b.mgrLabel.value)) continue
      names[m] = b.mgrLabel.value
      if (!spells.has(clubQ)) spells.set(clubQ, [])
      spells.get(clubQ).push({ m, start: day(b.start?.value), end: day(b.end?.value), caretaker: !!b.role })
    }
    console.log(`  managers ${Math.min(i + 25, ids.length)}/${ids.length}`)
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const today = Date.parse(stamp)
  const seasons = {}
  const votes = {}
  let covered = 0
  let total = 0
  for (const c of clubs) {
    const list = spells.get(qid[c.id]) ?? []
    for (const [season, squad] of [...c.seasons.entries()].sort((a, b) => a[0] - b[0])) {
      total++
      const from = Date.UTC(season, 6, 1)
      const to = Math.min(Date.UTC(season + 1, 5, 30), today)
      const days = new Map()
      for (const sp of list) {
        if (Number.isNaN(sp.start)) continue
        const end = Number.isNaN(sp.end) ? today : sp.end
        const overlap = Math.min(end, to) - Math.max(sp.start, from)
        if (overlap <= 0) continue
        const d = overlap / 86400000 * (sp.caretaker ? 0.5 : 1)
        days.set(sp.m, (days.get(sp.m) ?? 0) + d)
      }
      const ranked = [...days.entries()].sort((a, b) => b[1] - a[1])
      if (!ranked.length || ranked[0][1] < 30) continue
      const keep = ranked.filter(([, d], i) => i === 0 || (i === 1 && d >= 90)).map(([m]) => m)
      ;(seasons[c.id] ??= {})[season] = keep
      covered++
      const best16 = squad.sort((a, b) => b.ovr - a.ovr).slice(0, 16)
      const age = best16.reduce((s, p) => s + p.age, 0) / Math.max(1, best16.length)
      for (const m of keep) {
        const v = (votes[m] ??= {})
        const style = age < YOUNG_SQUAD ? 'youth' : FROM_CLUB[c.style] ?? 'balanced'
        v[style] = (v[style] ?? 0) + 1
      }
    }
  }
  const managers = {}
  for (const m of Object.keys(votes).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const name = names[m]
    const style = KNOWN_STYLES[name] ?? Object.entries(votes[m]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    managers[m] = [name, style]
  }
  const out = { source: 'Wikidata P286 (head coach), CC0', generatedAt: stamp, managers, seasons }
  await writeFile(OUT, JSON.stringify(out) + '\n')
  console.log(`${covered}/${total} club-seasons with a manager, ${Object.keys(managers).length} managers; wrote ${path.relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
