/**
 * Feel and accuracy check of the classic-season ratings. Run by hand (it needs
 * the dataset cache), never in CI; exits non-zero when a threshold fails.
 *
 *   node scripts/import/historic/validate-ratings.mjs [--top 30]
 *
 * 1. Held-out check: the PW model fitted on ESD England 2008-09 to 2011-12
 *    (ratings-coef.json `heldOutPW`) rates 2012-13 and 2013-14. Thresholds,
 *    on the model: MAE <= 2.5 and Spearman >= 0.77 against EA. The classic
 *    calibration applied to the same rows is printed for information.
 *    Wikidata features of the ESD players come from
 *    $DATA_CACHE/historic/esd-wikidata.json (ESD player id -> { links, caps,
 *    spells }: Wikidata CC0, matched by birth date and a name token; built by
 *    the classic-seasons research and kept in the cache).
 * 2. Long-gap check: classic 1999-2000 ratings (no later EA rating is used for
 *    that season) against the first ESD rating of the same men, projected
 *    back to 1999 with the age curve. MAE <= 3.5, mean bias within +-1.5.
 * 3. Distribution, in every classic season of public/data/england: no club
 *    holds more than 6 of the league's top 15; the champion's top three
 *    average 85-89; the lowest-placed club's best player is 74-80; no
 *    attribute above 94 unless the overall is 85 or more.
 * 4. Prints the top N of every classic season for review.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CACHE, DATA_DIR, SOURCES } from '../config.mjs'
import { HISTORIC_CACHE } from './config.mjs'
import { COEF, CALIBRATION, backProject, predict, adjustClub, stretchGroup } from './ratings.mjs'

const args = process.argv.slice(2)
const TOP = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 30
const failures = []
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures.push(what) }

function rankArr(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1 } return r }
function pearson(a, b) { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2 } return sab / Math.sqrt(saa * sbb) }
const spearman = (a, b) => pearson(rankArr(a), rankArr(b))
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)

// ------------------------------------------------------------------ 1. held-out ESD England 2012-14
const db = new DatabaseSync(path.join(CACHE, SOURCES.eurosoccer.dir, 'database.sqlite'), { readOnly: true })
const wdFile = path.join(HISTORIC_CACHE, 'esd-wikidata.json')
const wd = fs.existsSync(wdFile) ? JSON.parse(fs.readFileSync(wdFile, 'utf8')) : null
const GROUP = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', DM: 'MID', CM: 'MID', AM: 'MID', LW: 'FWD', RW: 'FWD', ST: 'FWD' }
function inferPosition(x, y) {
  if (y <= 1) return 'GK'
  if (y <= 4) return x <= 2 ? 'LB' : x >= 8 ? 'RB' : 'CB'
  if (y <= 6) return x <= 2 ? 'LB' : x >= 8 ? 'RB' : 'DM'
  if (y === 7) return x <= 2 ? 'LW' : x >= 8 ? 'RW' : 'CM'
  if (y <= 9) return x <= 3 ? 'LW' : x >= 7 ? 'RW' : 'AM'
  return x <= 3 ? 'LW' : x >= 7 ? 'RW' : 'ST'
}
const snaps = new Map()
for (const r of db.prepare('select player_api_id pid, date, overall_rating ovr from Player_Attributes where overall_rating is not null order by date, id').all()) {
  if (!snaps.has(r.pid)) snaps.set(r.pid, [])
  snaps.get(r.pid).push({ t: new Date(r.date).getTime(), ovr: r.ovr })
}
function snapshot(pid, season) {
  const target = Date.UTC(season + 1, 8, 15), start = Date.UTC(season + 1, 1, 1), end = Date.UTC(season + 2, 0, 31)
  let best = null, bs = Infinity
  for (const r of snaps.get(pid) ?? []) { if (r.t < start || r.t > end) continue; const s = Math.abs(r.t - target); if (s < bs) { bs = s; best = r } }
  return best ? best.ovr : null
}
function esdEngland(seasons) {
  const players = new Map(db.prepare('select player_api_id, player_name, birthday from Player').all().map((p) => [p.player_api_id, p]))
  const cols = ['home_team_api_id', 'away_team_api_id', 'home_team_goal', 'away_team_goal', 'goal']
  for (const side of ['home', 'away']) for (let i = 1; i <= 11; i++) cols.push(`${side}_player_${i}`, `${side}_player_X${i}`, `${side}_player_Y${i}`)
  const stmt = db.prepare(`select ${cols.join(',')} from Match where league_id = 1729 and season = ?`)
  const out = []
  for (const season of seasons) {
    const matches = stmt.all(`${season}/${season + 1}`)
    const table = new Map()
    const T = (id) => (table.get(id) ?? table.set(id, { id, p: 0, pts: 0, gf: 0, ga: 0 }).get(id))
    const agg = new Map()
    for (const m of matches) {
      const h = T(m.home_team_api_id), a = T(m.away_team_api_id)
      h.p++; a.p++; h.gf += m.home_team_goal; h.ga += m.away_team_goal; a.gf += m.away_team_goal; a.ga += m.home_team_goal
      if (m.home_team_goal > m.away_team_goal) h.pts += 3; else if (m.home_team_goal < m.away_team_goal) a.pts += 3; else { h.pts++; a.pts++ }
      const goals = new Map()
      for (const v of String(m.goal ?? '').split('<value>').slice(1)) {
        const type = /<goal_type>([^<]*)</.exec(v)?.[1]
        if (type === 'o' || type === 'dg') continue
        const p1 = /<player1>(\d+)</.exec(v)?.[1]
        if (p1) goals.set(+p1, (goals.get(+p1) ?? 0) + 1)
      }
      for (const side of ['home', 'away']) {
        const team = m[`${side}_team_api_id`]
        for (let i = 1; i <= 11; i++) {
          const pid = m[`${side}_player_${i}`]
          if (pid == null) continue
          const k = `${pid}|${team}`
          const r = agg.get(k) ?? agg.set(k, { pid, team, starts: 0, goals: 0, pos: {} }).get(k)
          r.starts++
          r.goals += goals.get(pid) ?? 0
          const x = m[`${side}_player_X${i}`], y = m[`${side}_player_Y${i}`]
          if (x != null && y != null) { const p = inferPosition(10 - x, y); r.pos[p] = (r.pos[p] ?? 0) + 1 }
        }
      }
    }
    const ranked = [...table.values()].sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf)
    ranked.forEach((t, i) => (t.rank = i + 1))
    const byTeam = new Map()
    for (const r of agg.values()) (byTeam.get(r.team) ?? byTeam.set(r.team, []).get(r.team)).push(r)
    for (const list of byTeam.values()) list.sort((a, b) => b.starts - a.starts || a.pid - b.pid).forEach((r, i) => (r.startRank = i + 1))
    for (const r of agg.values()) {
      const p = players.get(r.pid)
      const target = snapshot(r.pid, season)
      const posTop = Object.entries(r.pos).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
      if (!p || target == null || !posTop || !p.birthday) continue
      const t = table.get(r.team)
      out.push({ pid: r.pid, name: p.player_name, season, teamId: r.team, group: GROUP[posTop], target, starts: r.starts, games: t.p, goals: r.goals, startRank: r.startRank, age: (Date.UTC(season, 7, 1) - new Date(p.birthday).getTime()) / (365.25 * 864e5), tableRow: { games: t.p, gf: t.gf, ga: t.ga, pts: t.pts, position: t.rank, clubs: ranked.length } })
    }
  }
  return out
}

if (!wd) console.log(`SKIP  held-out check: ${wdFile} is missing`)
else {
  const rows = esdEngland([2012, 2013])
  for (const r of rows) {
    const w = wd[r.pid]
    r.p = { share: r.starts / r.games, startRank: r.startRank, goals: r.goals, age: r.age, links: w?.links ?? 0, caps: w?.caps ?? null, intl: !!w?.spells?.some((s) => (s.s == null || s.s <= r.season + 1) && (s.e == null || s.e >= r.season)), matched: !!w }
    const t = r.tableRow
    const share = r.p.share
    const f = { share, share2: share * share, logRank: Math.log(Math.min(r.startRank, 30)), gdpg: (t.gf - t.ga) / t.games, rankFrac: (t.position - 1) / (t.clubs - 1), shareXppg: share * (t.pts / t.games), goals: r.goals / t.games, age: r.age - 27, age2: (r.age - 27) ** 2, logLinks: w ? Math.log1p(w.links) : 0, wdMissing: w ? 0 : 1, logCaps: w?.caps != null ? Math.log1p(w.caps) : 0, intlActive: r.p.intl ? 1 : 0 }
    const pr = predict(r.group, f, COEF.heldOutPW)
    r.raw = pr.y
    r.team = pr.team
  }
  const report = (label, preds) => {
    const by = new Map()
    rows.forEach((r, i) => (by.get(`${r.teamId}|${r.season}`) ?? by.set(`${r.teamId}|${r.season}`, []).get(`${r.teamId}|${r.season}`)).push(i))
    let ws = 0, wn = 0, top = 0
    for (const ids of by.values()) {
      if (ids.length < 8) continue
      ws += spearman(ids.map((i) => preds[i]), ids.map((i) => rows[i].target)); wn++
      const best = ids.reduce((b, i) => (preds[i] > preds[b] ? i : b), ids[0])
      const s = [...ids].sort((a, b) => rows[b].target - rows[a].target)
      if (rows[best].target >= rows[s[2]].target) top++
    }
    const mae = mean(rows.map((r, i) => Math.abs(preds[i] - r.target)))
    const rho = spearman(preds, rows.map((r) => r.target))
    console.log(`  ${label.padEnd(26)} n ${rows.length}  MAE ${mae.toFixed(2)}  Spearman ${rho.toFixed(3)}  within-team ${(ws / wn).toFixed(3)}  top pick in top 3 ${(top / wn).toFixed(2)}`)
    return { mae, rho }
  }
  console.log('Held-out ESD England 2012-13 and 2013-14 (model fitted on 2008-09 to 2011-12):')
  const model = report('model', rows.map((r) => r.raw))
  check(model.mae <= 2.5, `held-out model MAE ${model.mae.toFixed(2)} <= 2.5`)
  check(model.rho >= 0.77, `held-out model Spearman ${model.rho.toFixed(3)} >= 0.77`)
  // the calibration: damping and prominence by club, then the stretch by season and group
  const by = new Map()
  for (const r of rows) (by.get(`${r.teamId}|${r.season}`) ?? by.set(`${r.teamId}|${r.season}`, []).get(`${r.teamId}|${r.season}`)).push(r)
  for (const list of by.values()) adjustClub(list)
  report('+ star adjustment', rows.map((r) => r.adj))
  for (const s of [2012, 2013]) for (const g of ['GK', 'DEF', 'MID', 'FWD']) stretchGroup(rows.filter((r) => r.season === s && r.group === g), CALIBRATION, { lo: 0, hi: 99 })
  // For information: the classic calibration applied to modern data. It costs accuracy there on purpose: EA does
  // rate a modern champion's regulars highly, while in the classic inputs that lift is an artefact (see ratings.mjs).
  report('+ stretch and shift (classic)', rows.map((r) => r.ovr))
}

// ------------------------------------------------------------------ 2 and 3. the classic pack
const packFile = path.join(DATA_DIR, 'england', 'players-classic.json')
if (!fs.existsSync(packFile)) { console.log(`SKIP  classic checks: ${packFile} is missing (run build.mjs)`); process.exit(failures.length ? 1 : 0) }
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'))
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'england', 'meta.json'), 'utf8'))
const C = Object.fromEntries(pack.columns.map((c, i) => [c, i]))
const rows = pack.rows.map((r) => Object.fromEntries(pack.columns.map((c) => [c, r[C[c]]])))

// 2. long gap: 1999-2000 against the first ESD rating projected back
{
  const players = new Map(db.prepare('select player_api_id, player_fifa_api_id from Player').all().flatMap((p) => [[`e${p.player_api_id}`, p.player_api_id], ...(p.player_fifa_api_id != null ? [[`s${p.player_fifa_api_id}`, p.player_api_id]] : [])]))
  const pairs = []
  for (const r of rows.filter((x) => x.season === 1999)) {
    const pid = players.get(r.id)
    if (pid == null) continue
    for (let T = 2006; T <= 2015; T++) {
      const o = snapshot(pid, T)
      if (o == null) continue
      pairs.push({ r, bp: backProject(o, r.age, T - 1999), gap: T - 1999, esd: o })
      break
    }
  }
  const mae = mean(pairs.map((x) => Math.abs(x.r.ovr - x.bp)))
  const bias = mean(pairs.map((x) => x.r.ovr - x.bp))
  console.log(`\nLong-gap check, 1999-2000 vs first ESD rating projected back: n ${pairs.length}, Spearman ${spearman(pairs.map((x) => x.r.ovr), pairs.map((x) => x.bp)).toFixed(3)}, MAE ${mae.toFixed(2)}, bias ${bias.toFixed(2)}`)
  for (const x of pairs.sort((a, b) => Math.abs(b.r.ovr - b.bp) - Math.abs(a.r.ovr - a.bp)).slice(0, 6)) console.log(`    ${x.r.name} (${x.r.club}) ours ${x.r.ovr} vs ${x.bp.toFixed(0)} (ESD ${x.esd}, ${x.gap} seasons later)`)
  check(mae <= 3.5, `1999-2000 back-check MAE ${mae.toFixed(2)} <= 3.5`)
  check(Math.abs(bias) <= 1.5, `1999-2000 back-check bias ${bias.toFixed(2)} within +-1.5`)
}

// 3. distribution, and 4. the top N for review
const ATTRS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy', 'men', 'gk', 'sta', 'str', 'agg', 'jmp', 'wr']
for (const ms of meta.seasons.filter((s) => s.classic).sort((a, b) => a.season - b.season)) {
  const S = ms.season
  const R = rows.filter((r) => r.season === S).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id))
  const label = `${S}-${String((S + 1) % 100).padStart(2, '0')}`
  const top15 = R.slice(0, 15)
  const perClub = {}
  for (const r of top15) perClub[r.club] = (perClub[r.club] ?? 0) + 1
  const maxClub = Object.entries(perClub).sort((a, b) => b[1] - a[1])[0]
  const champ = ms.table[0].clubId
  const champTop3 = mean(R.filter((r) => r.club === champ).slice(0, 3).map((r) => r.ovr))
  const last = ms.table.at(-1).clubId
  const lastBest = R.find((r) => r.club === last)?.ovr
  const hot = R.filter((r) => r.ovr < 85 && ATTRS.some((a) => r[a] > 94))
  console.log(`\n${label}: ${R.length} rows; top-15 most from one club ${maxClub[1]} (${maxClub[0]}); champion ${champ} top-3 ${champTop3.toFixed(1)}; bottom club ${last} best ${lastBest}; attribute > 94 under 85 overall: ${hot.length}`)
  check(maxClub[1] <= 6, `${label} no club above 6 of the top 15`)
  check(champTop3 >= 85 && champTop3 <= 89, `${label} champion's top 3 average ${champTop3.toFixed(1)} in 85-89`)
  check(lastBest >= 74 && lastBest <= 80, `${label} bottom club's best ${lastBest} in 74-80`)
  check(hot.length === 0, `${label} no attribute above 94 under 85 overall`)
  console.log(`  top ${TOP}: ` + R.slice(0, TOP).map((r, i) => `${i + 1}. ${r.name} (${r.club}, ${r.pos.split('|')[0]}) ${r.ovr}`).join(' | '))
}
db.close()
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed')
process.exit(failures.length ? 1 : 0)
