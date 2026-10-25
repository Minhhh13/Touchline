/**
 * Build the game's player database from public datasets.
 *
 *   node scripts/import/build.mjs
 *
 * Output: public/data/england/players.json and public/data/england/meta.json
 *
 * Seasons covered (season = start year):
 *   2008-2013  European Soccer Database (lineups + sofifa attributes)
 *   2014-2023  EA Sports FC 24 complete dataset (FIFA 15 .. FC 24 editions)
 *   2024       EA Sports FC 25 ratings
 *   2025       EA Sports FC 26 ratings
 *   2026       EA Sports FC 27 ratings (current season)
 * League tables: openfootball results files, 2000-01 onwards.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readCsv } from './csv.mjs'
import { nation, nationFlag, NATION_NAMES } from './nations.mjs'
import { LEAGUES, clubIdIn, FC24_LEAGUE_BY_ID, EA_LEAGUE_BY_NAME, EURO_LEAGUE_BY_ID } from './leagues.mjs'
import { parseResults, buildTable } from './openfootball.mjs'
import { CACHE, DATA_DIR, SOURCES, OPENFOOTBALL_SEASONS, seasonSlug } from './config.mjs'
import { ensureDatasets } from './download.mjs'
import { fileURLToPath } from 'node:url'

// The data stamp (`generatedAt`) every pack of this build carries: today's date, plus `.<suffix>` when
// DATA_STAMP_SUFFIX is set, for a second rebuild on the same day. A stamp names exactly one set of bytes: the
// online layer archives packs by it, and src/online/__tests__/stamps.test.ts fails when bytes change under it.
const STAMP_SUFFIX = process.env.DATA_STAMP_SUFFIX ?? ''
if (STAMP_SUFFIX && !/^[0-9A-Za-z]{1,8}$/.test(STAMP_SUFFIX)) throw new Error('DATA_STAMP_SUFFIX must be 1 to 8 letters or digits')
const GENERATED_AT = new Date().toISOString().slice(0, 10) + (STAMP_SUFFIX ? `.${STAMP_SUFFIX}` : '')

let NATION_OVERRIDES = {}
try {
  NATION_OVERRIDES = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'nations-override.json'), 'utf8'))
} catch {
  NATION_OVERRIDES = {}
}

// ---------------------------------------------------------------------------
// helpers

function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
/** Deterministic pseudo-random in [0,1) from a string. */
function unit(str, salt) {
  return (hash53(str, salt) % 100000) / 100000
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const num = (v) => {
  if (v === undefined || v === null || v === '') return NaN
  const n = Number(String(v).replace(/\+.*$/, ''))
  return Number.isFinite(n) ? n : NaN
}
const r1 = (v) => Math.round(v * 10) / 10

const POS_MAP = {
  GK: 'GK',
  CB: 'CB',
  LB: 'LB',
  LWB: 'LB',
  RB: 'RB',
  RWB: 'RB',
  CDM: 'DM',
  DM: 'DM',
  CM: 'CM',
  CAM: 'AM',
  AM: 'AM',
  LM: 'LW',
  LW: 'LW',
  LF: 'LW',
  RM: 'RW',
  RW: 'RW',
  RF: 'RW',
  ST: 'ST',
  CF: 'ST',
}
function mapPositions(list) {
  const out = []
  for (const raw of list) {
    const p = POS_MAP[String(raw).trim().toUpperCase()]
    if (p && !out.includes(p)) out.push(p)
  }
  return out.slice(0, 3)
}

/**
 * Derive the eight game attributes from detailed stats.
 * `d` keys: acc, spr, fin, shp, lsh, vol, pen, posn, spa, lpa, vis, cro, cur, fk, bc, dri, agi, bal, rea, com,
 *           mar, sta, sli, int, hea, str, stm, agg, jmp, gkd, gkh, gkk, gkp, gkr
 * `face` optional EA face stats {pac, sho, pas, dri, def, phy}
 */
function deriveAttributes(d, face, isGk) {
  const g = (k) => (Number.isFinite(d[k]) ? d[k] : NaN)
  const w = (pairs) => {
    let tw = 0
    let s = 0
    for (const [k, wt] of pairs) {
      const v = g(k)
      if (Number.isFinite(v)) {
        tw += wt
        s += wt * v
      }
    }
    return tw > 0 ? s / tw : NaN
  }
  let pace = w([['acc', 0.45], ['spr', 0.55]])
  let shooting = w([['fin', 0.45], ['shp', 0.2], ['lsh', 0.2], ['posn', 0.05], ['vol', 0.05], ['pen', 0.05]])
  let passing = w([['spa', 0.35], ['vis', 0.2], ['cro', 0.2], ['lpa', 0.15], ['cur', 0.05], ['fk', 0.05]])
  let dribbling = w([['dri', 0.4], ['bc', 0.35], ['agi', 0.1], ['bal', 0.1], ['rea', 0.05]])
  let defending = w([['mar', 0.3], ['sta', 0.3], ['int', 0.2], ['hea', 0.1], ['sli', 0.1]])
  let physical = w([['str', 0.5], ['stm', 0.25], ['agg', 0.2], ['jmp', 0.05]])
  let mentality = isGk ? w([['rea', 0.55], ['com', 0.45]]) : w([['rea', 0.4], ['com', 0.35], ['vis', 0.25]])
  let goalkeeping = w([['gkr', 0.3], ['gkd', 0.25], ['gkh', 0.25], ['gkp', 0.2]])
  if (isGk) passing = w([['gkk', 0.6], ['spa', 0.4]])
  if (face && !isGk) {
    if (Number.isFinite(face.pac)) pace = face.pac
    if (Number.isFinite(face.sho)) shooting = face.sho
    if (Number.isFinite(face.pas)) passing = face.pas
    if (Number.isFinite(face.dri)) dribbling = face.dri
    if (Number.isFinite(face.def)) defending = face.def
    if (Number.isFinite(face.phy)) physical = face.phy
  }
  const fix = (v, fallback) => clamp(Math.round(Number.isFinite(v) ? v : fallback), 1, 99)
  return {
    pace: fix(pace, 55),
    shooting: fix(shooting, 45),
    passing: fix(passing, 55),
    dribbling: fix(dribbling, 55),
    defending: fix(defending, 45),
    physical: fix(physical, 60),
    mentality: fix(mentality, 60),
    goalkeeping: fix(goalkeeping, isGk ? 60 : 10),
  }
}

/** Market value in today's money (GBP millions), position and age aware. */
function modelValue(overall, age, primaryPos) {
  const base = 0.25 * Math.pow(1.21, overall - 60)
  const ageF = age <= 21 ? 1.3 : age <= 26 ? 1.15 : age <= 29 ? 1 : age <= 31 ? 0.72 : age <= 33 ? 0.45 : 0.25
  const posF = { GK: 0.75, CB: 0.9, LB: 0.85, RB: 0.85, DM: 1, CM: 1, AM: 1.1, LW: 1.1, RW: 1.1, ST: 1.15 }[primaryPos] ?? 1
  return base * ageF * posF
}
function modelWage(value) {
  return 5 * Math.pow(Math.max(0.1, value), 0.85)
}

function traitsFor(id, { composure, reactions, age, reputation, workRate, physical }) {
  const n = (salt) => unit(id, salt) - 0.5 // -0.5..0.5
  const consistency = clamp(0.5 + 0.004 * ((composure ?? 60) - 60) + 0.003 * ((reactions ?? 60) - 60) + n(1) * 0.3, 0.05, 0.98)
  const injury = clamp(0.3 + n(2) * 0.5 + (age >= 32 ? 0.15 : age >= 30 ? 0.07 : 0) - 0.002 * ((physical ?? 60) - 60), 0.03, 0.97)
  const bigMatch = clamp(0.45 + ((reputation ?? 1) - 1) * 0.1 + 0.003 * ((composure ?? 60) - 60) + n(3) * 0.3, 0.05, 0.98)
  let wr = 0
  if (workRate) {
    const [att, def] = String(workRate).split('/').map((s) => s.trim().toLowerCase())
    const score = (s) => (s === 'high' ? 1 : s === 'low' ? -1 : 0)
    wr = (score(att) + score(def)) / 2
  }
  const professionalism = clamp(0.55 + wr * 0.15 + n(4) * 0.3, 0.05, 0.98)
  const pct = (v) => Math.round(v * 100)
  return [pct(consistency), pct(injury), pct(bigMatch), pct(professionalism)]
}

/**
 * The five depth attributes (stamina, strength, aggression, jumping, work rate),
 * 0-100 integers. Raw EA / European Soccer Database values are used where the
 * source has them; otherwise the fallbacks below derive them from the eight core
 * attributes, age and height. `src/engine/depth.ts` holds the same formulas so
 * the engine fills an older pack identically.
 */
const WORK_RATE_VALUE = { high: 80, medium: 55, low: 35 }
function workRateValue(text) {
  if (!text) return NaN
  const parts = String(text).split('/').map((t) => WORK_RATE_VALUE[t.trim().toLowerCase()])
  if (parts.length !== 2 || parts.some((v) => v === undefined)) return NaN
  return (parts[0] + parts[1]) / 2
}
const clamp99 = (v) => clamp(Math.round(v), 1, 99)
export function deriveStamina(physical, age) {
  return clamp99(physical + 3 - Math.max(0, (Number.isFinite(age) ? age : 26) - 29) * 2)
}
export function deriveStrength(physical, height) {
  const h = height > 0 ? height : 180
  return clamp99(physical + (h - 180) * 0.35)
}
export function deriveAggression(defending, mentality) {
  return clamp99(0.5 * defending + 0.5 * mentality + 1)
}
export function deriveJumping(height, physical) {
  const h = height > 0 ? height : 180
  return clamp99(0.6 * physical + 26 + (h - 180) * 0.9)
}
export function deriveWorkRate(mentality) {
  return clamp(Math.round(25 + mentality * 0.5), 35, 80)
}
const depthStats = { raw: { sta: 0, str: 0, agg: 0, jmp: 0, wr: 0 }, derived: { sta: 0, str: 0, agg: 0, jmp: 0, wr: 0 } }
/** `raw` holds the detailed stats {stm, str, agg, jmp} (NaN when missing); `workRate` is the source text, if any. */
function depthFor(raw, attrs, age, height, workRate) {
  const pick = (key, value, fallback) => {
    if (Number.isFinite(value) && value >= 1) {
      depthStats.raw[key]++
      return clamp99(value)
    }
    depthStats.derived[key]++
    return fallback
  }
  const r = raw ?? {}
  return [
    pick('sta', r.stm, deriveStamina(attrs.physical, age)),
    pick('str', r.str, deriveStrength(attrs.physical, height)),
    pick('agg', r.agg, deriveAggression(attrs.defending, attrs.mentality)),
    pick('jmp', r.jmp, deriveJumping(height, attrs.physical)),
    pick('wr', workRateValue(workRate), deriveWorkRate(attrs.mentality)),
  ]
}

function ageAt(dob, season) {
  if (!dob) return NaN
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return NaN
  const ref = new Date(Date.UTC(season, 7, 1)) // Aug 1 of season start
  let age = ref.getUTCFullYear() - d.getUTCFullYear()
  const m = ref.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) age--
  return age
}

// ---------------------------------------------------------------------------
// Row assembly

export const COLUMNS = ['id', 'season', 'club', 'name', 'nation', 'age', 'pos', 'ovr', 'pac', 'sho', 'pas', 'dri', 'def', 'phy', 'men', 'gk', 'value', 'wage', 'cons', 'inj', 'big', 'prof', 'foot', 'height', 'sta', 'str', 'agg', 'jmp', 'wr']
/** players.json format: 3 added the five depth columns (stamina, strength, aggression, jumping, work rate). */
export const PLAYERS_VERSION = 3

function makeRow(p) {
  return [
    p.id,
    p.season,
    p.club,
    p.name,
    p.nation,
    p.age,
    p.positions.join('|'),
    p.overall,
    p.attrs.pace,
    p.attrs.shooting,
    p.attrs.passing,
    p.attrs.dribbling,
    p.attrs.defending,
    p.attrs.physical,
    p.attrs.mentality,
    p.attrs.goalkeeping,
    p.value,
    p.wage,
    ...p.traits,
    p.foot,
    p.height,
    ...p.depth,
  ]
}

const warnings = []
const unknownNations = new Map()
function nationCode(name) {
  const n = nation(name)
  if (n.unknownName) unknownNations.set(n.unknownName, (unknownNations.get(n.unknownName) ?? 0) + 1)
  return n.code
}

// ---------------------------------------------------------------------------
// Source: FC 24 dataset (FIFA 15 .. FC 24)

async function loadFc24(sofifaIndex) {
  const file = path.join(CACHE, SOURCES.fc24.dir, 'male_players.csv')
  const rows = []
  const maxValueByVersion = new Map()
  const buffer = []
  for await (const r of readCsv(file)) {
    const version = Math.round(num(r.fifa_version))
    if (!Number.isFinite(version)) continue
    const season = 2000 + version - 1 // FIFA 15 -> 2014-15
    const value = num(r.value_eur)
    if (Number.isFinite(value)) maxValueByVersion.set(version, Math.max(maxValueByVersion.get(version) ?? 0, value))
    const sofifaId = r.player_id
    if (sofifaId && !sofifaIndex.has(sofifaId)) {
      sofifaIndex.set(sofifaId, {
        nation: r.nationality_name,
        positions: mapPositions(String(r.player_positions).split(',')),
        name: r.short_name,
        longName: r.long_name,
        dob: r.dob,
      })
    }
    const league = FC24_LEAGUE_BY_ID[Math.round(num(r.league_id))] ?? null
    buffer.push({ r, version, season, league })
  }
  for (const { r, version, season, league } of buffer) {
    let clubId = null
    if (league) {
      clubId = clubIdIn(league, r.club_name) ?? null
      if (!clubId) warnings.push(`fc24 v${version} ${league}: unknown club ${r.club_name}`)
    }
    const positions = mapPositions(String(r.player_positions).split(','))
    if (!positions.length) continue
    const isGk = positions[0] === 'GK'
    const d = {
      acc: num(r.movement_acceleration),
      spr: num(r.movement_sprint_speed),
      fin: num(r.attacking_finishing),
      shp: num(r.power_shot_power),
      lsh: num(r.power_long_shots),
      vol: num(r.attacking_volleys),
      pen: num(r.mentality_penalties),
      posn: num(r.mentality_positioning),
      spa: num(r.attacking_short_passing),
      lpa: num(r.skill_long_passing),
      vis: num(r.mentality_vision),
      cro: num(r.attacking_crossing),
      cur: num(r.skill_curve),
      fk: num(r.skill_fk_accuracy),
      bc: num(r.skill_ball_control),
      dri: num(r.skill_dribbling),
      agi: num(r.movement_agility),
      bal: num(r.movement_balance),
      rea: num(r.movement_reactions),
      com: num(r.mentality_composure),
      mar: num(r.defending_marking_awareness),
      sta: num(r.defending_standing_tackle),
      sli: num(r.defending_sliding_tackle),
      int: num(r.mentality_interceptions),
      hea: num(r.attacking_heading_accuracy),
      str: num(r.power_strength),
      stm: num(r.power_stamina),
      agg: num(r.mentality_aggression),
      jmp: num(r.power_jumping),
      gkd: num(r.goalkeeping_diving),
      gkh: num(r.goalkeeping_handling),
      gkk: num(r.goalkeeping_kicking),
      gkp: num(r.goalkeeping_positioning),
      gkr: num(r.goalkeeping_reflexes),
    }
    const face = { pac: num(r.pace), sho: num(r.shooting), pas: num(r.passing), dri: num(r.dribbling), def: num(r.defending), phy: num(r.physic) }
    const attrs = deriveAttributes(d, face, isGk)
    const overall = Math.round(num(r.overall))
    let age = Math.round(num(r.age))
    if (!Number.isFinite(age)) age = ageAt(r.dob, season)
    const value = num(r.value_eur)
    const maxV = maxValueByVersion.get(version) ?? 1
    const eaValue = Number.isFinite(value) && value > 0 ? (value / maxV) * 170 : NaN
    const id = `s${r.player_id}`
    rows.push({
      id,
      season,
      league: clubId ? league : null,
      club: clubId,
      name: r.short_name,
      nation: clubId ? nationCode(r.nationality_name) : nation(r.nationality_name).code,
      age,
      positions,
      overall,
      attrs,
      raw: { stm: d.stm, str: d.str, agg: d.agg, jmp: d.jmp },
      eaValue,
      traitInputs: { composure: d.com, reactions: d.rea, reputation: num(r.international_reputation), workRate: r.work_rate },
      foot: String(r.preferred_foot || 'R')[0].toUpperCase(),
      height: Math.round(num(r.height_cm)) || 0,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Source: FC 25 dataset (2024-25)

async function loadFc25(sofifaIndex) {
  const file = path.join(CACHE, SOURCES.fc25.dir, 'male_players.csv')
  const rows = []
  const season = 2024
  // name+nation -> sofifa id lookup to keep stable ids across seasons
  const byName = new Map()
  for (const [id, info] of sofifaIndex) {
    byName.set(`${info.name}|${info.nation}`.toLowerCase(), id)
    if (info.longName) byName.set(`${info.longName}|${info.nation}`.toLowerCase(), id)
  }
  for await (const r of readCsv(file)) {
    const league = EA_LEAGUE_BY_NAME[r.League] ?? null
    let clubId = null
    if (league) {
      clubId = clubIdIn(league, r.Team) ?? null
      if (!clubId) warnings.push(`fc25 ${league}: unknown club ${r.Team}`)
    }
    const positions = mapPositions([r.Position, ...String(r['Alternative positions'] || '').split(',')])
    if (!positions.length) continue
    const isGk = positions[0] === 'GK'
    const d = {
      acc: num(r.Acceleration),
      spr: num(r['Sprint Speed']),
      fin: num(r.Finishing),
      shp: num(r['Shot Power']),
      lsh: num(r['Long Shots']),
      vol: num(r.Volleys),
      pen: num(r.Penalties),
      posn: num(r.Positioning),
      spa: num(r['Short Passing']),
      lpa: num(r['Long Passing']),
      vis: num(r.Vision),
      cro: num(r.Crossing),
      cur: num(r.Curve),
      fk: num(r['Free Kick Accuracy']),
      bc: num(r['Ball Control']),
      dri: num(r.Dribbling),
      agi: num(r.Agility),
      bal: num(r.Balance),
      rea: num(r.Reactions),
      com: num(r.Composure),
      mar: num(r['Def Awareness']),
      sta: num(r['Standing Tackle']),
      sli: num(r['Sliding Tackle']),
      int: num(r.Interceptions),
      hea: num(r['Heading Accuracy']),
      str: num(r.Strength),
      stm: num(r.Stamina),
      agg: num(r.Aggression),
      jmp: num(r.Jumping),
      gkd: num(r['GK Diving']),
      gkh: num(r['GK Handling']),
      gkk: num(r['GK Kicking']),
      gkp: num(r['GK Positioning']),
      gkr: num(r['GK Reflexes']),
    }
    const face = isGk ? null : { pac: num(r.PAC), sho: num(r.SHO), pas: num(r.PAS), dri: num(r.DRI), def: num(r.DEF), phy: num(r.PHY) }
    const attrs = deriveAttributes(d, face, isGk)
    const overall = Math.round(num(r.OVR))
    const age = Math.round(num(r.Age))
    const urlId = String(r.url || '').match(/\/(\d+)\/?$/)?.[1]
    const key = `${r.Name}|${r.Nation}`.toLowerCase()
    const sofifaId = urlId || byName.get(key)
    const id = sofifaId ? `s${sofifaId}` : `n${hash53(key).toString(36)}`
    const heightCm = num(String(r.Height).match(/(\d+)\s*cm/)?.[1])
    rows.push({
      id,
      season,
      league: clubId ? league : null,
      club: clubId,
      name: r.Name,
      nation: clubId ? nationCode(r.Nation) : nation(r.Nation).code,
      age,
      positions,
      overall,
      attrs,
      raw: { stm: d.stm, str: d.str, agg: d.agg, jmp: d.jmp },
      eaValue: NaN,
      traitInputs: { composure: d.com, reactions: d.rea, reputation: overall >= 88 ? 4 : overall >= 84 ? 3 : overall >= 80 ? 2 : 1 },
      foot: String(r['Preferred foot'] || 'R')[0].toUpperCase(),
      height: Math.round(heightCm) || 0,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Source: FC 26 dataset (2025-26)

async function loadFc26() {
  const file = path.join(CACHE, SOURCES.fc26.dir, 'ea_fc26_players.csv')
  const rows = []
  const season = 2025
  const ages = new Map()
  for await (const r of readCsv(file)) {
    const league = EA_LEAGUE_BY_NAME[r.leagueName] ?? null
    let clubId = null
    if (league) {
      clubId = clubIdIn(league, r.team) ?? null
      if (!clubId) warnings.push(`fc26 ${league}: unknown club ${r.team}`)
    }
    const positions = mapPositions([r.position, ...String(r.alternatePositions || '').split(',')])
    if (!positions.length) continue
    const isGk = positions[0] === 'GK'
    const d = {
      acc: num(r.acceleration),
      spr: num(r.sprintSpeed),
      fin: num(r.finishing),
      shp: num(r.shotPower),
      lsh: num(r.longShots),
      vol: num(r.volleys),
      pen: num(r.penalties),
      posn: num(r.positioning),
      spa: num(r.shortPassing),
      lpa: num(r.longPassing),
      vis: num(r.vision),
      cro: num(r.crossing),
      cur: num(r.curve),
      fk: num(r.freeKickAccuracy),
      bc: num(r.ballControl),
      dri: num(r.dribbling),
      agi: num(r.agility),
      bal: num(r.balance),
      rea: num(r.reactions),
      com: num(r.composure),
      mar: num(r.defensiveAwareness),
      sta: num(r.standingTackle),
      sli: num(r.slidingTackle),
      int: num(r.interceptions),
      hea: num(r.headingAccuracy),
      str: num(r.strength),
      stm: num(r.stamina),
      agg: num(r.aggression),
      jmp: num(r.jumping),
      gkd: num(r.gkDiving),
      gkh: num(r.gkHandling),
      gkk: num(r.gkKicking),
      gkp: num(r.gkPositioning),
      gkr: num(r.gkReflexes),
    }
    const face = isGk ? null : { pac: num(r.pac), sho: num(r.sho), pas: num(r.pas), dri: num(r.dri), def: num(r.def), phy: num(r.phy) }
    const attrs = deriveAttributes(d, face, isGk)
    const overall = Math.round(num(r.overallRating))
    const age = ageAt(r.birthdate, season)
    const name = r.commonName && r.commonName.trim() ? r.commonName.trim() : `${String(r.firstName || '').trim()[0] ? String(r.firstName).trim()[0] + '. ' : ''}${String(r.lastName || '').trim()}`
    const id = `s${r.id}`
    ages.set(String(r.id), age)
    rows.push({
      id,
      season,
      league: clubId ? league : null,
      club: clubId,
      name,
      nation: clubId ? nationCode(r.nationality) : nation(r.nationality).code,
      age,
      positions,
      overall,
      attrs,
      raw: { stm: d.stm, str: d.str, agg: d.agg, jmp: d.jmp },
      eaValue: NaN,
      traitInputs: { composure: d.com, reactions: d.rea, reputation: overall >= 88 ? 4 : overall >= 84 ? 3 : overall >= 80 ? 2 : 1 },
      foot: String(r.preferredFoot || 'Right')[0].toUpperCase(),
      height: Math.round(num(r.height)) || 0,
    })
  }
  return { rows, ages }
}

// ---------------------------------------------------------------------------
// Source: FC 27 dataset (2026-27, current season)

async function loadFc27(fc26Ages, sofifaIndex, currentClubs) {
  const file = path.join(CACHE, SOURCES.fc27.dir, 'players.csv')
  const rows = []
  const season = 2026
  for await (const r of readCsv(file)) {
    if (r.gender && r.gender !== "Men's Football") continue
    const league = EA_LEAGUE_BY_NAME[r.league] ?? null
    let clubId = null
    if (league) {
      clubId = clubIdIn(league, r.club) ?? null
      const known = currentClubs[league]
      if (clubId && known && known.size && !known.has(clubId)) clubId = null
      if (!clubId) warnings.push(`fc27 ${league}: unknown or non-top-flight club ${r.club}`)
    }
    const positions = mapPositions([r.position, ...String(r.alternate_positions || '').split(/[\s,]+/)].filter(Boolean))
    if (!positions.length) continue
    const isGk = positions[0] === 'GK'
    const d = {
      acc: num(r.movement_acceleration),
      spr: num(r.movement_sprint_speed),
      fin: num(r.attacking_finishing),
      shp: num(r.power_shot_power),
      lsh: num(r.power_long_shots),
      vol: num(r.attacking_volleys),
      pen: num(r.mentality_penalties),
      posn: num(r.mentality_positioning),
      spa: num(r.attacking_short_passing),
      lpa: num(r.skill_long_passing),
      vis: num(r.mentality_vision),
      cro: num(r.attacking_crossing),
      cur: num(r.skill_curve),
      fk: num(r.skill_fk_accuracy),
      bc: num(r.skill_ball_control),
      dri: num(r.skill_dribbling),
      agi: num(r.movement_agility),
      bal: num(r.movement_balance),
      rea: num(r.movement_reactions),
      com: num(r.mentality_composure),
      mar: num(r.defending_awareness),
      sta: num(r.defending_standing_tackle),
      sli: num(r.defending_sliding_tackle),
      int: num(r.mentality_interceptions),
      hea: num(r.attacking_heading_accuracy),
      str: num(r.power_strength),
      stm: num(r.power_stamina),
      agg: num(r.mentality_aggression),
      jmp: num(r.power_jumping),
      gkd: num(r.goalkeeping_diving),
      gkh: num(r.goalkeeping_handling),
      gkk: num(r.goalkeeping_kicking),
      gkp: num(r.goalkeeping_positioning),
      gkr: num(r.goalkeeping_reflexes),
    }
    const face = isGk ? null : { pac: num(r.pace), sho: num(r.shooting), pas: num(r.passing), dri: num(r.dribbling), def: num(r.defending), phy: num(r.physicality) }
    const attrs = deriveAttributes(d, face, isGk)
    const overall = Math.round(num(r.overall_rating))
    const pid = String(r.player_id || '').trim()
    let age = ageAt(r.birthdate, season)
    if (!Number.isFinite(age)) {
      const prev = fc26Ages.get(pid)
      age = Number.isFinite(prev) ? prev + 1 : sofifaIndex.get(pid)?.dob ? ageAt(sofifaIndex.get(pid).dob, season) : 26
    }
    const name = r.common_name && r.common_name.trim() ? r.common_name.trim() : `${String(r.first_name || '').trim()[0] ? String(r.first_name).trim()[0] + '. ' : ''}${String(r.last_name || '').trim()}`
    const id = pid ? `s${pid}` : `n${hash53(name + r.nationality).toString(36)}`
    rows.push({
      id,
      season,
      league: clubId ? league : null,
      club: clubId,
      name,
      nation: clubId ? nationCode(r.nationality) : nation(r.nationality).code,
      age,
      positions,
      overall,
      attrs,
      raw: { stm: d.stm, str: d.str, agg: d.agg, jmp: d.jmp },
      eaValue: NaN,
      traitInputs: { composure: d.com, reactions: d.rea, reputation: overall >= 88 ? 4 : overall >= 84 ? 3 : overall >= 80 ? 2 : 1 },
      foot: String(r.preferred_foot || 'Right')[0].toUpperCase(),
      height: Math.round(num(r.height_cm)) || 0,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Source: European Soccer Database (2008-09 .. 2013-14)

function inferPosition(x, y) {
  if (y <= 1) return 'GK'
  if (y <= 4) return x <= 2 ? 'LB' : x >= 8 ? 'RB' : 'CB'
  if (y <= 6) return x <= 2 ? 'LB' : x >= 8 ? 'RB' : 'DM'
  if (y === 7) return x <= 2 ? 'LW' : x >= 8 ? 'RW' : 'CM'
  if (y <= 9) return x <= 3 ? 'LW' : x >= 7 ? 'RW' : 'AM'
  return x <= 3 ? 'LW' : x >= 7 ? 'RW' : 'ST'
}

function loadEuroSoccer(sofifaIndex) {
  const db = new DatabaseSync(path.join(CACHE, SOURCES.eurosoccer.dir, 'database.sqlite'), { readOnly: true })
  // team_api_id -> { league, club } resolved per league the team played in
  const teams = new Map()
  for (const [euroId, leagueId] of Object.entries(EURO_LEAGUE_BY_ID)) {
    for (const t of db.prepare('select distinct t.team_api_id, t.team_long_name from Team t where t.team_api_id in (select home_team_api_id from Match where league_id = ?)').all(Number(euroId))) {
      const id = clubIdIn(leagueId, t.team_long_name)
      if (id) teams.set(t.team_api_id, { league: leagueId, club: id })
      else warnings.push(`eurosoccer ${leagueId}: unknown club ${t.team_long_name}`)
    }
  }
  const players = new Map()
  for (const p of db.prepare('select player_api_id, player_name, player_fifa_api_id, birthday, height from Player').all()) players.set(p.player_api_id, p)

  const attrStmt = db.prepare('select * from Player_Attributes where player_api_id = ? order by date')
  const attrCache = new Map()
  const attrsFor = (pid) => {
    if (!attrCache.has(pid)) attrCache.set(pid, attrStmt.all(pid))
    return attrCache.get(pid)
  }

  const cols = []
  for (const side of ['home', 'away']) for (let i = 1; i <= 11; i++) cols.push(`${side}_player_${i}`, `${side}_player_X${i}`, `${side}_player_Y${i}`)
  const matchStmt = db.prepare(`select season, home_team_api_id, away_team_api_id, ${cols.join(', ')} from Match where league_id = ? and season = ?`)

  const rows = []
  for (const [euroId, leagueId] of Object.entries(EURO_LEAGUE_BY_ID)) for (const season of [2008, 2009, 2010, 2011, 2012, 2013]) {
    const key = `${season}/${season + 1}`
    const agg = new Map() // `${pid}|${club}` -> { apps, posCounts }
    for (const m of matchStmt.all(Number(euroId), key)) {
      for (const side of ['home', 'away']) {
        const team = teams.get(m[`${side}_team_api_id`])
        if (!team) continue
        const club = team.club
        for (let i = 1; i <= 11; i++) {
          const pid = m[`${side}_player_${i}`]
          if (pid == null) continue
          const x = m[`${side}_player_X${i}`]
          const y = m[`${side}_player_Y${i}`]
          const k = `${pid}|${club}`
          if (!agg.has(k)) agg.set(k, { pid, club, league: leagueId, apps: 0, pos: new Map() })
          const a = agg.get(k)
          a.apps++
          if (x != null && y != null) {
            const p = inferPosition(Number(x), Number(y))
            a.pos.set(p, (a.pos.get(p) ?? 0) + 1)
          }
        }
      }
    }
    // Ratings are set after the season they describe: prefer the update closest to the
    // following September (next edition release), inside a window around it.
    const target = Date.UTC(season + 1, 8, 15)
    const start = Date.UTC(season + 1, 1, 1)
    const end = Date.UTC(season + 2, 0, 31)
    for (const a of agg.values()) {
      const p = players.get(a.pid)
      if (!p) continue
      const all = attrsFor(a.pid)
      if (!all.length) continue
      let best = null
      let bestScore = Infinity
      for (const row of all) {
        const t = new Date(row.date).getTime()
        const inSeason = t >= start && t <= end
        const score = Math.abs(t - target) + (inSeason ? 0 : 1e13)
        if (score < bestScore) {
          bestScore = score
          best = row
        }
      }
      if (!best || best.overall_rating == null) continue
      const inferred = [...a.pos.entries()].sort((x, y) => y[1] - x[1])
      const inferredPositions = inferred.filter(([, n], i) => i === 0 || n >= a.apps * 0.25).map(([pos]) => pos).slice(0, 3)
      const sof = p.player_fifa_api_id != null ? sofifaIndex.get(String(p.player_fifa_api_id)) : undefined
      let positions = inferredPositions
      if (sof && sof.positions.length) {
        // Trust the EA position list but keep what we actually observed first.
        positions = [...new Set([...inferredPositions.slice(0, 1), ...sof.positions])].slice(0, 3)
        if (inferredPositions[0] === 'GK' || sof.positions[0] === 'GK') positions = ['GK']
      }
      if (!positions.length) continue
      const isGk = positions[0] === 'GK'
      const d = {
        acc: best.acceleration,
        spr: best.sprint_speed,
        fin: best.finishing,
        shp: best.shot_power,
        lsh: best.long_shots,
        vol: best.volleys,
        pen: best.penalties,
        posn: best.positioning,
        spa: best.short_passing,
        lpa: best.long_passing,
        vis: best.vision,
        cro: best.crossing,
        cur: best.curve,
        fk: best.free_kick_accuracy,
        bc: best.ball_control,
        dri: best.dribbling,
        agi: best.agility,
        bal: best.balance,
        rea: best.reactions,
        com: best.composure,
        mar: best.marking,
        sta: best.standing_tackle,
        sli: best.sliding_tackle,
        int: best.interceptions,
        hea: best.heading_accuracy,
        str: best.strength,
        stm: best.stamina,
        agg: best.aggression,
        jmp: best.jumping,
        gkd: best.gk_diving,
        gkh: best.gk_handling,
        gkk: best.gk_kicking,
        gkp: best.gk_positioning,
        gkr: best.gk_reflexes,
      }
      for (const k in d) d[k] = d[k] == null ? NaN : Number(d[k])
      const attrs = deriveAttributes(d, null, isGk)
      const overall = Math.round(Number(best.overall_rating))
      const age = ageAt(p.birthday, season)
      const id = p.player_fifa_api_id != null ? `s${p.player_fifa_api_id}` : `e${a.pid}`
      const workRate = best.attacking_work_rate && best.defensive_work_rate ? `${best.attacking_work_rate}/${best.defensive_work_rate}` : undefined
      rows.push({
        id,
        season,
        league: a.league,
        club: a.club,
        name: shortName(p.player_name),
        nation: sof ? nationCode(sof.nation) : 'UNK',
        age,
        positions,
        overall,
        attrs,
        raw: { stm: d.stm, str: d.str, agg: d.agg, jmp: d.jmp },
        eaValue: NaN,
        traitInputs: { composure: d.com, reactions: d.rea, reputation: overall >= 88 ? 4 : overall >= 84 ? 3 : overall >= 80 ? 2 : 1, workRate },
        foot: String(best.preferred_foot || 'right')[0].toUpperCase(),
        height: Math.round(Number(p.height)) || 0,
        apps: a.apps,
        /** Already a post-season rating; do not look up the next edition. */
        postSeason: true,
      })
    }
  }
  db.close()
  return rows
}

function shortName(full) {
  const parts = String(full).trim().split(/\s+/)
  if (parts.length <= 1) return full
  if (parts.length === 2) return `${parts[0][0]}. ${parts[1]}`
  // Keep particles like "van", "de", "da" with the surname
  const particles = new Set(['van', 'de', 'der', 'den', 'da', 'di', 'del', 'dos', 'le', 'la', 'el', 'von', 'du', 'des', 'mac', 'mc', 'ten', 'ter'])
  let i = 1
  while (i < parts.length - 1 && !particles.has(parts[i].toLowerCase())) i++
  return `${parts[0][0]}. ${parts.slice(i).join(' ')}`
}

// ---------------------------------------------------------------------------
// League tables

async function loadTables(leagueId) {
  const dir = path.join(CACHE, 'openfootball', leagueId)
  const tables = {}
  for (const season of OPENFOOTBALL_SEASONS) {
    const file = path.join(dir, `${seasonSlug(season)}.txt`)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const { matches, unknown } = parseResults(text, (name) => clubIdIn(leagueId, name))
    for (const u of unknown) warnings.push(`openfootball ${leagueId} ${seasonSlug(season)}: unknown club ${u}`)
    if (!matches.length) continue
    const table = buildTable(matches)
    const teams = table.length
    const expected = teams * (teams - 1)
    tables[season] = { season, complete: matches.length >= expected && teams >= 16, matches: matches.length, table }
  }
  return tables
}

// ---------------------------------------------------------------------------
// Main

async function main() {
  await ensureDatasets()
  const leagueIds = Object.keys(LEAGUES)
  console.log('Loading league tables...')
  const tablesByLeague = {}
  for (const id of leagueIds) {
    tablesByLeague[id] = await loadTables(id)
    console.log(`  ${id}: ${Object.keys(tablesByLeague[id]).length} seasons of results`)
  }

  const sofifaIndex = new Map()
  console.log('Loading FC 24 dataset (FIFA 15 .. FC 24)...')
  const fc24 = await loadFc24(sofifaIndex)
  console.log(`  ${fc24.filter((r) => r.club).length} top-flight player-seasons from ${fc24.length} records, ${sofifaIndex.size} known players`)
  console.log('Loading FC 25...')
  const fc25 = await loadFc25(sofifaIndex)
  console.log(`  ${fc25.filter((r) => r.club).length} top-flight player-seasons from ${fc25.length} records`)
  console.log('Loading FC 26...')
  const { rows: fc26, ages } = await loadFc26()
  console.log(`  ${fc26.filter((r) => r.club).length} top-flight player-seasons from ${fc26.length} records`)
  console.log('Loading FC 27...')
  const currentClubs = {}
  for (const id of leagueIds) {
    const t = tablesByLeague[id][2026]
    currentClubs[id] = new Set((t?.table ?? []).map((r) => r.clubId))
  }
  const fc27 = await loadFc27(ages, sofifaIndex, currentClubs)
  console.log(`  ${fc27.filter((r) => r.club).length} top-flight player-seasons from ${fc27.length} records`)
  console.log('Loading European Soccer Database (2008-2014)...')
  const euro = loadEuroSoccer(sofifaIndex)
  console.log(`  ${euro.length} player-seasons`)

  // Index every edition record by (season, id) so a season can borrow the rating
  // from the following edition, which reflects how the player actually played.
  const all = [...euro, ...fc24, ...fc25, ...fc26, ...fc27]
  const byEdition = new Map()
  for (const rec of all) {
    if (!byEdition.has(rec.season)) byEdition.set(rec.season, new Map())
    const m = byEdition.get(rec.season)
    if (!m.has(rec.id) || (rec.club && !m.get(rec.id).club)) m.set(rec.id, rec)
  }
  let borrowed = 0
  const finalized = []
  for (const rec of all) {
    if (!rec.club) continue
    let use = rec
    if (!rec.postSeason) {
      const next = byEdition.get(rec.season + 1)?.get(rec.id)
      if (next && Number.isFinite(next.overall)) {
        use = next
        borrowed++
      }
    }
    const primary = rec.positions[0]
    if (rec.nation === 'UNK' && NATION_OVERRIDES[rec.id]) rec.nation = NATION_OVERRIDES[rec.id]
    const modelV = modelValue(use.overall, rec.age, primary)
    const v = Math.max(0.1, Number.isFinite(use.eaValue) ? 0.5 * use.eaValue + 0.5 * modelV : modelV)
    const ti = use.traitInputs ?? rec.traitInputs ?? {}
    finalized.push({
      id: rec.id,
      league: rec.league,
      season: rec.season,
      club: rec.club,
      name: rec.name,
      nation: rec.nation,
      age: rec.age,
      positions: rec.positions,
      overall: use.overall,
      attrs: use.attrs,
      value: r1(v),
      wage: Math.round(modelWage(v)),
      traits: traitsFor(rec.id, { composure: ti.composure, reactions: ti.reactions, age: rec.age, reputation: ti.reputation, workRate: ti.workRate, physical: use.attrs.physical }),
      foot: rec.foot,
      height: rec.height,
      depth: depthFor(use.raw, use.attrs, rec.age, rec.height, ti.workRate),
      apps: rec.apps,
    })
  }
  console.log(`  ${borrowed} of ${finalized.length} player-seasons use the following edition's rating`)

  const leaguesIndex = []
  let grandTotal = 0
  for (const leagueId of leagueIds) {
    const league = LEAGUES[leagueId]
    const tables = tablesByLeague[leagueId]
    const seen = new Map()
    for (const p of finalized) {
      if (p.league !== leagueId) continue
      const k = `${p.season}|${p.club}|${p.id}`
      const prev = seen.get(k)
      if (!prev || (p.apps ?? 0) > (prev.apps ?? 0)) seen.set(k, p)
    }
    const byNameKey = new Map()
    for (const p of seen.values()) {
      const k = `${p.season}|${p.club}|${p.name.toLowerCase()}|${p.age}`
      if (!byNameKey.has(k)) byNameKey.set(k, p)
    }
    const players = [...byNameKey.values()].sort((a, b) => a.season - b.season || a.club.localeCompare(b.club) || b.overall - a.overall)

    // Thin squads: a club with too few rows in a season but a full squad in the next (or previous)
    // one borrows the missing players from there, so the league keeps every real entrant instead
    // of dropping one whose edition happened to be sparse. Any club with 8 to 11 rows qualifies;
    // a club in that season's results table qualifies with any number of rows, even none.
    const countBy = new Map()
    for (const p of players) countBy.set(`${p.season}|${p.club}`, (countBy.get(`${p.season}|${p.club}`) ?? 0) + 1)
    const candidates = new Map()
    for (const [k, n] of countBy) if (n >= 8 && n < 12) candidates.set(k, n)
    // Only seasons the player data covers: a historic table alone never becomes a playable season
    const seasonsWithRows = new Set(players.map((p) => p.season))
    for (const [s, t] of Object.entries(tables)) {
      if (!seasonsWithRows.has(Number(s))) continue
      for (const r of t.table) {
        const k = `${s}|${r.clubId}`
        const n = countBy.get(k) ?? 0
        if (n < 12) candidates.set(k, n)
      }
    }
    const extra = []
    for (const [k, n] of candidates) {
      const [sStr, club] = k.split('|')
      const s = Number(sStr)
      const adj = (countBy.get(`${s + 1}|${club}`) ?? 0) >= 12 ? s + 1 : (countBy.get(`${s - 1}|${club}`) ?? 0) >= 12 ? s - 1 : null
      if (adj === null) {
        if (n < 12) warnings.push(`${leagueId} ${s}: ${club} has ${n} rows and no adjacent season to borrow from`)
        continue
      }
      // Anyone already in that season (at this club or, after a move, another) is not borrowed twice
      const have = new Set(players.filter((p) => p.season === s).map((p) => p.id))
      const pool = players.filter((p) => p.season === adj && p.club === club && !have.has(p.id)).sort((a, b) => b.overall - a.overall)
      let added = 0
      for (const p of pool) {
        if (n + added >= 16) break
        extra.push({ ...p, season: s, age: p.age + (s - adj) })
        added++
      }
      warnings.push(`${leagueId} ${s}: ${club} had ${n} rows, topped up with ${added} from ${adj}`)
    }
    if (extra.length) {
      players.push(...extra)
      players.sort((a, b) => a.season - b.season || a.club.localeCompare(b.club) || b.overall - a.overall)
    }

    const usedClubs = new Set(players.map((p) => p.club))
    for (const t of Object.values(tables)) for (const r of t.table) usedClubs.add(r.clubId)
    const clubs = league.clubs.filter((c) => usedClubs.has(c.id)).map(({ aliases, ...rest }) => rest)
    const seasons = [...new Set(players.map((p) => p.season))].sort()
    const seasonInfo = seasons.map((s) => {
      // Clubs with a real squad that season; tiny squads are data noise (a loan or a mid-season move)
      const counts = {}
      for (const p of players) if (p.season === s) counts[p.club] = (counts[p.club] ?? 0) + 1
      const clubsIn = Object.keys(counts).filter((c) => counts[c] >= 12).sort()
      const t = tables[s]
      // Without a results table, only the newest season in the pack is still being played
      return { season: s, clubs: clubsIn, complete: t ? t.complete : s < Math.max(...seasons), hasTable: !!t, table: t?.table ?? [] }
    })
    const nations = {}
    for (const p of players) if (!nations[p.nation]) nations[p.nation] = { name: NATION_NAMES[p.nation] ?? 'Unknown', flag: nationFlag(p.nation) }

    const outDir = path.join(DATA_DIR, leagueId)
    await mkdir(outDir, { recursive: true })
    const playersOut = { version: PLAYERS_VERSION, generatedAt: GENERATED_AT, columns: COLUMNS, rows: players.map(makeRow) }
    await writeFile(path.join(outDir, 'players.json'), JSON.stringify(playersOut))
    const meta = {
      version: 2,
      league: { id: leagueId, name: league.name, shortName: league.shortName, country: league.country },
      clubs,
      nations,
      seasons: seasonInfo,
      historicTables: Object.fromEntries(Object.entries(tables).filter(([s]) => !seasons.includes(Number(s))).map(([s, t]) => [s, t.table])),
      sources: Object.values(SOURCES).map((s) => ({ credit: s.credit, licence: s.licence })).concat([{ credit: 'openfootball (GitHub)', licence: 'CC0 / public domain' }]),
    }
    await writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta))
    const sizeMb = (Buffer.byteLength(JSON.stringify(playersOut)) / 1e6).toFixed(2)
    const distinct = new Set(players.map((p) => p.id)).size
    grandTotal += players.length
    console.log(`\n${league.name}: ${players.length} player-seasons, ${distinct} players, ${clubs.length} clubs, ${seasons[0]}-${seasons.at(-1)}, players.json ${sizeMb} MB`)
    const depthMeans = ['sta', 'str', 'agg', 'jmp', 'wr'].map((k, i) => `${k} ${(players.reduce((a, p) => a + p.depth[i], 0) / players.length).toFixed(1)}`).join(' ')
    console.log(`  depth means: ${depthMeans}`)
    for (const s of seasonInfo) console.log(`  ${s.season}-${String(s.season + 1).slice(2)}: ${players.filter((p) => p.season === s.season).length} rows, ${s.clubs.length} clubs, table ${s.hasTable ? (s.complete ? 'complete' : 'partial') : 'none'}`)
    leaguesIndex.push({ id: leagueId, name: league.name, shortName: league.shortName, country: league.country, firstSeason: seasons[0], lastSeason: seasons.at(-1), playerSeasons: players.length, players: distinct, clubs: clubs.length })
  }
  await writeFile(path.join(DATA_DIR, 'leagues.json'), JSON.stringify({ version: 2, generatedAt: GENERATED_AT, leagues: leaguesIndex }))
  console.log(`\nTotal: ${grandTotal} player-seasons across ${leagueIds.length} leagues`)
  console.log('Depth columns from source / derived:', Object.fromEntries(Object.keys(depthStats.raw).map((k) => [k, `${depthStats.raw[k]} / ${depthStats.derived[k]}`])))
  if (unknownNations.size) console.log('Unknown nations:', [...unknownNations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30))
  const uniqWarnings = [...new Set(warnings)]
  if (uniqWarnings.length) console.log(`Warnings (${uniqWarnings.length}):\n  ` + uniqWarnings.slice(0, 80).join('\n  '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
