/**
 * Parse openfootball match result text files into league tables.
 *
 * File format (several variants over the years):
 *   ▪ Matchday 1
 *   Sat Aug 16 2014
 *     12:45  Manchester United        1-2 (0-1)  Swansea City
 *            Leicester City           2-2 (1-2)  Everton FC
 *   or (newer):
 *     20:00  Arsenal FC              v Coventry City FC         3-0 (2-0)
 */
import { clubIdFor } from './clubs-england.mjs'

const SCORE = /(\d+)-(\d+)(?:\s*\((\d+)-(\d+)\))?/

export function parseResults(text) {
  const matches = []
  const unknown = new Set()
  let matchday = 0
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const md = line.match(/^(?:▪|»|\[)?\s*(?:Matchday|Round|Regular Season -)\s*(\d+)/i)
    if (md) {
      matchday = Number(md[1])
      continue
    }
    if (!line.trim() || line.startsWith('#') || line.startsWith('=') || line.trim().startsWith('(')) continue
    // Strip leading time
    let body = line.replace(/^\s*\d{1,2}[.:]\d{2}\s+/, '').replace(/^\s+/, '')
    if (!SCORE.test(body)) continue
    // Variant A: "Home  1-2 (0-1)  Away"
    // Variant B: "Home  v  Away  1-2 (0-1)"
    let home, away, hg, ag
    const vSplit = body.split(/\s+v\s+/)
    if (vSplit.length === 2 && SCORE.test(vSplit[1]) && !SCORE.test(vSplit[0])) {
      home = vSplit[0].trim()
      const m = vSplit[1].match(SCORE)
      away = vSplit[1].slice(0, m.index).trim()
      hg = Number(m[1])
      ag = Number(m[2])
    } else {
      const m = body.match(SCORE)
      home = body.slice(0, m.index).trim()
      away = body.slice(m.index + m[0].length).trim()
      hg = Number(m[1])
      ag = Number(m[2])
    }
    // Some lines carry a trailing comment or extra time marker. Trim bracket remainders.
    away = away.replace(/\s*\[.*$/, '').replace(/\s{2,}.*$/, '').trim()
    home = home.replace(/\s{2,}.*$/, '').trim()
    const h = clubIdFor(home)
    const a = clubIdFor(away)
    if (!h) unknown.add(home)
    if (!a) unknown.add(away)
    if (!h || !a) continue
    matches.push({ matchday, home: h, away: a, hg, ag })
  }
  return { matches, unknown: [...unknown] }
}

export function buildTable(matches) {
  const rows = new Map()
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { clubId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 })
    return rows.get(id)
  }
  for (const m of matches) {
    const h = row(m.home)
    const a = row(m.away)
    h.played++
    a.played++
    h.gf += m.hg
    h.ga += m.ag
    a.gf += m.ag
    a.ga += m.hg
    if (m.hg > m.ag) {
      h.won++
      a.lost++
      h.pts += 3
    } else if (m.hg < m.ag) {
      a.won++
      h.lost++
      a.pts += 3
    } else {
      h.drawn++
      a.drawn++
      h.pts++
      a.pts++
    }
  }
  const table = [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.clubId.localeCompare(y.clubId))
  table.forEach((r, i) => (r.position = i + 1))
  return table
}
