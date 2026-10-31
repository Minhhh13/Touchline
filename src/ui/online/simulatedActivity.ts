import type { AlltimeOrder, AlltimeRow } from '../../online/boards'

/**
 * Quiet public boards get a small, explicitly labelled AI exhibition. These rows never go to Supabase and never
 * change a real manager's official position; they disappear one by one as real rows fill the table.
 */
export interface SimulatedAlltimeRow extends AlltimeRow {
  simulated: true
}

interface SimulatedManager {
  name: string
  country: string
  played: number
  average: number
  bestStreak: number
  currentStreak: number
}

const MANAGERS: readonly SimulatedManager[] = [
  { name: 'Pressing AI', country: 'GB', played: 18, average: 75, bestStreak: 9, currentStreak: 5 },
  { name: 'Tiki-Taka AI', country: 'ES', played: 17, average: 76, bestStreak: 8, currentStreak: 3 },
  { name: 'Gegenpress AI', country: 'DE', played: 16, average: 74, bestStreak: 7, currentStreak: 7 },
  { name: 'Catenaccio AI', country: 'IT', played: 15, average: 73, bestStreak: 8, currentStreak: 2 },
  { name: 'Total Football AI', country: 'NL', played: 14, average: 77, bestStreak: 6, currentStreak: 4 },
  { name: 'Counter Attack AI', country: 'FR', played: 13, average: 72, bestStreak: 6, currentStreak: 1 },
  { name: 'Touchline Bot', country: 'AU', played: 12, average: 75, bestStreak: 5, currentStreak: 5 },
  { name: 'Samba Sim', country: 'BR', played: 11, average: 78, bestStreak: 7, currentStreak: 3 },
  { name: 'Atlas Bot', country: 'MA', played: 10, average: 71, bestStreak: 4, currentStreak: 2 },
  { name: 'Samurai Sim', country: 'JP', played: 9, average: 74, bestStreak: 5, currentStreak: 1 },
  { name: 'Maple AI', country: 'CA', played: 8, average: 73, bestStreak: 4, currentStreak: 4 },
  { name: 'Selecao Sim', country: 'PT', played: 7, average: 76, bestStreak: 3, currentStreak: 2 },
] as const

const BOARD_SIZE = 12
export const SIMULATION_EPOCH = Date.UTC(2026, 9, 31, 0, 0, 0)
export const SIMULATION_BASE = 38_000
const SIMULATION_STEP_MS = 2_400

/** A deterministic display counter: the same wall-clock instant gives every device the same figure. */
export function simulatedGamesAt(now = Date.now()): number {
  return SIMULATION_BASE + Math.floor(Math.max(0, now - SIMULATION_EPOCH) / SIMULATION_STEP_MS)
}

function rowsFor(country: string | null): SimulatedAlltimeRow[] {
  return MANAGERS.filter((m) => !country || m.country === country).map((m) => ({
    position: 0,
    name: m.name,
    country: m.country,
    totalPoints: m.played * m.average,
    played: m.played,
    average: m.average,
    bestStreak: m.bestStreak,
    currentStreak: m.currentStreak,
    lastDate: '2026-10-31',
    isMe: false,
    simulated: true,
  }))
}

/** Real rows stay first with their official ranks. AI rows only fill the unused display places below them. */
export function fillAlltimeBoard(real: readonly AlltimeRow[], order: AlltimeOrder, country: string | null): Array<AlltimeRow | SimulatedAlltimeRow> {
  if (real.length >= BOARD_SIZE) return [...real]
  const simulated = rowsFor(country)
    .sort((a, b) => (order === 'points' ? b.totalPoints - a.totalPoints || b.bestStreak - a.bestStreak : b.bestStreak - a.bestStreak || b.totalPoints - a.totalPoints))
    .slice(0, BOARD_SIZE - real.length)
    .map((row, i) => ({ ...row, position: real.length + i + 1 }))
  return [...real, ...simulated]
}

export function isSimulatedAlltimeRow(row: AlltimeRow | SimulatedAlltimeRow): row is SimulatedAlltimeRow {
  return 'simulated' in row && row.simulated === true
}
