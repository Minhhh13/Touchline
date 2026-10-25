/**
 * Player facts from the cache: a Wikidata entity reduced to what the classic
 * import reads (CC0), and the infobox of an English Wikipedia player article
 * (CC BY-SA 4.0; facts only: listed position, height, club spells).
 * Pure functions over cached records; no I/O beyond the cache readers passed in.
 */
import { cleanWiki, templates, links } from './parse-season.mjs'

/** Wikidata class of a senior national team ("national association football team"). */
const NATIONAL_TEAM = new Set(['Q6979593', 'Q135408445'])
const NOT_SENIOR = /under|u-?\d|youth|olympic|\bb\b|amateur|futsal|beach|women|junior|reserve|xi\b/i
const year = (t) => (t ? Number(String(t).slice(0, 4)) : null)

/**
 * { qid, label, dob, links, height, sport[], cit[], pos[] (labels), clubs[], nt[], caps, fifaId }
 * from a trimmed entity; `entity(qid)` reads another cached entity (teams, positions).
 */
export function personFromEntity(e, entity) {
  if (!e || e.missing) return null
  const c = e.claims ?? {}
  const vals = (p) => (c[p] ?? []).map((x) => x.v)
  const dobClaim = (c.P569 ?? []).find((x) => x.rank === 'preferred') ?? (c.P569 ?? [])[0]
  // a birth date known to the day only; a year-only date gives no age to the day
  const dob = dobClaim && !String(dobClaim.v).includes('~') ? String(dobClaim.v).slice(0, 10) : dobClaim ? `${String(dobClaim.v).slice(0, 4)}-07-01` : null
  let height = null
  for (const h of c.P2048 ?? []) {
    const cm = h.v.unit === 'Q11573' ? h.v.amount * 100 : h.v.unit === 'Q174728' ? h.v.amount : null
    if (cm && cm > 150 && cm < 210) { height = Math.round(cm); break }
  }
  const clubs = []
  const nt = []
  for (const s of c.P54 ?? []) {
    const team = entity(s.v)
    const isNt = (team?.claims?.P31 ?? []).some((x) => NATIONAL_TEAM.has(x.v))
    const spell = { team: s.v, label: team?.label ?? '', s: year(s.q?.P580?.[0]), e: year(s.q?.P582?.[0]), apps: s.q?.P1350 ? Number(s.q.P1350[0].amount ?? s.q.P1350[0]) : null, goals: s.q?.P1351 ? Number(s.q.P1351[0].amount ?? s.q.P1351[0]) : null }
    for (const k of ['apps', 'goals']) if (!Number.isFinite(spell[k])) spell[k] = null
    if (isNt) { if (!NOT_SENIOR.test(spell.label)) nt.push(spell) } else clubs.push(spell)
  }
  return {
    qid: e.id,
    label: e.label,
    dob,
    links: e.sitelinks ?? 0,
    height,
    sport: vals('P1532'),
    cit: vals('P27'),
    pos: vals('P413').map((q) => entity(q)?.label ?? '').filter(Boolean),
    clubs,
    nt,
    caps: nt.some((t) => t.apps != null) ? nt.reduce((s, t) => s + (t.apps ?? 0), 0) : null,
    fifaId: vals('P1469')[0] ?? null,
  }
}

const num = (s) => { const m = String(s ?? '').replace(/<[^>]+>|\{\{[^}]*\}\}|\[\[|\]\]|'''?/g, '').match(/\(?\s*(\d+)\s*\)?/); return m ? Number(m[1]) : null }
function heightCm(v) {
  if (!v) return null
  let m = v.match(/\{\{\s*(?:height|convert)\s*\|[^}]*?m\s*=\s*([\d.]+)/i) || v.match(/\{\{\s*convert\s*\|\s*([\d.]+)\s*\|\s*m\b/i)
  if (m) return Math.round(Number(m[1]) * (Number(m[1]) < 3 ? 100 : 1))
  m = v.match(/\{\{\s*height\s*\|[^}]*?ft\s*=\s*(\d+)[^}]*?in\s*=\s*([\d.]+)/i) || v.match(/\{\{\s*convert\s*\|\s*(\d+)\s*\|\s*ft\s*\|\s*([\d.]+)\s*\|\s*in/i)
  if (m) return Math.round(Number(m[1]) * 30.48 + Number(m[2]) * 2.54)
  m = v.match(/([\d.]+)\s*m\b/)
  if (m && Number(m[1]) > 1.5 && Number(m[1]) < 2.2) return Math.round(Number(m[1]) * 100)
  return null
}

/**
 * The infobox of a player article: the listed position text, the article's own
 * "played as a ..." phrase (often more specific), height, and the club spells
 * with league appearances and goals. Null when the page has no football infobox.
 */
export function infoboxFacts(raw) {
  const text = cleanWiki(raw ?? '')
  const ib = [...templates(text, 'Infobox football biography|Infobox footballer')][0]
  if (!ib) return null
  const n = ib.named
  const position = (n.position ?? '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<[^>]+>|\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim()
  const spells = []
  for (let k = 1; k <= 40; k++) {
    const club = n['clubs' + k]
    if (!club) continue
    const L = links(club)[0]
    const yrs = String(n['years' + k] ?? '').replace(/&ndash;|–|—/g, '-').match(/(\d{4})\s*(?:-\s*(\d{4})?)?/)
    spells.push({ club: L ? L.title : club.replace(/\[\[|\]\]/g, '').trim(), loan: /→|loan/i.test(club), s: yrs ? Number(yrs[1]) : null, e: yrs ? (yrs[2] ? Number(yrs[2]) : /-\s*$/.test(String(n['years' + k])) ? null : Number(yrs[1])) : null, apps: num(n['caps' + k]), goals: num(n['goals' + k]) })
  }
  const plain = (x) => x.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/\{\{[^{}]*\}\}/g, '')
  const body = plain(text.slice(text.indexOf(ib.raw) + ib.raw.length))
  const leadEnd = body.search(/^==/m)
  const styleAt = body.search(/^==+\s*(style of play|playing style|player profile|style)/im)
  // the lead first, then a "Style of play" section, then anywhere
  const parts = [body.slice(0, leadEnd < 0 ? 3000 : leadEnd), styleAt >= 0 ? body.slice(styleAt, styleAt + 6000) : '', body]
  let lead = null
  outer: for (const part of parts) {
    for (const lm of part.matchAll(/\b(?:played|plays|playing|operated|operates|deployed|used|featured|lined up)\s+(?:mainly |mostly |primarily |predominantly |usually |chiefly |principally |often |normally |largely |initially )?(?:as|in|on|at)\s+(?:an?\s+|the\s+)?([^.;()]{3,100})/gi)) {
      const c = lm[1].trim()
      if (/goalkeeper|back|defender|sweeper|midfield|winger|wing|forward|striker|playmaker/i.test(c.slice(0, 60))) { lead = c.slice(0, 100); break outer }
    }
  }
  return { position, lead, height: heightCm(n.height), spells }
}

// ------------------------------------------------------------------ positions

export function coarseFromP413(labels) {
  const s = labels.join(' ').toLowerCase()
  if (/goalkeeper/.test(s)) return 'GK'
  if (/forward|striker/.test(s) && !/defender|back/.test(s)) return 'FW'
  if (/back|defender|sweeper|libero/.test(s)) return 'DF'
  if (/midfielder|winger|wing half|playmaker/.test(s)) return 'MF'
  return null
}
export function specificFromP413(labels, coarse) {
  const s = labels.map((l) => l.toLowerCase())
  const has = (re) => s.some((l) => re.test(l))
  if (coarse === 'GK') return 'GK'
  if (coarse === 'DF') {
    if (has(/^left[- ](back|wing-back)/)) return 'LB'
    if (has(/^right[- ](back|wing-back)/)) return 'RB'
    if (has(/full-back|fullback|wing-back/)) return 'FB'
    if (has(/centre-back|center back|sweeper|libero/)) return 'CB'
    return null
  }
  if (coarse === 'MF') {
    if (has(/defensive midfielder/)) return 'DM'
    if (has(/attacking midfielder|playmaker/)) return 'AM'
    if (has(/^left winger|left midfielder/)) return 'LW'
    if (has(/^right winger|right midfielder/)) return 'RW'
    if (has(/winger|wide midfielder/)) return 'W'
    return null
  }
  if (coarse === 'FW') {
    if (has(/^left winger/)) return 'LW'
    if (has(/^right winger/)) return 'RW'
    return 'ST'
  }
  return null
}
// Position words in the order written: the first is the primary position
const TEXT_POS = [
  [/goal ?keeper/, 'GK'], [/left[- ]?(full[- ]?)?back|left wing[- ]back/, 'LB'], [/right[- ]?(full[- ]?)?back|right wing[- ]back/, 'RB'], [/full[- ]?back|wing[- ]back/, 'FB'],
  [/cent(re|er)[- ]?(back|half)|central defender|sweeper|libero/, 'CB'], [/defensive midfield|holding midfield/, 'DM'], [/attacking midfield|playmaker/, 'AM'],
  [/left[- ](wing(er)?|midfield(er)?|flank|side of midfield)|left[- ]sided midfield/, 'LW'], [/right[- ](wing(er)?|midfield(er)?|flank|side of midfield)|right[- ]sided midfield/, 'RW'], [/winger|wide midfield/, 'W'],
  [/cent(re|ral) midfield|box[- ]to[- ]box/, 'CM'], [/second striker|support striker/, 'ST'], [/striker|cent(re|er)[- ]forward|forward/, 'ST'], [/midfielder/, 'MID'], [/defender/, 'DEFG'],
]
export function positionsFromText(text) {
  const t = String(text ?? '').toLowerCase()
  const hits = []
  for (const [re, code] of TEXT_POS) { const m = t.match(re); if (m) hits.push({ at: m.index, code }) }
  // a generic word inside a specific one ("midfielder" in "defensive midfielder") does not count
  const out = []
  for (const h of hits.sort((a, b) => a.at - b.at || a.code.localeCompare(b.code))) {
    if ((h.code === 'MID' && hits.some((x) => ['DM', 'AM', 'LW', 'RW', 'W', 'CM'].includes(x.code))) || (h.code === 'DEFG' && hits.some((x) => ['CB', 'LB', 'RB', 'FB'].includes(x.code)))) continue
    if (!out.includes(h.code)) out.push(h.code)
  }
  return out
}
export const COMPAT = { GK: ['GK'], DF: ['LB', 'RB', 'FB', 'CB', 'DEFG', 'DM'], MF: ['DM', 'AM', 'LW', 'RW', 'W', 'CM', 'MID', 'LB', 'RB', 'FB'], FW: ['ST', 'LW', 'RW', 'W', 'AM'] }
/** Text positions compatible with the coarse group: the infobox's when specific, else the article's phrase. */
export function textPositions(ib, coarse) {
  const leadPos = positionsFromText(ib?.lead).filter((c) => COMPAT[coarse].includes(c))
  const boxPos = positionsFromText(ib?.position).filter((c) => COMPAT[coarse].includes(c))
  const vague = (c) => ['MID', 'DEFG', 'W', 'FB'].includes(c)
  const boxSpecific = boxPos.length && !vague(boxPos[0])
  const txt = boxSpecific ? [...boxPos, ...leadPos.filter((c) => !boxPos.includes(c) && !vague(c))] : [...leadPos.filter((c) => !vague(c)), ...boxPos, ...leadPos].filter((c, i, a) => a.indexOf(c) === i)
  return txt.map((c) => (c === 'MID' ? 'CM' : c === 'DEFG' ? null : c)).filter(Boolean)
}

// ------------------------------------------------------------------ nations

const HISTORIC_CODE = { TCH: 'CZE', URS: 'RUS', CIS: 'RUS', FRG: 'GER', GDR: 'GER', YUG: 'SRB', SCG: 'SRB', ZAI: 'COD', HOL: 'NED', ROI: 'IRL', EIR: 'IRL' }
/** Wikidata country items to the packs' codes (fallback when no contemporary Wikipedia code exists). */
const COUNTRY = { Q21: 'ENG', Q22: 'SCO', Q25: 'WAL', Q26: 'NIR', Q27: 'IRL', Q142: 'FRA', Q20: 'NOR', Q35: 'DEN', Q756617: 'DEN', Q55: 'NED', Q29999: 'NED', Q34: 'SWE', Q183: 'GER', Q38: 'ITA', Q29: 'ESP', Q45: 'POR', Q31: 'BEL', Q39: 'SUI', Q40: 'AUT', Q33: 'FIN', Q36: 'POL', Q213: 'CZE', Q214: 'SVK', Q159: 'RUS', Q212: 'UKR', Q155: 'BRA', Q414: 'ARG', Q408: 'AUS', Q30: 'USA', Q16: 'CAN', Q1028: 'MAR', Q1033: 'NGA', Q117: 'GHA', Q1009: 'CMR', Q258: 'RSA', Q766: 'JAM', Q754: 'TRI', Q224: 'CRO', Q403: 'SRB', Q41: 'GRE', Q43: 'TUR', Q28: 'HUN', Q218: 'ROU', Q219: 'BUL', Q189: 'ISL', Q664: 'NZL', Q77: 'URU', Q298: 'CHI', Q739: 'COL', Q1006: 'GUI', Q1008: 'CIV', Q801: 'ISR', Q229: 'CYP', Q1041: 'SEN', Q215: 'SVN', Q225: 'BIH', Q221: 'MKD', Q211: 'LVA', Q37: 'LTU', Q191: 'EST', Q230: 'GEO', Q184: 'BLR', Q17: 'JPN', Q884: 'KOR', Q96: 'MEX', Q1027: 'MRI', Q1036: 'UGA', Q953: 'ZAM', Q954: 'ZIM', Q962: 'BEN', Q1005: 'GAM', Q1011: 'CPV', Q1014: 'LBR', Q1025: 'MTN', Q1029: 'MOZ', Q1037: 'RWA', Q1044: 'SLE', Q1045: 'SOM', Q974: 'COD', Q971: 'CGO', Q1000: 'GAB', Q115: 'ETH', Q114: 'KEN', Q79: 'EGY', Q262: 'ALG', Q948: 'TUN', Q750: 'BOL', Q419: 'PER', Q717: 'VEN', Q736: 'ECU', Q733: 'PAR', Q800: 'CRC', Q790: 'HAI', Q242: 'BLZ', Q244: 'BRB', Q23635: 'BER', Q222: 'ALB', Q233: 'MLT', Q228: 'AND', Q347: 'LIE', Q32: 'LUX', Q4628: 'FRO', Q1410: 'GIB' }
/** The nation code: the contemporary Wikipedia squad code first (`known` tells a valid pack code), then Wikidata. */
export function nationFor(code, person, known) {
  if (code) {
    const c = String(code).trim().toUpperCase()
    const m = HISTORIC_CODE[c] ?? c
    if (known(m)) return { code: m, src: 'wikipedia' }
  }
  if (!person) return { code: 'UNK', src: 'none' }
  for (const q of person.sport) if (COUNTRY[q]) return { code: COUNTRY[q], src: 'wd:P1532' }
  for (const q of person.cit) if (q !== 'Q145' && q !== 'Q174193' && COUNTRY[q]) return { code: COUNTRY[q], src: 'wd:P27' }
  if (person.cit.includes('Q145')) return { code: 'ENG', src: 'wd:UK' }
  return { code: 'UNK', src: 'none' }
}
