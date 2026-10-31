import type { AlltimeOrder, AlltimeRow, BoardRow, CasualKind, CasualRow, ChaseRow, RankedKind } from '../../online/boards'

/**
 * Quiet public boards are padded in the browser so every board has a useful table while the audience grows.
 * These rows are never written to Supabase and disappear one by one as verified rows fill the table.
 */
export type ExhibitionRow<T> = T & { exhibition: true }

interface ExhibitionManager {
  name: string
  country: string
  team: string
}

const MANAGERS: readonly ExhibitionManager[] = [
  { name: 'Jamie Carter', country: 'GB', team: 'Northbridge FC' },
  { name: 'Sofia Reyes', country: 'ES', team: 'Puerto Athletic' },
  { name: 'Lukas Weber', country: 'DE', team: 'Rheinland 04' },
  { name: 'Marco Bianchi', country: 'IT', team: 'Sporting Verona' },
  { name: 'Daan de Wit', country: 'NL', team: 'Oranje City' },
  { name: 'Camille Laurent', country: 'FR', team: 'Racing Lumiere' },
  { name: 'Riley Hayes', country: 'AU', team: 'Harbour United' },
  { name: 'Rafael Costa', country: 'BR', team: 'Estrela FC' },
  { name: 'Youssef Amrani', country: 'MA', team: 'Atlas Sporting' },
  { name: 'Haru Sato', country: 'JP', team: 'Sakura Eleven' },
  { name: 'Avery Clarke', country: 'CA', team: 'Maple Rovers' },
  { name: 'Tiago Martins', country: 'PT', team: 'Lusitania SC' },
] as const

export const BOARD_SIZE = 12

const positionAfter = (rows: readonly { position: number }[]) => Math.max(rows.length, ...rows.map((r) => r.position), 0) + 1

function fill<T extends { position: number }>(real: readonly T[], make: (manager: ExhibitionManager, index: number, position: number) => T): Array<T | ExhibitionRow<T>> {
  if (real.length >= BOARD_SIZE) return [...real]
  const firstPosition = positionAfter(real)
  const added = MANAGERS.slice(0, BOARD_SIZE - real.length).map((manager, index) => ({ ...make(manager, index, firstPosition + index), exhibition: true }) as ExhibitionRow<T>)
  return [...real, ...added]
}

const countryOf = (manager: ExhibitionManager, country: string | null) => country ?? manager.country
const recordFor = (points: number, games: number) => {
  const won = Math.min(games, Math.floor(points / 3))
  const drawn = Math.min(games - won, Math.max(0, points - won * 3))
  return { won, drawn, lost: Math.max(0, games - won - drawn) }
}
const tierFor = (points: number) => (points >= 95 ? 'CHAMPIONS' : points >= 78 ? 'TITLE_RACE' : points >= 65 ? 'EUROPEAN' : 'MID_TABLE')

/** Today's Daily and the fixed weekly puzzle. Verified rows stay first and retain their official positions. */
export function fillRankedBoard(real: readonly BoardRow[], kind: RankedKind, country: string | null): Array<BoardRow | ExhibitionRow<BoardRow>> {
  const lastPoints = real.at(-1)?.points
  return fill(real, (manager, index, position) => {
    const points = Math.max(3, lastPoints === undefined ? 88 - index * 3 - (kind === 'weekly' ? 1 : 0) : lastPoints - (index + 1) * 2)
    const record = recordFor(points, 38)
    const goalsFor = Math.max(28, 82 - index * 3)
    const goalsAgainst = Math.max(18, 37 + index * 2)
    return {
      position,
      name: manager.name,
      country: countryOf(manager, country),
      team: manager.team,
      points,
      ...record,
      goalsFor,
      goalsAgainst,
      goalDiff: goalsFor - goalsAgainst,
      leaguePosition: Math.min(20, index + 1),
      tier: tierFor(points),
      createdAt: '2026-10-31T12:00:00.000Z',
      isMe: false,
      revealed: false,
      payload: null,
    }
  })
}

/** All-time totals, ordered consistently with the selected view. */
export function fillAlltimeBoard(real: readonly AlltimeRow[], order: AlltimeOrder, country: string | null): Array<AlltimeRow | ExhibitionRow<AlltimeRow>> {
  const last = real.at(-1)
  return fill(real, (manager, index, position) => {
    const totalPoints = Math.max(1, last ? last.totalPoints - (index + 1) * 3 : 1_520 - index * 64)
    const played = Math.max(1, Math.min(20, Math.floor(totalPoints / 72)))
    const bestStreak = Math.max(0, last && order === 'streak' ? last.bestStreak - Math.ceil((index + 1) / 2) : 12 - Math.floor(index / 2))
    return {
      position,
      name: manager.name,
      country: countryOf(manager, country),
      totalPoints,
      played,
      average: Math.round(totalPoints / played),
      bestStreak,
      currentStreak: Math.min(bestStreak, Math.max(0, 7 - (index % 7))),
      lastDate: '2026-10-31',
      isMe: false,
    }
  })
}

/** The weekly and all-time 38–0 chase tables. */
export function fillChaseBoard(real: readonly ChaseRow[], country: string | null): Array<ChaseRow | ExhibitionRow<ChaseRow>> {
  const lastPoints = real.at(-1)?.points
  return fill(real, (manager, index, position) => {
    const points = Math.max(3, lastPoints === undefined ? 114 - index * 3 : lastPoints - (index + 1) * 2)
    const record = recordFor(points, 38)
    const goalsFor = Math.max(38, 104 - index * 4)
    const goalsAgainst = Math.max(15, 24 + index * 2)
    return {
      position,
      name: manager.name,
      country: countryOf(manager, country),
      team: manager.team,
      leagueId: 'england',
      games: 38,
      points,
      ...record,
      goalsFor,
      goalsAgainst,
      goalDiff: goalsFor - goalsAgainst,
      dropped: 114 - points,
      perfect: record.won === 38,
      leaguePosition: 1,
      tier: tierFor(points),
      createdAt: '2026-10-31T12:00:00.000Z',
      isMe: false,
      payload: null,
      ratings: 'prime',
      benchPicks: index % 4,
    }
  })
}

/** Daily Arena, themed Weekly Challenge and Run-in of the week. */
export function fillCasualBoard(real: readonly CasualRow[], board: CasualKind, country: string | null): Array<CasualRow | ExhibitionRow<CasualRow>> {
  const lastScore = real.at(-1)?.score
  return fill(real, (manager, index, position) => {
    const arena = board === 'arena'
    const runin = board === 'runin'
    const games = arena ? 9 : runin ? 10 : 38
    const score = Math.max(1, lastScore === undefined ? (arena ? 9 - Math.floor(index / 2) : runin ? 25 - index : 86 - index * 3) : lastScore - Math.ceil((index + 1) / (arena ? 2 : 1)))
    const record = arena ? { won: score, drawn: 0, lost: score >= 9 ? 0 : 1 } : recordFor(score, games)
    const goalsFor = Math.max(8, (arena ? 24 : runin ? 22 : 78) - index * 2)
    const goalsAgainst = Math.max(5, (arena ? 9 : runin ? 12 : 35) + index)
    const trophy = position === 1 || (arena && score >= 9)
    return {
      position,
      name: manager.name,
      country: countryOf(manager, country),
      team: manager.team,
      score,
      ...record,
      goalsFor,
      goalsAgainst,
      goalDiff: goalsFor - goalsAgainst,
      leaguePosition: arena ? null : Math.min(20, index + 1),
      trophy,
      detail: arena ? (trophy ? 'Gauntlet winners' : `${score} rungs`) : runin ? (trophy ? 'BRIEF MET' : 'SURVIVED') : tierFor(score),
      createdAt: '2026-10-31T12:00:00.000Z',
      isMe: false,
      revealed: false,
      payload: null,
    }
  })
}

export function isExhibitionRow(row: object): boolean {
  return 'exhibition' in row && row.exhibition === true
}
