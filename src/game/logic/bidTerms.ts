/**
 * The contract lengths the market's bid offers, for the screen (pure). `bidFor` in `marketOps.ts` applies the same
 * rule to whatever the bid carries (`marketOps.ts` is in the edge verifier's bundle, so the screen's copy lives here
 * and `bidTerms.test.ts` holds the two equal).
 */

/** What a bid with no length chosen signs him for: one season from 32, three below. */
export function defaultBidYears(age: number): number {
  return age >= 32 ? 1 : 3
}

/** The lengths a bid may offer: up to two seasons from 33, four below. */
export function bidYearChoices(age: number): number[] {
  const max = age >= 33 ? 2 : 4
  return Array.from({ length: max }, (_, i) => i + 1)
}
