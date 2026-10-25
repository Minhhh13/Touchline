/**
 * Cache -> committed facts: `scripts/import/historic/facts-<league>.json`.
 *
 *   node scripts/import/historic/facts.mjs [england]
 *
 * Reads only the fetch cache ($DATA_CACHE/historic) and the league's tables in
 * public/data/<league>/meta.json; makes no network request. For every
 * club-season of the classic seasons it decides who was in the squad and how
 * much each man played:
 *
 *  - a club whose article has an appearances table that passes both checks
 *    (league apps 10.8x to (11 + substitutes)x games, goals GF-6..GF) gets the
 *    real league starts, substitute appearances and goals (`appsSource: 'table'`);
 *  - any other club gets its squad list, gated by a Wikidata club spell that
 *    overlaps the season, with real league goals from the article's results
 *    lines when they add up, and appearances estimated from the spell's league
 *    appearances per season, scaled so the club total looks like a season
 *    (`appsSource: 'estimated'`).
 *
 * Every shipped row has a Wikidata id and a birth date. Output is sorted by
 * (season, club, qid) with numbers rounded at fixed points, so a rerun on the
 * same cache gives a byte-identical file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config.mjs'
import { clubIdFor } from '../clubs-england.mjs'
import { NATION_NAMES } from '../nations.mjs'
import { HISTORIC_DIR, classicSeasons, clubSeasonTitle, altClubSeasonTitle, ENWIKI_CLUB } from './config.mjs'
import { wpPage, wdEntity } from './cache.mjs'
import { parseSeasonArticle, seasonFraction } from './parse-season.mjs'
import { personFromEntity, infoboxFacts, coarseFromP413, specificFromP413, textPositions, nationFor } from './people.mjs'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const r1 = (v) => Math.round(v * 10) / 10
const r3 = (v) => Math.round(v * 1000) / 1000
const normName = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const KNOWN = new Set(Object.keys(NATION_NAMES))

/** The cached page a title leads to (after its redirect), or null. */
function page(title) {
  const p = wpPage(title)
  return p && !p.missing ? p : null
}
const personCache = new Map()
function person(qid) {
  if (!qid) return null
  if (!personCache.has(qid)) personCache.set(qid, personFromEntity(wdEntity(qid), wdEntity))
  return personCache.get(qid)
}
const infoboxCache = new Map()
function infobox(title) {
  const p = page(title)
  if (!p) return null
  if (!infoboxCache.has(p.resolved)) infoboxCache.set(p.resolved, infoboxFacts(p.text))
  return infoboxCache.get(p.resolved)
}
/** One key per person: the resolved article title. */
const titleKey = (t) => normName(String(page(t)?.resolved ?? t).replace(/,/g, ''))

const overlaps = (sp, S) => (sp.s == null || sp.s <= S + 1) && (sp.e == null || sp.e >= S)
function spellRate(sp) {
  // league apps per season over a closed spell (year precision); null when unknown
  if (sp.apps == null || sp.s == null || sp.e == null) return null
  const n = Math.max(1, sp.e - sp.s)
  return { apps: sp.apps / n, goals: (sp.goals ?? 0) / n, n }
}
// Share of the season spent at a club he left, from the year his spell there ends
function priorFrac(m, S) {
  const ends = (m.overlapping ?? []).map((o) => o.e).filter((e) => e != null)
  const e = ends.length ? Math.max(...ends) : null
  return e === S ? 0.15 : e === S + 1 ? 0.65 : 0.4
}
function ageAt(dob, season) {
  if (!dob) return NaN
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return NaN
  const ref = new Date(Date.UTC(season, 7, 1))
  let age = ref.getUTCFullYear() - d.getUTCFullYear()
  const mm = ref.getUTCMonth() - d.getUTCMonth()
  if (mm < 0 || (mm === 0 && ref.getUTCDate() < d.getUTCDate())) age--
  return age
}

/** The club-season article: the first of the two titles that exists. */
export function articleFor(season, clubId) {
  return page(clubSeasonTitle(season, clubId)) ?? page(altClubSeasonTitle(season, clubId))
}

export function buildFacts(league = 'england') {
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, league, 'meta.json'), 'utf8'))
  const report = []
  const out = { version: 1, league, seasons: [] }
  for (const S of classicSeasons(league)) {
    const table = meta.historicTables?.[S] ?? meta.seasons.find((x) => x.season === S)?.table
    const T = Object.fromEntries(table.map((r) => [r.clubId, r]))
    const clubData = {}
    const factsBy = {}
    // ------------------------------------------------ phase A: members, article facts, first estimates
    for (const row of table) {
      const cid = row.clubId
      const art = articleFor(S, cid)
      if (!art) { report.push(`${S} ${cid}: no club-season article`); continue }
      const isOurs = (t) => { const mm = String(t).match(/\[\[([^\]|]+)/); const L = (mm ? mm[1] : String(t)).replace(/'{2,3}/g, '').trim(); return clubIdFor(L) === cid || clubIdFor(L.replace(/\s*A?\.?F\.?C\.?$/, '').trim()) === cid }
      const parsed = parseSeasonArticle(art.text, { season: S, row, isOurs })
      parsed.firstK = new Map([...parsed.first].map(([t, v]) => [titleKey(t), v]))
      parsed.lastK = new Map([...parsed.last].map(([t, v]) => [titleKey(t), v]))
      factsBy[cid] = parsed
      clubData[cid] = { cid, row, art, clubQid: null, parsed }
    }
    // the club's Wikidata item: the one most of its players' P54 spells point at that matches the club's article
    for (const d of Object.values(clubData)) {
      const counts = new Map()
      for (const p of d.parsed.players) for (const sp of person(page(p.title)?.qid)?.clubs ?? []) counts.set(sp.team, (counts.get(sp.team) ?? 0) + 1)
      const named = [...counts.entries()].filter(([q]) => { const e = wdEntity(q); return e && (e.enwiki === ENWIKI_CLUB[d.cid] || clubIdFor(String(e.label ?? '')) === d.cid || clubIdFor(String(e.enwiki ?? '').replace(/\s*A?\.?F\.?C\.?$/, '')) === d.cid) })
      d.clubQid = (named.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null])[0]
    }
    for (const d of Object.values(clubData)) {
      const { cid, row, parsed: club } = d
      const games = row.played
      const facts = club
      const goalsOK = !!facts.results?.ok
      const scorerGoals = new Map()
      const rawTitle = new Map()
      if (goalsOK) for (const [t, g] of facts.goals) { scorerGoals.set(titleKey(t), (scorerGoals.get(titleKey(t)) ?? 0) + g); rawTitle.set(titleKey(t), t) }
      // scorer links that do not match a squad-list title exactly: a unique surname match in the list
      if (goalsOK) {
        const listKeys = club.players.map((p) => titleKey(p.title))
        const sur = (k) => k.replace(/\s*\(.*$/, '').split(' ').at(-1)
        for (const [k, g] of [...scorerGoals]) {
          if (listKeys.includes(k)) continue
          const cands = listKeys.filter((x) => sur(x) === sur(k))
          if (cands.length === 1) { scorerGoals.delete(k); scorerGoals.set(cands[0], (scorerGoals.get(cands[0]) ?? 0) + g) }
        }
      }
      const spellsAt = (pp) => (pp && d.clubQid ? pp.clubs.filter((c) => c.team === d.clubQid) : [])
      const members = []
      for (const p of club.players) {
        const qid = page(p.title)?.qid ?? null
        const pp = person(qid)
        const sp = spellsAt(pp)
        const note = p.note ?? ''
        const dest = (note.match(/^to (.+)$/i) ?? [])[1] ?? null
        members.push({ ...p, qid, person: pp, spells: sp, overlapping: sp.filter((x) => overlaps(x, S)), departed: !!dest, destClub: dest ? clubIdFor(dest) ?? null : null, destName: dest, trial: /on trial/i.test(note), loanOut: /^on loan to/i.test(note), scoredGoals: scorerGoals.get(titleKey(p.title)) ?? null })
      }
      // league scorers the squad list does not name (players who left early, loans): added when Wikidata knows them
      if (!club.stats) {
        const inList = new Set(members.map((m) => titleKey(m.title)))
        for (const [t, g] of scorerGoals) {
          if (inList.has(t)) continue
          const title = rawTitle.get(t) ?? t
          const qid = page(title)?.qid ?? null
          const pp = person(qid)
          if (!pp) continue
          const sp = spellsAt(pp)
          members.push({ title, name: pp.label, pos: null, nat: null, inList: true, inStats: false, apps: null, starts: null, subs: null, goals: null, note: 'scorer only', qid, person: pp, spells: sp, overlapping: sp.filter((x) => overlaps(x, S)), departed: false, destClub: null, trial: false, loanOut: false, scoredGoals: g, scorerOnly: true })
        }
      }
      const clubName = d.art.resolved.replace(/^\S+\s+/, '').replace(/ season$/, '')
      for (const m of members) {
        const ib = infobox(m.title)
        m.infobox = ib
        const sameClub = (x) => x.club === clubName || x.club === ENWIKI_CLUB[cid] || clubIdFor(String(x.club).replace(/\s*A?\.?F\.?C\.?$/, '')) === cid
        const ibSp = (ib?.spells ?? []).filter((x) => sameClub(x) && !x.loan && overlaps(x, S))
        if (ib && !m.spells.length && (ib.spells ?? []).some(sameClub)) m.spells = ib.spells.filter(sameClub)
        if (ibSp.length && !m.overlapping.length) m.overlapping = ibSp
        const rates = [...m.overlapping, ...ibSp].map(spellRate).filter(Boolean)
        m.spellRate = rates.length ? rates.reduce((a, b) => (a.n <= b.n ? a : b)) : null // shortest spell = most specific
        m.everPlayed = m.spells.some((x) => (x.apps ?? 1) > 0)
      }
      let squad
      if (club.stats) {
        squad = members.filter((m) => m.inStats && m.apps > 0)
        for (const m of squad) {
          m.appsSrc = 'table'
          m.estApps = m.apps
          // an appearances-only table: goals from the league scorer lines when they add up, else estimated below
          if (club.stats.appsOnly) { m.estGoals = m.scoredGoals ?? (goalsOK ? 0 : null); m.goalsFixed = m.estGoals != null } else { m.estGoals = m.goals; m.goalsFixed = true }
        }
      } else {
        squad = []
        for (const m of members) {
          if (!m.inList) continue
          if (m.trial && m.scoredGoals == null) continue
          if (m.scoredGoals == null && m.person && !m.overlapping.length) continue
          if (m.scoredGoals == null && m.person && !m.everPlayed) continue
          squad.push(m)
        }
        for (const m of squad) {
          if (m.spellRate) { m.estApps = Math.min(games, m.spellRate.apps * games / 40); m.appsSrc = 'spell' } else { m.estApps = 4; m.appsSrc = 'prior' }
          if (m.scoredGoals != null) { m.estGoals = m.scoredGoals; m.goalsFixed = true } else if (goalsOK) { m.estGoals = 0; m.goalsFixed = true } else { m.estGoals = null; m.goalsFixed = false }
          // part-season players: departure date from a dated transfer row, else a prior; scoring dates bound it
          m.frac = 1
          if (m.departed) {
            const dd = transferDate(m, cid, factsBy, clubData)
            let f = dd != null ? seasonFraction(dd, S) : priorFrac(m, S)
            if (dd == null && m.destClub && factsBy[m.destClub]?.firstK.get(titleKey(m.title)) != null) f = Math.min(f, seasonFraction(factsBy[m.destClub].firstK.get(titleKey(m.title)), S))
            const lastGoal = facts.lastK.get(titleKey(m.title))
            if (lastGoal != null && seasonFraction(lastGoal, S) > f) f = seasonFraction(lastGoal, S)
            m.frac = f
          } else if (m.loanOut) m.frac = 0.5
          if (m.frac < 1) m.estApps *= m.frac
          if (m.scoredGoals != null) m.estApps = Math.max(m.estApps, Math.min(games, m.scoredGoals + 1))
        }
        squad = squad.filter((m) => !(m.departed && m.frac < 0.03 && m.scoredGoals == null))
      }
      d.squad = squad
      d.members = members
      d.games = games
    }
    // ------------------------------------------------ phase B: players at two clubs in one season
    {
      const byQ = new Map()
      for (const d of Object.values(clubData)) for (const m of d.squad ?? []) if (m.qid) (byQ.get(m.qid) ?? byQ.set(m.qid, []).get(m.qid)).push({ d, m })
      for (const [, list] of [...byQ].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (list.length < 2) continue
        for (const x of list) {
          if (x.d.parsed.stats) continue
          const others = list.filter((y) => y !== x)
          let from = others.find((y) => y.m.departed && y.m.destClub === x.d.cid)
          // no note on either side: the club whose spell ends in the season's years is the one he left
          if (!from && !x.m.departed && others.length === 1 && !others[0].d.parsed.stats && !others[0].m.departed) {
            const y = others[0]
            const endsX = Math.max(...x.m.overlapping.map((o) => o.e ?? 9999)), endsY = Math.max(...y.m.overlapping.map((o) => o.e ?? 9999))
            const startsX = Math.min(...x.m.overlapping.map((o) => o.s ?? 0)), startsY = Math.min(...y.m.overlapping.map((o) => o.s ?? 0))
            if (endsY <= S + 1 && startsX >= S && !(endsX <= S + 1 && startsY >= S)) { y.m.departed = true; y.m.destClub = x.d.cid; y.m.frac = priorFrac(y.m, S); y.m.estApps *= y.m.frac; from = y }
          }
          if (from && !x.m.departed) {
            const dd = transferDate(from.m, from.d.cid, factsBy, clubData)
            let f = dd != null ? seasonFraction(dd, S) : from.m.frac ?? priorFrac(from.m, S)
            const firstGoal = factsBy[x.d.cid].firstK.get(titleKey(x.m.title))
            if (firstGoal != null) f = Math.min(f, seasonFraction(firstGoal, S))
            x.m.frac = 1 - f
            x.m.estApps *= x.m.frac
          }
          if (x.m.scoredGoals != null) x.m.estApps = Math.max(x.m.estApps, Math.min(x.d.games, x.m.scoredGoals + 1))
          if (x.m.estApps < 0.5 && x.m.scoredGoals == null) x.m.dropTwoClub = true
        }
      }
    }
    // ------------------------------------------------ phase C: identity gate, scaling, starts, ranks, the thin-club rule
    const seasonOut = { season: S, clubs: [] }
    for (const row of table) {
      const d = clubData[row.clubId]
      if (!d) continue
      const { cid, games, parsed: club } = d
      // every shipped row needs a Wikidata item and a birth date that fits a footballer (else the link found a namesake)
      const seenQ = new Set()
      let squad = (d.squad ?? []).filter((m) => {
        if (m.dropTwoClub || !m.person?.dob) return false
        const age = ageAt(m.person.dob, S)
        if (!(age >= 15 && age <= 42)) { report.push(`${S} ${cid}: ${m.name} dropped (age ${age} from ${m.qid})`); return false }
        if (seenQ.has(m.qid)) return false // two links to one person
        seenQ.add(m.qid)
        return true
      })
      const dropped = (d.squad ?? []).length - squad.length
      if (!club.stats || club.stats.appsOnly) {
        for (const m of squad) if (m.estGoals == null) m.estGoals = m.spellRate && m.spellRate.apps > 0 ? (m.spellRate.goals / m.spellRate.apps) * m.estApps : 0
        // scale the estimated apps so the club total looks like a real season, then the free goals to GF
        const target = 12.0 * games
        for (let it = 0; it < 3 && !club.stats; it++) {
          const fsum = squad.reduce((s, m) => s + m.estApps, 0)
          if (fsum <= 0) break
          const k = clamp(target / fsum, 0.5, 2)
          for (const m of squad) m.estApps = Math.min(games, m.estApps * k, m.frac != null && m.frac < 1 ? games * m.frac + 1 : games)
        }
        const gFixed = squad.filter((m) => m.goalsFixed).reduce((s, m) => s + m.estGoals, 0)
        const gFree = squad.filter((m) => !m.goalsFixed)
        const gSum = gFree.reduce((s, m) => s + m.estGoals, 0)
        const gTarget = Math.max(0, row.gf - 1.5 - gFixed)
        if (gSum > 0) for (const m of gFree) m.estGoals = (m.estGoals * gTarget) / gSum
      }
      const coarse = (m) => (['GK', 'DF', 'MF', 'FW'].includes(m.pos) ? m.pos : coarseFromP413(m.person.pos) ?? 'MF')
      // two keepers: a club whose first choice played every game gets its listed reserve keeper (no appearances)
      const inSquad = new Set(squad.map((m) => m.qid))
      for (const m of (d.members ?? []).filter((x) => x.person?.dob && !inSquad.has(x.qid) && x.inList && !x.departed && coarse(x) === 'GK').sort((a, b) => (b.overlapping.length ? 1 : 0) - (a.overlapping.length ? 1 : 0) || a.qid.localeCompare(b.qid))) {
        if (squad.filter((x) => coarse(x) === 'GK').length >= 2) break
        m.estApps = 0
        m.estGoals = 0
        m.starts = 0
        m.appsSrc = club.stats ? 'table' : 'estimated'
        squad.push(m)
        inSquad.add(m.qid)
      }
      // the thin-club rule: at most 30, lowest share out first, never the club's second keeper
      squad.sort((a, b) => b.estApps - a.estApps || a.qid.localeCompare(b.qid))
      while (squad.length > 30) {
        const gks = squad.filter((m) => coarse(m) === 'GK').length
        let i = squad.length - 1
        while (i > 0 && coarse(squad[i]) === 'GK' && gks <= 2) i--
        squad.splice(i, 1)
      }
      // starts: real where split, else apps scaled so the club total is 11 x games
      const kStarts = (11 * games - squad.filter((m) => m.starts != null).reduce((s, m) => s + m.starts, 0)) / Math.max(1, squad.filter((m) => m.starts == null).reduce((s, m) => s + m.estApps, 0))
      for (const m of squad) m.st = m.starts != null ? clamp(m.starts, 0, games) : clamp(m.estApps * clamp(kStarts, 0.6, 1.0), 0, games)
      const ranked = [...squad].sort((a, b) => b.st - a.st || a.qid.localeCompare(b.qid))
      ranked.forEach((m, i) => (m.startRank = i + 1))
      const players = squad.map((m) => {
        const pp = m.person
        const co = coarse(m)
        const ib = m.infobox
        const txt = textPositions(ib, co)
        const spec = txt[0] ?? specificFromP413(pp.pos, co)
        const nat = nationFor(m.nat, pp, (c) => KNOWN.has(c))
        const ibH = ib?.height && ib.height > 150 && ib.height < 210 ? ib.height : null
        const intl = pp.nt.some((t) => (t.s == null || t.s <= S + 1) && (t.e == null || t.e >= S))
        const name = m.name && m.name.split(/\s+/).length >= 2 ? m.name : pp.label ?? page(m.title)?.resolved.replace(/\s*\(.*\)$/, '')
        return {
          qid: pp.qid,
          enwiki: page(m.title)?.resolved ?? m.title,
          name,
          nat: nat.code,
          natSrc: nat.src,
          coarse: co,
          pos: txt,
          posSpec: spec ?? null,
          posSrc: txt[0] ? 'infobox' : spec ? 'wikidata' : 'heuristic',
          dob: pp.dob,
          age: ageAt(pp.dob, S),
          height: pp.height ?? ibH ?? 0,
          apps: r1(m.estApps),
          starts: r1(m.st),
          subs: m.subs ?? null,
          goals: r1(m.estGoals ?? 0),
          share: r3(m.st / games),
          startRank: m.startRank,
          appsSource: m.appsSrc === 'table' ? 'table' : 'estimated',
          links: pp.links,
          caps: pp.caps,
          intl: intl ? 1 : 0,
          fifaId: pp.fifaId,
        }
      }).sort((a, b) => a.qid.localeCompare(b.qid))
      const gks = players.filter((p) => p.coarse === 'GK').length
      const regulars = players.filter((p) => p.share > 0.25).length
      const goalsSum = players.reduce((s, p) => s + p.goals, 0)
      if (players.length < 20 || regulars < 11) report.push(`${S} ${cid}: thin (${players.length} players, ${gks} keepers, ${regulars} with share > 0.25)`)
      if (Math.abs(goalsSum - row.gf) > 5) report.push(`${S} ${cid}: player goals ${goalsSum.toFixed(1)} vs GF ${row.gf}`)
      seasonOut.clubs.push({ clubId: cid, article: d.art.resolved, articleQid: d.art.qid ?? null, clubQid: d.clubQid, games, gf: row.gf, appsSource: club.stats ? 'table' : 'estimated', resultsGoals: !!club.results?.ok, droppedNoIdentity: dropped, players })
    }
    seasonOut.clubs.sort((a, b) => a.clubId.localeCompare(b.clubId))
    out.seasons.push(seasonOut)
  }
  // A club-season still one keeper short borrows the club's keeper from the season before or after (never across 2008)
  for (const so of out.seasons) for (const c of so.clubs) {
    for (const adj of [so.season - 1, so.season + 1]) {
      if (c.players.filter((p) => p.coarse === 'GK').length >= 2) break
      const other = out.seasons.find((x) => x.season === adj)?.clubs.find((x) => x.clubId === c.clubId)
      const have = new Set(c.players.map((p) => p.qid))
      const gk = (other?.players ?? []).filter((p) => p.coarse === 'GK' && !have.has(p.qid) && !p.borrowedFrom).sort((a, b) => b.share - a.share || a.qid.localeCompare(b.qid))[0]
      if (!gk) continue
      c.players.push({ ...gk, age: ageAt(gk.dob, so.season), apps: 0, starts: 0, subs: null, goals: 0, share: 0, startRank: c.players.length + 1, borrowedFrom: adj })
      c.players.sort((a, b) => a.qid.localeCompare(b.qid))
      report.push(`${so.season} ${c.clubId}: second keeper ${gk.name} borrowed from ${adj}`)
    }
    const gks = c.players.filter((p) => p.coarse === 'GK').length
    if (gks < 2) report.push(`${so.season} ${c.clubId}: only ${gks} keeper(s)`)
  }
  return { facts: out, report }
}

// A dated transfer row naming the player and the other club: in the source club's article or the destination's
function transferDate(m, cid, factsBy, clubData) {
  const tk = page(m.title)?.resolved ?? m.title
  const destId = m.destClub ?? (m.destName ? clubIdFor(m.destName) : null)
  const word = (name) => (name ? normName(name).split(' ').filter((w) => w.length > 3 && !['city', 'united', 'town', 'rovers', 'athletic', 'county'].includes(w))[0] ?? normName(name).split(' ')[0] : null)
  const pick = (facts, otherName) => {
    if (!facts || !otherName) return null
    const w = word(otherName)
    const hits = facts.transfers.filter((t) => t.titles.some((x) => x === m.title || x === tk) && t.titles.some((x) => normName(x).includes(w)))
    return hits.length ? hits[0].date : null
  }
  const ourName = clubData[cid]?.art?.resolved?.replace(/^\S+\s+/, '').replace(/ season$/, '')
  return pick(factsBy[cid], m.destName) ?? (destId && factsBy[destId] ? pick(factsBy[destId], ourName) : null)
}

export const FACTS_FILE = (league) => path.join(HISTORIC_DIR, `facts-${league}.json`)

/** Stable JSON: one club-season per line, so a diff of the committed file reads club by club. */
export function stringifyFacts(facts) {
  const lines = ['{', `"version":${facts.version},"league":${JSON.stringify(facts.league)},"seasons":[`]
  facts.seasons.forEach((s, i) => {
    lines.push(`{"season":${s.season},"clubs":[`)
    s.clubs.forEach((c, j) => lines.push(JSON.stringify(c) + (j < s.clubs.length - 1 ? ',' : '')))
    lines.push(']}' + (i < facts.seasons.length - 1 ? ',' : ''))
  })
  lines.push(']}')
  return lines.join('\n') + '\n'
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const league = process.argv[2] ?? 'england'
  const { facts, report } = buildFacts(league)
  fs.writeFileSync(FACTS_FILE(league), stringifyFacts(facts))
  let rows = 0
  for (const s of facts.seasons) {
    const n = s.clubs.reduce((a, c) => a + c.players.length, 0)
    rows += n
    const sizes = s.clubs.map((c) => c.players.length)
    console.log(`${s.season}-${String((s.season + 1) % 100).padStart(2, '0')}: ${s.clubs.length} clubs, ${n} players (squads ${Math.min(...sizes)}-${Math.max(...sizes)}), apps tables ${s.clubs.filter((c) => c.appsSource === 'table').length}, results goals ${s.clubs.filter((c) => c.resultsGoals).length}`)
  }
  console.log(`${rows} player-seasons -> ${path.relative(process.cwd(), FACTS_FILE(league))}`)
  if (report.length) console.log(`Report (${report.length}):\n  ` + report.join('\n  '))
}
