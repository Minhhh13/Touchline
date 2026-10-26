import { capOfGame, capTotal, type CapGame } from './cap'
import { chainOfGame, type ChainGame } from './chain'

/** One chip of the summary's banner for a casual rule the draft ran under. */
export interface CasualChip {
  key: 'cap' | 'chain'
  text: string
  /** The longer line for the chip's tooltip. */
  title: string
}

/**
 * The summary's chips for Moneyball and the Teammate chain, which the share text names (`capLine`, `chainLine`) and
 * the banner did not: "£172M of £180M", "Chain: 12 links" or "Chain broken twice". Pure, no draws.
 */
export function casualChips(game: CapGame & ChainGame): CasualChip[] {
  const out: CasualChip[] = []
  const cap = capOfGame(game)
  if (cap) out.push({ key: 'cap', text: `${capTotal(cap.spent)} of ${capTotal(cap.budget)}`, title: `Moneyball: ${capTotal(cap.spent)} spent of a ${capTotal(cap.budget)} salary cap` })
  const chain = chainOfGame(game)
  if (chain && chain.clubs.length) {
    // Counted as the share line counts them: every pick is a link of the chain
    const n = chain.broken.length
    const often = n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`
    out.push({ key: 'chain', text: n ? `Chain broken ${often}` : `Chain: ${chain.clubs.length} links`, title: n ? `Teammate chain: broken ${often}, a free spin each time` : 'Teammate chain: every pick played beside the one before' })
  }
  return out
}
