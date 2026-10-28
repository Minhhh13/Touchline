/**
 * Tapping two slots on a pitch (the arena hub's team sheet): the first selects, the second moves the man. Pure.
 * `assignPlayer` swaps whoever it displaces into the mover's old slot, so one move is always enough; from an empty
 * slot the man tapped second moves into it.
 */
export function slotTapMove(lineup: Readonly<Record<string, string>>, selected: string, tapped: string): { id: string; slot: string } | null {
  if (selected === tapped) return null
  const from = lineup[selected]
  const to = lineup[tapped]
  if (from) return { id: from, slot: tapped }
  if (to) return { id: to, slot: selected }
  return null
}
