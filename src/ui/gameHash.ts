import { parseGameHash, type GameHash } from '../online/core/codes'

/** Shown when a game link arrives damaged: the fragment names a challenge or room but cannot be read. */
export const DAMAGED_LINK_TOAST = 'That link is damaged or cut short: ask your friend to send it again.'

/**
 * The game link in a page's hash, read the way a link survives being pasted: punctuation a chat app or a sentence
 * glued to its end (`#c=…).`, `#s=K7Q2MX9A!`) is dropped first. `damaged` is a fragment that names a game link
 * (`#c=`, `#s=`, `#h=`) but still cannot be read, so the page can say so instead of ignoring it. Pure.
 */
export function readGameHash(hash: string): { link: GameHash | null; damaged: boolean } {
  const trimmed = hash.replace(/(?:%[0-9A-Fa-f]{2}|[^A-Za-z0-9_-])+$/, '')
  const link = parseGameHash(trimmed)
  return { link, damaged: !link && /^#[csh]=/.test(hash) }
}
