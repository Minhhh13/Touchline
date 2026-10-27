/**
 * Whether a draft's rules leave its wheel anything to land on (r7 QA): Setup's cards, era slider, leagues and filters
 * combine freely, and some combinations admit no club-season at all (Legends with the Eredivisie alone from 2019-20,
 * whose sides never held an 85+ player since). Such a draft opened on an empty wheel, "No one left to draft", with
 * every slot still open. Setup asks this before Start. Pure: no draw, a fresh draft that is never kept, the answer
 * cached per universe and rules.
 */
import { canSpin, newDraft, type DraftRules } from '@engine/draft'
import { getFormation } from '@engine/formations'
import type { LoadedUniverse } from '@engine/universe'

const cache = new WeakMap<LoadedUniverse, Map<string, boolean>>()

/** True when the first spin of a draft with these rules and this shape has somewhere to land. */
export function wheelHasRoom(u: LoadedUniverse, rules: DraftRules, formationId: string): boolean {
  let byKey = cache.get(u)
  if (!byKey) cache.set(u, (byKey = new Map()))
  const key = JSON.stringify([formationId, rules])
  const hit = byKey.get(key)
  if (hit !== undefined) return hit
  const ok = canSpin(u, newDraft(getFormation(formationId), rules))
  byKey.set(key, ok)
  return ok
}

/** What Setup's Start says while the wheel is empty. */
export const EMPTY_WHEEL_LABEL = 'No side on the wheel fits: widen the era, the leagues or the modes'
