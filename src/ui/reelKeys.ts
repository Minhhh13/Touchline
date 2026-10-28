/**
 * Space or Enter skips a running reel (the manager spin, the end-of-draft case, the January spin), unless the key is
 * meant for a field or a control: a focused button (the sound toggle, a fold, the reel's own Skip) answers it itself,
 * so Enter on the sound toggle switches the sound instead of skipping. Pure (the target only needs `closest`).
 */
export const REEL_KEY_OWNERS = 'input, textarea, select, [contenteditable="true"], a[href], button:not(:disabled), [role="button"], summary'

export function reelSkipKey(e: { key: string; repeat?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; target: unknown }): boolean {
  if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false
  const el = e.target as { closest?: (s: string) => unknown } | null
  return !(el && typeof el.closest === 'function' && el.closest(REEL_KEY_OWNERS))
}
