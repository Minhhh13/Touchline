import type { PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'

/**
 * Explore's indexes over the loaded player-seasons (display only, pure, no RNG): built once per universe and kept in
 * WeakMaps, so a search, a career or a top list never walks all 78,000 player-seasons twice. The store builds a new
 * universe whenever a league or the classic pack loads, which drops these with it.
 */

/** Lower case with the accents dropped: "Guéhi" and "guehi" match, "Ødegaard" reads "odegaard". */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/gi, 'l')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

/** One real player: his seasons oldest first, his names folded for search, the span and clubs of his career. */
export interface PlayerEntry {
  playerId: string
  seasons: PlayerSeason[]
  /** The fullest spelling of his name ("Erling Haaland" over "E. Haaland"). */
  name: string
  folded: string[]
  parts: string[][]
  from: number
  to: number
  seasonCount: number
  /** Every club he played for, in the order he first did. */
  clubs: string[]
  /** His highest-rated season, the earliest of equals. */
  best: PlayerSeason
}

interface Built {
  list: PlayerEntry[]
  byId: Map<string, PlayerEntry>
}

const indexCache = new WeakMap<LoadedUniverse, Built>()

function built(u: LoadedUniverse): Built {
  const hit = indexCache.get(u)
  if (hit) return hit
  const by = new Map<string, PlayerSeason[]>()
  for (const p of Object.values(u.index)) {
    const list = by.get(p.playerId)
    if (list) list.push(p)
    else by.set(p.playerId, [p])
  }
  const list: PlayerEntry[] = []
  for (const [playerId, raw] of by) {
    const seasons = [...raw].sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
    const names = [...new Set(seasons.map((p) => p.name))]
    const folded = names.map(foldName)
    const clubs: string[] = []
    for (const p of seasons) if (!clubs.includes(p.clubId)) clubs.push(p.clubId)
    list.push({
      playerId,
      seasons,
      name: names.reduce((m, n) => (n.length > m.length ? n : m), names[0]),
      folded,
      parts: folded.map((n) => n.split(/[\s.'-]+/)),
      from: seasons[0].season,
      to: seasons[seasons.length - 1].season,
      seasonCount: new Set(seasons.map((p) => p.season)).size,
      clubs,
      best: seasons.reduce((m, p) => (p.overall > m.overall ? p : m), seasons[0]),
    })
  }
  list.sort((a, b) => a.playerId.localeCompare(b.playerId))
  const out = { list, byId: new Map(list.map((e) => [e.playerId, e])) }
  indexCache.set(u, out)
  return out
}

/** One entry per real player, by player id; built once per universe. */
export function playerIndex(u: LoadedUniverse): PlayerEntry[] {
  return built(u).list
}

/** One real player's entry, or undefined when no loaded league holds him. */
export function playerEntry(u: LoadedUniverse, playerId: string): PlayerEntry | undefined {
  return built(u).byId.get(playerId)
}

const ratedCache = new WeakMap<LoadedUniverse, PlayerSeason[]>()

/** Every loaded player-season, best first; equals by the earlier season, then the id, so the order never depends on the packs' order. */
export function byRating(u: LoadedUniverse): PlayerSeason[] {
  const hit = ratedCache.get(u)
  if (hit) return hit
  const all = Object.values(u.index).sort((a, b) => b.overall - a.overall || a.season - b.season || a.id.localeCompare(b.id))
  ratedCache.set(u, all)
  return all
}

/** A typed query as Explore matches it: folded, split on spaces, empty words dropped. */
export function queryWords(query: string): string[] {
  return foldName(query).trim().split(/\s+/).filter(Boolean)
}

/** Whether one of his spellings holds every word. */
export function nameMatches(e: PlayerEntry, words: string[]): boolean {
  return e.folded.some((n) => words.every((w) => n.includes(w)))
}

/** Whether every word starts a part of one of his spellings ("Kane" starts Harry Kane, not Kanté). */
export function nameStarts(e: PlayerEntry, words: string[]): boolean {
  return e.parts.some((parts) => words.every((w) => parts.some((part) => part.startsWith(w))))
}

interface NameText {
  /** Every player's folded spellings, in index order, each ended by a line break (never inside a word). */
  text: string
  /** Where each player's spellings start in `text`. */
  starts: Int32Array
}

const textCache = new WeakMap<LoadedUniverse, NameText>()

function nameText(u: LoadedUniverse): NameText {
  const hit = textCache.get(u)
  if (hit) return hit
  const list = playerIndex(u)
  const starts = new Int32Array(list.length)
  const chunks: string[] = []
  let at = 0
  list.forEach((e, i) => {
    starts[i] = at
    for (const n of e.folded) {
      chunks.push(n, '\n')
      at += n.length + 1
    }
  })
  const out = { text: chunks.join(''), starts }
  textCache.set(u, out)
  return out
}

/** Every player one of whose spellings holds `word` (a word has no spaces, so no match spans two names), in index order. */
function holding(u: LoadedUniverse, word: string): PlayerEntry[] {
  const list = playerIndex(u)
  const { text, starts } = nameText(u)
  const out: PlayerEntry[] = []
  let last = -1
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    // The player whose block holds this offset: the last start at or before it
    let lo = last < 0 ? 0 : last
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= at) lo = mid
      else hi = mid - 1
    }
    if (lo !== last) {
      out.push(list[lo])
      last = lo
    }
  }
  return out
}

/** How many earlier queries each universe keeps: typing one name, and the compare box beside the search. */
const MATCH_KEEP = 8

const matchCache = new WeakMap<LoadedUniverse, Array<{ words: string[]; entries: PlayerEntry[] }>>()

/**
 * Every player whose name holds each word, in index order: the same list a pass over the whole index gives, but a
 * query that narrows an earlier one ("haa" after "ha": each earlier word inside one of the new ones) filters that
 * earlier answer instead, so a keystroke reads a few hundred names rather than 21,000.
 */
export function nameMatchesOf(u: LoadedUniverse, words: string[]): PlayerEntry[] {
  if (!words.length) return playerIndex(u)
  let kept = matchCache.get(u)
  if (!kept) {
    kept = []
    matchCache.set(u, kept)
  }
  const key = words.join(' ')
  const same = kept.findIndex((k) => k.words.join(' ') === key)
  if (same >= 0) {
    const [hit] = kept.splice(same, 1)
    kept.unshift(hit)
    return hit.entries
  }
  // Any earlier query whose every word lies inside a new word admits a superset: the smallest one is the base;
  // without one, the players whose names hold the longest word, found by the engine's own string search
  let base: PlayerEntry[] | null = null
  for (const k of kept) if ((!base || k.entries.length < base.length) && k.words.every((w) => words.some((n) => n.includes(w)))) base = k.entries
  const entries = (base ?? holding(u, words.reduce((m, w) => (w.length > m.length ? w : m), words[0]))).filter((e) => nameMatches(e, words))
  kept.unshift({ words, entries })
  if (kept.length > MATCH_KEEP) kept.length = MATCH_KEEP
  return entries
}

/** Builds the indexes ahead of need (Explore calls it in an idle moment); a second call per universe is free. */
export function warmExplore(u: LoadedUniverse): void {
  playerIndex(u)
  nameText(u)
  byRating(u)
}
