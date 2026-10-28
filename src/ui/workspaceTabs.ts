/** Keyboard navigation for a local workspace; this never changes game state. */
export function workspaceTabKey<T extends string>(ids: readonly T[], current: T, key: string): T | null {
  if (!ids.length) return null
  const at = Math.max(0, ids.indexOf(current))
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  if (key === 'ArrowRight') return ids[(at + 1) % ids.length]
  if (key === 'ArrowLeft') return ids[(at + ids.length - 1) % ids.length]
  return null
}
