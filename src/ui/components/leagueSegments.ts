import type { LoadedUniverse } from '@engine/universe'
import type { WheelSegment } from './Wheel'

const LEAGUE_COLOURS: Record<string, { colour: string; secondary: string; label: string }> = {
  england: { colour: '#3d195b', secondary: '#ffffff', label: 'ENG' },
  spain: { colour: '#ee8707', secondary: '#ffffff', label: 'ESP' },
  italy: { colour: '#0a3a8c', secondary: '#ffffff', label: 'ITA' },
  germany: { colour: '#d20515', secondary: '#000000', label: 'GER' },
  france: { colour: '#1c2b5f', secondary: '#dfe100', label: 'FRA' },
  netherlands: { colour: '#f36c21', secondary: '#ffffff', label: 'NED' },
  portugal: { colour: '#046a38', secondary: '#da291c', label: 'POR' },
}

/** Wheel segments for a multi-league wheel: one per league, repeated so the wheel still looks busy. */
export function leagueSegments(u: LoadedUniverse, leagueIds: string[]): WheelSegment[] {
  const out: WheelSegment[] = []
  const repeats = Math.max(1, Math.floor(20 / Math.max(1, leagueIds.length)))
  for (let r = 0; r < repeats; r++) {
    for (const id of leagueIds) {
      const c = LEAGUE_COLOURS[id] ?? { colour: '#555', secondary: '#fff', label: (u.leagues.find((l) => l.id === id)?.shortName ?? id).slice(0, 3).toUpperCase() }
      out.push({ id: `league:${id}`, label: c.label, colour: c.colour, secondary: c.secondary })
    }
  }
  return out
}
