/**
 * Whether a saved head-to-head needs the classic pack, read by the store as a save loads. Kept apart from
 * `h2hClassic.ts` (which re-exports it) so that read does not bring `h2h.ts` into the first download. Pure.
 */

/** Whether a head-to-head needs the classic seasons loaded: its draft opted in (the wheel, and possibly the league season, holds them). */
export function h2hNeedsClassic(h2h: { draft: { drafts: ReadonlyArray<{ rules: { classic?: boolean } }> } } | null | undefined): boolean {
  return !!h2h?.draft.drafts[0]?.rules.classic
}
