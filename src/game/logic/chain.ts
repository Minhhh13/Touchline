/**
 * The Teammate Chain: what a finished draft says about its chain. The engine
 * enforces the chain (`chainAllows`, the chain-aware `canUse` and the free spin
 * after a break in `src/engine/draft.ts`, the index in `src/engine/teammates.ts`);
 * this file reads the history it leaves for the summary, the share card and the
 * Dressing Room achievement. Pure: no React, no store, no random numbers.
 *
 * The chain binds a draft only. A Season or a Dynasty's first year keeps the
 * record of it (`Game.teammateChain`); a Dynasty's summer draft has none.
 */
import type { DraftState } from '@engine/draft'
import type { LoadedUniverse } from '@engine/universe'
import type { Mode, TeammateChainRecord } from '../types'

/** The parts of a game the chain's lines read. */
export interface ChainGame {
  year: number
  settings: { mode: Mode; rules?: { chain?: boolean } }
  draft?: Pick<DraftState, 'rules' | 'history'> | null
  teammateChain?: TeammateChainRecord
}

/** A draft's chain: the club of every pick in order and the picks made on a free spin after a break. */
export function chainRecord(d: Pick<DraftState, 'history'>): TeammateChainRecord {
  const picks = d.history.filter((h) => h.pickedId)
  return { clubs: picks.map((h) => h.clubId), broken: picks.flatMap((h, i) => (h.chainBroken ? [i] : [])) }
}

/** The chain a finished or running game was drafted under; null without one, or once it no longer applies (a Dynasty after year one). */
export function chainOfGame(game: ChainGame): TeammateChainRecord | null {
  if (game.settings.mode === 'dynasty' && game.year > 1) return null
  if (game.draft?.rules.chain) return chainRecord(game.draft)
  return game.teammateChain ?? null
}

/** How often, in words: `once`, `twice`, `3 times`. */
function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`
}

/** The share line: `🔗 Teammate chain · 11 links`, or `🔗 Teammate chain · broken once`. */
export function chainLine(game: ChainGame): string | null {
  const c = chainOfGame(game)
  if (!c || !c.clubs.length) return null
  return `🔗 Teammate chain · ${c.broken.length ? `broken ${times(c.broken.length)}` : `${c.clubs.length} links`}`
}

/** Club codes on one line of the share card: eleven fit its width at the card's 34 px. */
export const CHAIN_CODES_PER_LINE = 11

/**
 * The chain of club codes for the share card, eleven to a line: `ARS→MCI→LIV`, a break written `/`, and a
 * line that carries the chain on from the one before starting with `→` (a squad of 18 takes two lines).
 */
export function chainCodes(u: LoadedUniverse, game: ChainGame): string[] | null {
  const c = chainOfGame(game)
  if (!c || !c.clubs.length) return null
  const code = (id: string) => u.clubById[id]?.code ?? id.slice(0, 3).toUpperCase()
  const lines: string[] = []
  for (let start = 0; start < c.clubs.length; start += CHAIN_CODES_PER_LINE) {
    const line = c.clubs.slice(start, start + CHAIN_CODES_PER_LINE).map((id, j) => {
      const i = start + j
      return (i === 0 ? '' : c.broken.includes(i) ? '/' : '→') + code(id)
    })
    lines.push(line.join(''))
  }
  return lines
}

/** Whether a title in this game earns Dressing Room: drafted under the chain, never broken, in the chain's own season. */
export function earnsChainChampions(game: ChainGame): boolean {
  if (!game.settings.rules?.chain) return false
  const c = chainOfGame(game)
  return !!c && c.clubs.length > 0 && c.broken.length === 0
}
