/**
 * Wikitext parsing of English Wikipedia club-season articles (CC BY-SA 4.0).
 * Only facts are read: who was in the squad, league appearances (starts and
 * substitute appearances), league goals, dated transfers and the scorers of
 * each league match. No article text is kept.
 *
 * Ported from the research prototype (02-squads.mjs and seasonfacts.mjs).
 * Pure functions over a string; no I/O.
 */

// ------------------------------------------------------------------ wikitext helpers
export function cleanWiki(t) {
  return t.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
}
const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
export function links(s) {
  const out = []
  for (const m of String(s).matchAll(LINK)) {
    const tgt = m[1].trim()
    if (/^(file|image|category|wikt|w):/i.test(tgt)) continue
    out.push({ title: tgt[0].toUpperCase() + tgt.slice(1).replace(/_/g, ' '), text: (m[2] ?? m[1]).trim() })
  }
  return out
}
export function splitTop(s) {
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2)
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue }
    if (two === '}}' || two === ']]') { depth--; cur += two; i++; continue }
    if (s[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += s[i]
  }
  parts.push(cur)
  return parts
}
/** Yield {name, positional[], named{}} for every template whose name matches re. */
export function* templates(t, nameRe) {
  const re = new RegExp(`\\{\\{\\s*(${nameRe})\\s*(\\||\\}\\})`, 'gi')
  for (const m of t.matchAll(re)) {
    let i = m.index + 2
    let depth = 1
    let j = i
    while (j < t.length && depth) {
      if (t.startsWith('{{', j)) { depth++; j += 2 } else if (t.startsWith('}}', j)) { depth--; j += 2 } else j++
    }
    const parts = splitTop(t.slice(i, j - 2))
    const named = {}
    const positional = []
    for (const p of parts.slice(1)) {
      const mm = p.match(/^\s*([\w ]+?)\s*=([\s\S]*)$/)
      if (mm) named[mm[1].toLowerCase()] = mm[2].trim()
      else positional.push(p.trim())
    }
    yield { name: m[1], named, positional, raw: t.slice(m.index, j) }
  }
}


// ------------------------------------------------------------------ squads and the appearances table
function cellValue(raw) {
  // strip attributes ("align=center|9"), bold, html, small templates; keep links
  const parts = splitTop(raw)
  let c = parts.length > 1 && /=/.test(parts[0]) && !/\[\[|\{\{/.test(parts[0]) ? parts.slice(1).join('|') : raw
  return c.trim()
}
const NUM = /^(-?\d+)?\s*(?:\(\s*(\d+)\s*\)|\+\s*(\d+))?$/
/** {{sort|key|shown}} -> shown (sortable tables hide the number a reader sees inside it). */
const unsort = (c) => String(c).replace(/\{\{\s*sort\s*\|[^|}]*\|([^{}]*)\}\}/gi, '$1')
function parseNum(c) {
  const s = unsort(c).replace(/'''?|<[^>]+>|\{\{(?:dagger|sort|nts|abbr|0)(?:\|[^}]*)?\}\}/gi, '').replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/&nbsp;/g, ' ').trim()
  if (s === '' || /^[-–—]$/.test(s)) return { starts: 0, subs: 0, apps: 0, empty: true }
  const m = s.match(NUM)
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null
  const a = Math.max(0, Number(m[1] ?? 0)) // keepers' goals cells sometimes hold goals conceded as a negative
  const b = Number(m[2] ?? m[3] ?? 0)
  return { starts: a, subs: b, apps: a + b, split: m[2] !== undefined || m[3] !== undefined }
}
const stripFlags = (s) => s.replace(/\{\{\s*(flag|fb|flagicon|flagu|flagathlete|fbicon)[^}]*\}\}/gi, '')
// {{sortname|First|Last|Link title}} -> [[Link title|First Last]]
const sortname = (s) => s.replace(/\{\{\s*sortname\s*\|([^|}]*)\|([^|}]*)(?:\|([^|}]*))?[^}]*\}\}/gi, (_, f, l, link) => `[[${(link && !/=/.test(link) ? link : `${f} ${l}`).trim()}|${f.trim()} ${l.trim()}]]`)

// The position cell of a squad or stats table: "GK", {{tooltip|GK|...}}, {{sort|01|GK}} or a link such as [[Defender (association football)|RB]]
const POS_CODE = { GOALKEEPER: 'GK', DEFENDER: 'DF', MIDFIELDER: 'MF', FORWARD: 'FW', STRIKER: 'FW', WINGER: 'MF', GK: 'GK', DF: 'DF', CB: 'DF', LB: 'DF', RB: 'DF', FB: 'DF', SW: 'DF', LWB: 'DF', RWB: 'DF', MF: 'MF', CM: 'MF', DM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF', W: 'MF', LW: 'MF', RW: 'MF', FW: 'FW', ST: 'FW', CF: 'FW', SS: 'FW' }
function posOf(c) {
  const t = unsort(c).replace(/\{\{tooltip\|(\w+)\|[^}]*\}\}/i, '$1').replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').trim()
  return POS_CODE[t.toUpperCase()] ?? null
}

function tableRows(text) {
  const out = []
  // flat scan: every "{|" opens a table, "|}" closes it (an unclosed table is cut at the next "{|")
  const lines = text.split('\n')
  const tablesText = []
  let buf = null
  for (const line of lines) {
    const t = line.trim()
    // a table opens with "{|" or with a template that writes the header row ({{football season player stats}})
    if (t.startsWith('{|') || /^\{\{\s*football season player stats/i.test(t)) { if (buf) tablesText.push(buf.join('\n')); buf = [] }
    if (buf) buf.push(line)
    if (t.startsWith('|}') && buf) { tablesText.push(buf.join('\n')); buf = null }
  }
  if (buf) tablesText.push(buf.join('\n'))
  for (const [ti, tb] of tablesText.entries()) {
    const rows = []
    for (const chunk of tb.split(/^\s*\|-.*$/m)) {
      const cells = []
      for (let line of chunk.split('\n')) {
        line = line.trim()
        if (!line || !'|!'.includes(line[0]) || line.startsWith('{|') || line.startsWith('|}') || line.startsWith('|+')) continue
        line = line.replace(/^[|!]{1,2}/, '')
        for (const c of line.split(/\|\||!!/)) cells.push(cellValue(c))
      }
      const pi = cells.findIndex((c) => links(stripFlags(c)).length > 0)
      if (pi < 0) continue
      const L = links(stripFlags(cells[pi]))[0]
      const flag = cells.join(' ').match(/\{\{\s*(?:flagicon|flagu|flag|fb|flagathlete)\s*\|\s*([A-Z]{3})\b/)
      const pos = cells.slice(0, pi + 3).map(posOf).find(Boolean) ?? null
      rows.push({ title: L.title, text: L.text, nat: flag?.[1] ?? null, pos, nums: cells.slice(pi + 1).map(parseNum) })
    }
    out.push({ index: ti, rows })
  }
  return out
}

/**
 * The appearances and goals columns of a table that pass both checks, or null.
 * Modes: 'apps' (one cell, "30" or "30 (2)" read as 30 starts and 2 off the
 * bench), 'total' (one cell, "32 (2)" read as 32 appearances of which 2 off
 * the bench), 'startsSubs' (two cells). With `goals` off, a table that gives
 * appearances only is accepted on the apps check alone (`j` is -1).
 */
function choose(candRows, games, gf, maxPerGame, { goals = true } = {}) {
  let best = null
  const width = Math.max(0, ...candRows.map((r) => r.nums.length))
  const appsOf = (mode, a, b) => (mode === 'startsSubs' ? a.starts + b.starts : mode === 'total' ? a.starts : a.apps)
  for (let i = 0; i < width; i++) {
    for (const mode of ['apps', 'total', 'startsSubs']) {
      for (let j = goals ? i + 1 : -1; goals ? j <= i + 6 && j < width : j === -1; j++) {
        if (mode === 'startsSubs' && goals && j < i + 2) continue
        let appsSum = 0, goalsSum = 0, maxApps = 0, ok = 0, bad = 0, split = 0, startsSum = 0, subsSum = 0
        for (const r of candRows) {
          const a = r.nums[i], b = mode === 'startsSubs' ? r.nums[i + 1] : null, g = goals ? r.nums[j] : { apps: 0 }
          if (!a || !g || (mode === 'startsSubs' && !b) || (mode === 'total' && a.subs > a.starts)) { bad++; continue }
          const apps = appsOf(mode, a, b)
          if (a.split) split++
          if (mode === 'startsSubs') { startsSum += a.starts; subsSum += b.starts }
          appsSum += apps; goalsSum += g.apps; maxApps = Math.max(maxApps, apps); ok++
        }
        if (process.env.DEBUG && ok >= 14) console.log('    cand', i, j, mode, 'ok', ok, 'bad', bad, 'apps', appsSum, 'max', maxApps, 'goals', goalsSum)
        if (ok < 14 || bad > ok * 0.25) continue
        if (mode === 'total' && split === 0) continue
        // a starts column outweighs the substitutes column beside it (else it is another competition's goals and apps)
        if (mode === 'startsSubs' && !(startsSum > 2 * subsSum)) continue
        const perGame = appsSum / games
        if (perGame < 10.8 || perGame > maxPerGame || maxApps > games) continue
        if (goals && (goalsSum > gf || goalsSum < gf - 5)) continue
        // league columns come first in these tables: a column further right costs as much as a goal off the target
        const score = (goals ? Math.abs(goalsSum - (gf - 1.5)) : 0) + Math.abs(perGame - 12) * 0.3 + i + (goals ? (j - i - 1) * 0.5 : 0) + (mode === 'apps' ? 0 : 0.01)
        if (!best || score < best.score) best = { i, j, mode, appsSum, goalsSum: goals ? goalsSum : null, score }
      }
    }
  }
  return best
}

function parseArticle(text, games, gf, maxPerGame) {
  const t = sortname(cleanWiki(text))
  const players = new Map()
  const get = (title, name) => {
    if (!players.has(title)) players.set(title, { title, name, pos: null, nat: null, inList: false, inStats: false, apps: null, starts: null, subs: null, goals: null, note: null })
    return players.get(title)
  }
  // squad lists
  for (const tp of templates(t, 'Fs player|Football squad player|Fs2 player|Football squad player2|Fs player2')) {
    const L = links(tp.named.name ?? '')[0]
    if (!L) continue
    const p = get(L.title, L.text)
    p.inList = true
    p.pos ??= tp.named.pos ?? null
    p.nat ??= tp.named.nat ?? null
    if (tp.named.other) p.note = tp.named.other.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  }
  // Efs rows: positional league apps|goals first
  const efs = []
  for (const tp of templates(t, 'Efs player|Fs player stat')) {
    const L = links(tp.named.name ?? '')[0]
    if (!L) continue
    efs.push({ title: L.title, text: L.text, pos: tp.named.pos, nat: tp.named.nat, nums: tp.positional.map(parseNum) })
  }
  const candidates = []
  if (efs.length) candidates.push({ kind: 'efs', rows: efs })
  for (const tb of tableRows(t)) if (tb.rows.length >= 14) candidates.push({ kind: 'table#' + tb.index, rows: tb.rows })
  let pick = null
  for (const c of candidates) {
    // dedupe rows by title (some tables repeat players)
    const seen = new Map()
    for (const r of c.rows) if (!seen.has(r.title)) seen.set(r.title, r)
    const rows = [...seen.values()]
    const b = choose(rows, games, gf, maxPerGame)
    if (b && (!pick || b.score < pick.score)) pick = { ...b, kind: c.kind, rows }
  }
  // An appearances-only table (no goals column) counts too; the league scorer lines then give the goals
  if (!pick) for (const c of candidates) {
    const seen = new Map()
    for (const r of c.rows) if (!seen.has(r.title)) seen.set(r.title, r)
    const rows = [...seen.values()]
    const b = choose(rows, games, gf, maxPerGame, { goals: false })
    if (b && (!pick || b.score < pick.score)) pick = { ...b, kind: c.kind, rows, appsOnly: true }
  }
  // No squad-list template: a hand-made squad table (a link and a position on most rows) is the squad list
  if (![...players.values()].some((p) => p.inList)) {
    const squadTable = candidates.filter((c) => c.kind !== 'efs' && c.rows.filter((r) => r.pos).length >= 0.6 * c.rows.length).sort((a, b) => b.rows.length - a.rows.length)[0]
    for (const r of squadTable?.rows ?? []) {
      if (!r.pos) continue
      const p = get(r.title, r.text)
      p.inList = true
      p.pos ??= r.pos
      p.nat ??= r.nat
    }
  }
  if (pick) {
    for (const r of pick.rows) {
      const a = r.nums[pick.i], g = pick.appsOnly ? { apps: null } : r.nums[pick.j]
      if (!a || !g) continue
      const p = get(r.title, r.text)
      p.inStats = true
      if (pick.mode === 'startsSubs') { const s = r.nums[pick.i + 1]; p.starts = a.starts; p.subs = s.starts; p.apps = a.starts + s.starts }
      else if (pick.mode === 'total' && a.subs <= a.starts) { p.apps = a.starts; p.subs = a.subs; p.starts = a.starts - a.subs }
      else { p.apps = a.apps; if (a.split) { p.starts = a.starts; p.subs = a.subs } }
      p.goals = g.apps
      p.pos ??= r.pos ?? null
      p.nat ??= r.nat ?? null
    }
  }
  return { players: [...players.values()], stats: pick ? { kind: pick.kind, mode: pick.mode, appsCol: pick.i, goalsCol: pick.j, appsSum: pick.appsSum, goalsSum: pick.goalsSum, ...(pick.appsOnly ? { appsOnly: true } : {}) } : null, candidates: candidates.map((c) => `${c.kind}:${c.rows.length}`) }
}

// ------------------------------------------------------------------ league scorers and dated transfers
const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 }
const DATE_RE = /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
export function parseDate(s) {
  const m = String(s ?? '').match(DATE_RE)
  if (!m) return null
  return Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]))
}
export function startDate(s) {
  const m = String(s ?? '').match(/\{\{\s*start date\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
/** Share of the league season (mid-August to early May) that lies before date d. */
export function seasonFraction(d, S) {
  const a = Date.UTC(S, 7, 14), b = Date.UTC(S + 1, 4, 9)
  return Math.min(1, Math.max(0, (d - a) / (b - a)))
}

function sections(text) {
  // [{title, level, body}] for every == heading ==; nested sections are included in their parents' bodies too
  const lines = text.split('\n')
  const heads = []
  lines.forEach((l, i) => { const m = l.match(/^(={2,6})\s*(.*?)\s*\1\s*$/); if (m) heads.push({ i, level: m[1].length, title: m[2] }) })
  return heads.map((h, k) => {
    let end = lines.length
    for (let j = k + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].i; break }
    return { title: h.title, level: h.level, body: lines.slice(h.i + 1, end).join('\n') }
  })
}
const isLeagueHeading = (t) => /premier ?league|premiership|^league$|league (matches|results|fixtures)|^league\b|division/i.test(t) && !/cup|charity|shield|table|summary|position|standings|statistic|scorer|squad|appearance/i.test(t)

/** Goals credited after each player link in a scorer string. Own goals are skipped. */
function scorers(cell, requireMarker = false) {
  const out = []
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g
  const ms = [...String(cell).matchAll(re)]
  ms.forEach((m, k) => {
    const title = m[1].trim()
    if (/^(file|image|category)/i.test(title)) return
    const tail = String(cell).slice(m.index + m[0].length, k + 1 < ms.length ? ms[k + 1].index : undefined)
    const head = tail.split(/,|<br|\[\[/)[0]
    if (!/\{\{\s*goal/i.test(head) && /o\.\s?g\.|own goal|\bog\b/i.test(head)) return
    const goalTpl = head.match(/\{\{\s*goal\s*\|([^}]*)\}\}/i) ?? (tail.split('[[')[0].match(/\{\{\s*goal\s*\|([^}]*)\}\}/i))
    if (/\{\{\s*(yel|sent off|red|yellow|suba|subon|suboff)/i.test(head) && !goalTpl) return
    let n = 1
    const paren = tail.match(/^\s*\(\s*(\d+)/)
    const mins = tail.split(/\[\[/)[0].match(/\d{1,3}(?:\+\d)?\s*'/g)
    if (goalTpl) {
      const parts = goalTpl[1].split('|')
      let c = 0
      for (let i = 0; i < parts.length; i += 2) if (/^\s*\d{1,3}(\+\d+)?\s*$/.test(parts[i]) && !/o\.?g/i.test(parts[i + 1] ?? '')) c++
      n = c
    } else if (paren) n = Number(paren[1])
    else if (mins && mins.length > 1) n = mins.length
    else if (requireMarker && !mins) n = 0
    if (n > 0) out.push({ title: title[0].toUpperCase() + title.slice(1).replace(/_/g, ' '), n })
  })
  return out
}

export function seasonFacts(raw, { S, games, gf, isOurs }) {
  const text = cleanWiki(raw)
  const secs = sections(text)
  const leagueSecs = secs.filter((s) => isLeagueHeading(s.title))
  // pick the smallest league section that holds about `games` result rows
  let best = null
  for (const sec of [...leagueSecs, { title: '(whole article)', body: text }]) for (const strict of [true, false]) {
    const rows = []
    // style A: wikitable rows that start with a date (cells on one line with || or one per line); the scorers
    // are the linked cells after the score cell
    for (const chunk of sec.body.split(/^\s*\|-.*$/m)) {
      const cells = []
      for (let line of chunk.split('\n')) {
        line = line.trim()
        if (!line || line[0] !== '|' || line.startsWith('|}') || line.startsWith('|+') || line.startsWith('{|')) continue
        for (const c of line.replace(/^\|{1,2}/, '').split('||')) cells.push(c.replace(/^\s*(?:style|align|bgcolor|class)\s*=\s*"[^"]*"\s*\|/i, '').trim())
      }
      if (!cells.length) continue
      const date = parseDate(cells[0]) ?? startDate(cells[0])
      if (date == null) continue
      const si = cells.findIndex((c, i) => i > 0 && /^(?:\[[^\s\]]+\s+)?\d+\s*[–-]\s*\d+\]?$/.test(c.replace(/'''?|<[^>]+>/g, '').trim()))
      if (si < 0) continue
      const sc = cells.slice(si + 1).filter((c) => /\[\[/.test(c)).join(', ')
      rows.push({ date, goals: scorers(sc) })
    }
    // style B: football box templates, our side's goals (strict: a {{goal}} or minute marker is required)
    for (const tp of templates(sec.body, 'football box collapsible|Football box collapsible|footballbox collapsible|Footballbox collapsible|football box|Football box|footballbox|Footballbox')) {
      const n = tp.named
      const t1 = isOurs(n.team1 ?? ''), t2 = isOurs(n.team2 ?? '')
      if (t1 === t2) continue
      if (sec.title === '(whole article)' && n.round && !/^\s*(matchday|round)?\s*\d+\s*$/i.test(n.round)) continue
      rows.push({ date: parseDate(n.date) ?? startDate(n.date), goals: scorers(t1 ? n.goals1 ?? '' : n.goals2 ?? '', strict) })
    }
    if (!rows.length) continue
    const goalsSum = rows.reduce((s, r) => s + r.goals.reduce((a, g) => a + g.n, 0), 0)
    const ok = Math.abs(rows.length - games) <= 1 && goalsSum <= gf && goalsSum >= gf - 6
    const cand = { section: sec.title, rows: rows.length, goalsSum, ok, list: rows, len: sec.body.length, gap: Math.abs(gf - 1 - goalsSum) }
    if (!best || (ok && !best.ok) || (ok === best.ok && (cand.gap < best.gap || (cand.gap === best.gap && cand.len < best.len)))) best = cand
  }
  const goals = new Map(), first = new Map(), last = new Map()
  if (best?.ok) for (const r of best.list) for (const g of r.goals) {
    goals.set(g.title, (goals.get(g.title) ?? 0) + g.n)
    if (r.date != null) { if (!first.has(g.title) || r.date < first.get(g.title)) first.set(g.title, r.date); if (!last.has(g.title) || r.date > last.get(g.title)) last.set(g.title, r.date) }
  }
  // dated transfer lines: a table row with a date in the season window, the player link and at least one other link
  const transfers = []
  const lo = Date.UTC(S, 4, 1), hi = Date.UTC(S + 1, 5, 30)
  for (const line of text.split('\n')) {
    if (/^\s*\*/.test(line) && !/football ?box|goals[12]\s*=/i.test(line)) {
      // bullet lists: "* [[Kevin Gallacher]] - [[Coventry City F.C.|Coventry City]], March, £1,500,000"
      const mo = line.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i)
      const L = links(line).filter((l) => !/^(file|image)/i.test(l.title))
      if (mo && L.length >= 2 && L.length <= 6) {
        const mi = MONTHS[mo[1].toLowerCase()]
        const d0 = parseDate(line)
        transfers.push({ date: d0 ?? Date.UTC(mi >= 6 ? S : S + 1, mi, 15), titles: L.map((l) => l.title), line: line.slice(0, 200), approx: d0 == null })
      }
      continue
    }
    if (!/^\s*[|!]/.test(line) || /football ?box|goals[12]\s*=/i.test(line)) continue
    if (/\|\|\s*[HAN]\s*\|\||\d\s*[–-]\s*\d|attendance/i.test(line)) continue // a result row, not a transfer
    const d = parseDate(line)
    if (d == null || d < lo || d > hi) continue
    const L = links(line)
    if (L.length < 2 || L.length > 6) continue
    transfers.push({ date: d, titles: L.map((l) => l.title), line: line.slice(0, 200) })
  }
  return { results: best ? { section: best.section, rows: best.rows, goalsSum: best.goalsSum, ok: best.ok } : null, goals, first, last, transfers }
}

// ------------------------------------------------------------------ one article
/**
 * Everything the import reads from one club-season article.
 *   row     the club's line of the final table ({ played, gf })
 *   isOurs  tells whether a team name or link is this club (for football boxes)
 * `players` holds the squad list and the chosen appearances table; `stats` is
 * null when no table passes both checks (apps 10.8x to (11 + subs)x games, and
 * goals within GF-6..GF). `results` says whether the league scorer lines add
 * up (`ok`); `goals`, `first` and `last` are keyed by link title.
 */
export function parseSeasonArticle(text, { season, row, isOurs = () => false }) {
  // 11 starters plus the substitutes allowed: two until 1994-95, three (one a keeper until 1996) after
  const games = row?.played ?? 38
  const gf = row?.gf ?? 0
  const squads = parseArticle(text, games, gf, 11 + (season >= 1995 ? 3 : 2) + 0.05)
  const facts = seasonFacts(text, { S: season, games, gf, isOurs })
  return { ...squads, ...facts }
}

/** Every player title an article links from its squad list, stats table or league scorers. */
export function linkedTitles(parsed) {
  const out = new Set(parsed.players.map((p) => p.title))
  for (const t of parsed.goals.keys()) out.add(t)
  return [...out].filter((t) => !/^(file|image|category|wikt|w|wikipedia|template|help):/i.test(t))
}
