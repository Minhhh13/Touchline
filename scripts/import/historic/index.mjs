/**
 * The classic-seasons loader that build.mjs calls: committed facts in, pack
 * records out. No network, no clock, no Math.random: two runs on the same
 * facts, tables and dataset cache give identical records.
 *
 *   loadHistoric(leagueId, { tables, db, sofifaIndex, ranges, helpers })
 *
 *   tables       the league's tables by season (after the overrides), as build.mjs makes them
 *   db           the European Soccer Database (node:sqlite), for ids, feet, heights and later EA ratings
 *   sofifaIndex  the build's sofifa id index (a Wikidata FIFA id found there keeps that id)
 *   ranges       { [pos]: { [attr]: [lo, hi] } } of the 2008-13 England rows (attribute clamps)
 *   laterPositions  Map of player id -> { season, positions } of the player's first standard
 *                (2008+) season in the packs, optional: a guessed position gives way to it
 *   helpers      build.mjs's own functions, so values follow the shipped packs exactly:
 *                { deriveAttributes, traitsFor, modelValue, modelWage, unit, shortName }
 *
 * Returns { records, seasons, report }: records in build.mjs's finalized
 * shape, and per season { season, appsSource, clubs } for meta.json.
 */
import fs from 'node:fs'
import { classicSeasons } from './config.mjs'
import { FACTS_FILE } from './facts.mjs'
import { GROUP, MAX_GAP, features, predict, adjustClub, stretchGroup } from './ratings.mjs'
import { attributesFor } from './attributes.mjs'

const r1 = (v) => Math.round(v * 10) / 10
const tokens = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3)

/** Left-foot share of each primary position in the 2014+ EA rows (the 2008-13 ones had left and right swapped). */
/** A guessed position yields to the player's first standard season when that is at most this many seasons on. */
export const LATER_POSITION_GAP = 2

const LEFT_SHARE = { LB: 0.866, RB: 0.004, LW: 0.275, RW: 0.343, CB: 0.238, CM: 0.177, AM: 0.268, DM: 0.118, ST: 0.155, GK: 0.121 }

/** ESD links and later EA ratings: birth date plus a shared name token, never a guess between two candidates. */
function esdIndex(db, helpers) {
  const byDob = new Map()
  for (const p of db.prepare('select player_api_id id, player_name name, player_fifa_api_id fifa, substr(birthday, 1, 10) dob, height from Player order by player_api_id').all()) {
    if (!byDob.has(p.dob)) byDob.set(p.dob, [])
    byDob.get(p.dob).push(p)
  }
  const attrStmt = db.prepare('select * from Player_Attributes where player_api_id = ? and overall_rating is not null order by date, id')
  const cache = new Map()
  const snapshots = (pid) => {
    if (!cache.has(pid)) cache.set(pid, attrStmt.all(pid))
    return cache.get(pid)
  }
  // The rating build.mjs gives season T: the snapshot nearest 15 Sep of T+1, inside Feb T+1 .. Jan T+2
  function seasonSnapshot(pid, T) {
    const target = Date.UTC(T + 1, 8, 15), start = Date.UTC(T + 1, 1, 1), end = Date.UTC(T + 2, 0, 31)
    let best = null, bs = Infinity
    for (const r of snapshots(pid)) {
      const t = new Date(r.date).getTime()
      if (t < start || t > end) continue
      const s = Math.abs(t - target)
      if (s < bs) { bs = s; best = r }
    }
    return best
  }
  return {
    link(fact) {
      const cands = byDob.get(fact.dob) ?? []
      const toks = new Set([...tokens(fact.name), ...tokens(fact.enwiki)])
      const scored = cands.map((c) => ({ c, s: tokens(c.name).filter((t) => toks.has(t)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
      if (!scored.length || (scored.length > 1 && scored[0].s === scored[1].s)) return { esd: null, ambiguous: scored.length > 1 }
      return { esd: scored[0].c, ambiguous: false }
    },
    /** The first ESD season rating at or after season S, within MAX_GAP seasons. */
    later(esd, S) {
      for (let T = Math.max(S, 2006); T <= Math.min(2015, S + MAX_GAP); T++) {
        const snap = seasonSnapshot(esd.id, T)
        if (snap) return { gap: T - S, ovr: Math.round(Number(snap.overall_rating)), snap }
      }
      return null
    },
    first(esd) {
      return snapshots(esd.id)[0] ?? null
    },
    helpers,
  }
}

/** The 13 attribute keys of an ESD snapshot, through build.mjs's own attribute mapping. */
function profileOf(snap, isGk, helpers) {
  const d = {
    acc: snap.acceleration, spr: snap.sprint_speed, fin: snap.finishing, shp: snap.shot_power, lsh: snap.long_shots, vol: snap.volleys, pen: snap.penalties, posn: snap.positioning,
    spa: snap.short_passing, lpa: snap.long_passing, vis: snap.vision, cro: snap.crossing, cur: snap.curve, fk: snap.free_kick_accuracy, bc: snap.ball_control, dri: snap.dribbling,
    agi: snap.agility, bal: snap.balance, rea: snap.reactions, com: snap.composure, mar: snap.marking, sta: snap.standing_tackle, sli: snap.sliding_tackle, int: snap.interceptions,
    hea: snap.heading_accuracy, str: snap.strength, stm: snap.stamina, agg: snap.aggression, jmp: snap.jumping, gkd: snap.gk_diving, gkh: snap.gk_handling, gkk: snap.gk_kicking, gkp: snap.gk_positioning, gkr: snap.gk_reflexes,
  }
  for (const k in d) d[k] = d[k] == null ? NaN : Number(d[k])
  const a = helpers.deriveAttributes(d, null, isGk)
  const wr = { high: 80, medium: 55, low: 35 }
  const w = [wr[String(snap.attacking_work_rate).toLowerCase()], wr[String(snap.defensive_work_rate).toLowerCase()]]
  return { pac: a.pace, sho: a.shooting, pas: a.passing, dri: a.dribbling, def: a.defending, phy: a.physical, men: a.mentality, gk: a.goalkeeping, sta: d.stm, str: d.str, agg: d.agg, jmp: d.jmp, wr: w.every(Number.isFinite) ? (w[0] + w[1]) / 2 : NaN }
}

/**
 * Specific positions for one club-season: the facts' text positions first;
 * then full-backs and wingers are made up from the generic defenders and
 * midfielders (shortest first) until a squad has its share of them, and sides
 * follow the foot (an ESD foot where known).
 */
function assignPositions(list, templates) {
  for (const r of list) r.spec = r.f.posSpec && r.f.posSpec !== 'W' && r.f.posSpec !== 'FB' ? r.f.posSpec : r.f.posSpec ?? null
  const byHeight = (fallback) => (a, b) => (a.height || fallback) - (b.height || fallback) || a.id.localeCompare(b.id)
  const dfs = list.filter((r) => r.f.coarse === 'DF')
  const needFB = Math.max(2, Math.round(dfs.length * 0.4))
  const fb = dfs.filter((r) => ['LB', 'RB', 'FB'].includes(r.spec))
  const generic = dfs.filter((r) => !r.spec).sort(byHeight(183))
  while (fb.length < needFB && generic.length) { const g = generic.shift(); g.spec = 'FB'; fb.push(g) }
  for (const r of dfs) if (!r.spec) r.spec = 'CB'
  const sideFill = (rows, L, R) => {
    let nl = rows.filter((r) => r.spec === L).length, nr = rows.filter((r) => r.spec === R).length
    for (const r of rows.filter((x) => x.spec === 'FB' || x.spec === 'W').sort((a, b) => b.f.starts - a.f.starts || a.id.localeCompare(b.id))) {
      const foot = r.esdFoot
      const side = foot === 'L' && nl <= nr + 1 ? L : foot === 'R' && nr <= nl + 1 ? R : nl < nr ? L : R
      r.spec = side
      side === L ? nl++ : nr++
    }
  }
  sideFill(dfs, 'LB', 'RB')
  const mfs = list.filter((r) => r.f.coarse === 'MF')
  const wide = list.filter((r) => ['LW', 'RW', 'W'].includes(r.spec))
  const genM = mfs.filter((r) => !r.spec).sort(byHeight(179))
  while (wide.length < 2 && genM.length) { const g = genM.shift(); g.spec = 'W'; wide.push(g) }
  for (const r of mfs) if (!r.spec) r.spec = 'CM'
  sideFill(list.filter((r) => r.f.coarse !== 'GK' && r.f.coarse !== 'DF'), 'LW', 'RW')
  for (const r of list) if (!r.spec) r.spec = r.f.coarse === 'GK' ? 'GK' : 'ST'
  for (const r of list) {
    const prim = r.spec
    const sec = Object.entries(templates.secondary[prim] ?? {}).filter(([, v]) => v >= 0.2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k)
    const pos = [prim]
    for (const t of r.f.pos ?? []) { const c = t === 'FB' ? (prim === 'LB' ? 'RB' : 'LB') : t === 'W' ? (prim === 'LW' ? 'RW' : 'LW') : t; if (pos.length < 3 && !pos.includes(c)) pos.push(c) }
    if (r.f.coarse === 'FW' && !pos.includes('ST') && pos.length < 3) pos.push('ST')
    for (const s2 of sec) if (pos.length < 3 && !pos.includes(s2)) pos.push(s2)
    r.positions = prim === 'GK' ? ['GK'] : pos.filter((p) => p !== 'GK')
  }
}

/** Display names: "D. Wallace", but the full first name when two men of one club-season would share it. */
function names(list, shortName) {
  for (const r of list) r.name = shortName(r.f.name)
  const by = new Map()
  for (const r of list) { if (!by.has(r.name)) by.set(r.name, []); by.get(r.name).push(r) }
  for (const group of by.values()) if (group.length > 1) for (const r of group) r.name = r.f.name
}

export function loadHistoric(leagueId, { tables, db, sofifaIndex, ranges, helpers, templates, laterPositions, facts: givenFacts }) {
  const seasons = classicSeasons(leagueId)
  if (!seasons.length) return { records: [], seasons: [], report: [] }
  const facts = givenFacts ?? JSON.parse(fs.readFileSync(FACTS_FILE(leagueId), 'utf8'))
  const esd = esdIndex(db, helpers)
  const gauss = (str, salt) => (helpers.unit(str, salt) + helpers.unit(str, salt + 101) + helpers.unit(str, salt + 202) + helpers.unit(str, salt + 303) - 2) * Math.sqrt(3)
  const records = []
  const seasonInfo = []
  const report = []
  const stats = { rows: 0, idS: 0, idE: 0, idW: 0, esdAmbiguous: 0, later: 0, footEsd: 0, laterPos: 0 }
  for (const fs_ of facts.seasons) {
    const S = fs_.season
    if (!seasons.includes(S)) continue
    const t = tables[S]
    if (!t) { report.push(`${S}: no table`); continue }
    const T = Object.fromEntries(t.table.map((r) => [r.clubId, r]))
    const rows = []
    for (const club of fs_.clubs) {
      const tr = T[club.clubId]
      if (!tr) { report.push(`${S} ${club.clubId}: not in the table`); continue }
      const team = { games: tr.played, gf: tr.gf, ga: tr.ga, pts: tr.pts, position: tr.position, clubs: t.table.length }
      const list = []
      for (const f of club.players) {
        const { esd: e, ambiguous } = esd.link(f)
        if (ambiguous) stats.esdAmbiguous++
        const id = e ? (e.fifa != null ? `s${e.fifa}` : `e${e.id}`) : f.fifaId && sofifaIndex.has(String(f.fifaId)) ? `s${f.fifaId}` : `w${f.qid}`
        const later = e ? esd.later(e, S) : null
        const first = e ? esd.first(e) : null
        const p = { share: f.share, startRank: f.startRank, goals: f.goals, age: f.age, links: f.links, caps: f.caps, intl: f.intl, matched: true }
        const group = GROUP[f.coarse]
        const pred = predict(group, features(p, team, later ? { ovr: later.ovr, gap: later.gap } : null))
        list.push({ f, id, e, later, group, p, raw: pred.y, team: pred.team, height: f.height || (e?.height ? Math.round(e.height) : 0), esdFoot: first ? (first.preferred_foot === 'left' ? 'L' : first.preferred_foot === 'right' ? 'R' : null) : null, workRate: first?.attacking_work_rate && first?.defensive_work_rate ? `${first.attacking_work_rate}/${first.defensive_work_rate}` : null, club: club.clubId })
      }
      // one row per id in a club-season (two Wikidata items linked to one ESD player: keep the regular)
      const seen = new Map()
      for (const r of list.sort((a, b) => b.f.share - a.f.share || a.f.qid.localeCompare(b.f.qid))) {
        if (seen.has(r.id)) { report.push(`${S} ${club.clubId}: ${r.f.name} and ${seen.get(r.id).f.name} share id ${r.id}; kept the regular`); continue }
        seen.set(r.id, r)
      }
      const kept = [...seen.values()]
      adjustClub(kept)
      assignPositions(kept, templates)
      // A position the facts only guessed (no infobox or Wikidata one: C. Ronaldo 2006-07 came out CM|DM)
      // gives way to the same man's positions in his first standard season, when that is close enough
      for (const r of kept) {
        if (r.f.posSrc !== 'heuristic' || r.f.coarse === 'GK') continue
        const l = laterPositions?.get(r.id)
        if (!l || l.season - S > LATER_POSITION_GAP || l.positions[0] === 'GK') continue
        // a man listed as a defender stays one (the later database line-ups put some in midfield)
        if (r.f.coarse === 'DF' && !['CB', 'LB', 'RB'].includes(l.positions[0])) continue
        r.positions = l.positions.filter((x) => x !== 'GK')
        stats.laterPos++
      }
      names(kept, helpers.shortName)
      rows.push(...kept)
    }
    // the spread: stretch around the season mean of each position group
    for (const g of ['GK', 'DEF', 'MID', 'FWD']) stretchGroup(rows.filter((r) => r.group === g))
    for (const r of rows) {
      const prim = r.positions[0]
      const later = r.later && r.later.gap <= MAX_GAP ? { ovr: r.later.ovr, attrs: profileOf(r.later.snap, prim === 'GK', helpers) } : null
      const a = attributesFor({ ovr: r.ovr, age: r.f.age, height: r.height, pos: prim, id: r.id, later, ranges, gauss })
      const attrs = { pace: a.pac, shooting: a.sho, passing: a.pas, dribbling: a.dri, defending: a.def, physical: a.phy, mentality: a.men, goalkeeping: a.gk }
      const foot = r.esdFoot ?? (helpers.unit(r.id, 11) < (LEFT_SHARE[prim] ?? 0.2) ? 'L' : 'R')
      if (r.esdFoot) stats.footEsd++
      if (r.later) stats.later++
      const wrText = r.workRate ?? (a.wr >= 70 ? 'high/high' : a.wr <= 45 ? 'low/low' : 'medium/medium')
      const rep = r.ovr >= 88 ? 4 : r.ovr >= 84 ? 3 : r.ovr >= 80 ? 2 : 1
      const v = Math.max(0.1, helpers.modelValue(r.ovr, r.f.age, prim))
      records.push({
        id: r.id,
        league: leagueId,
        season: S,
        club: r.club,
        name: r.name,
        nation: r.f.nat,
        age: r.f.age,
        positions: r.positions,
        overall: r.ovr,
        attrs,
        value: r1(v),
        wage: Math.round(helpers.modelWage(v)),
        traits: helpers.traitsFor(r.id, { composure: a.men, reactions: a.men, age: r.f.age, reputation: rep, workRate: wrText, physical: a.phy }),
        foot,
        height: r.height,
        depth: [a.sta, a.str, a.agg, a.jmp, a.wr],
        apps: r.f.apps,
      })
      stats.rows++
      if (r.id.startsWith('s')) stats.idS++
      else if (r.id.startsWith('e')) stats.idE++
      else stats.idW++
    }
    const table = fs_.clubs.filter((c) => c.appsSource === 'table').length
    seasonInfo.push({ season: S, appsSource: Math.round((table / Math.max(1, fs_.clubs.length)) * 100) / 100, clubs: fs_.clubs.map((c) => c.clubId).sort() })
  }
  records.sort((a, b) => a.season - b.season || a.club.localeCompare(b.club) || b.overall - a.overall || a.id.localeCompare(b.id))
  return { records, seasons: seasonInfo, report, stats }
}
