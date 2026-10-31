/**
 * Player names as the game shows them. 54 names in the league packs (every pack, mostly Portugal's) carry a stray
 * ",NN" from the European Soccer Database's `Player.player_name` ("D. Cousin,20", "B. McCarthy,27"); the packs keep
 * them until the next data rebuild strips them in `scripts/import` (docs/DATA.md, "Known data faults").
 *
 * `tidyUniverseNames` cleans them once, when the store receives a freshly loaded universe and before anything reads it,
 * so every screen, every match text, the news, the share text and the challenge views read the clean name. Names are
 * display text only: no id, rating, draw, sort or hash reads them (`playerNames.test.ts` plays seeded quick seasons
 * on a raw and a tidied universe and finds them identical but for the names). The engine's loader and the edge
 * verifier are untouched, so the verifier bundle does not move. Pure helpers, no RNG.
 */
import type { LoadedUniverse } from '@engine/universe'

/** A stray ",NN" at the end of a name (the source's suffix; a real name never ends in a comma and digits). */
const STRAY_SUFFIX = /\s*,\s*\d+\s*$/

/** The name without the source's stray ",NN": "D. Cousin,20" reads "D. Cousin". Any other name comes back unchanged. */
export function tidyPlayerName(name: string): string {
  if (!STRAY_SUFFIX.test(name)) return name
  const clean = name.replace(STRAY_SUFFIX, '').trim()
  return clean || name
}

/** Player-seasons already looked at (a load merges the same objects again with each league added). */
const checked = new WeakSet<object>()

/**
 * Clean every player-season's name in a universe the loader has just built, in place, and return it with how many
 * names changed. Run only at load, before the store publishes the universe (after that it is read-only); idempotent,
 * so a pack the loader cached and merges again is safe.
 */
export function tidyUniverseNames(u: LoadedUniverse): { universe: LoadedUniverse; tidied: number } {
  let tidied = 0
  for (const id in u.index) {
    const p = u.index[id]
    // A league the loader cached comes back in every later merge: its player-seasons are tidy already
    if (checked.has(p)) continue
    checked.add(p)
    const clean = tidyPlayerName(p.name)
    if (clean !== p.name) {
      p.name = clean
      tidied++
    }
  }
  return { universe: u, tidied }
}
