import type { QuickScorer } from '@game/types'
import { shortName } from '@game/logic/gameByGame'
import { minuteLabel } from './format'

/**
 * A game's scorers ("Haaland 12', 90+2' · OG 80'"): `scorersLabel` in gameByGame.ts with stoppage time written as the
 * match clock writes it. That file is in the edge verifier bundle, so the display fix lives here.
 */
export function scorersText(scorers: QuickScorer[], options: { extraTime?: boolean } = {}): string {
  // A tie that went to extra time numbers its goals 91' to 120', as a match clock in extra time does: "90+8'" there
  // read as stoppage time. Its stoppage-time goals then read 93' too, which is still the right minute
  const label = options.extraTime ? (m: number) => `${m}'` : minuteLabel
  const order: string[] = []
  const minutes = new Map<string, number[]>()
  for (const s of [...scorers].sort((a, b) => a.minute - b.minute)) {
    const key = s.playerSeasonId ?? s.name
    if (!minutes.has(key)) {
      order.push(key)
      minutes.set(key, [])
    }
    minutes.get(key)!.push(s.minute)
  }
  return order.map((key) => `${shortName(scorers.find((s) => (s.playerSeasonId ?? s.name) === key)!.name)} ${minutes.get(key)!.map(label).join(', ')}`).join(' · ')
}
