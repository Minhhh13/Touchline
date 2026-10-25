import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { sidesFactory } from '../../engine/__tests__/pools'
import { Rng } from '@engine/rng'
import { advanceMatch, beginMatch, changeInPlay, simulateMatch, type MatchInProgress } from '@engine/match'
import { feedFromLive, feedFromResult, type MatchFeed } from '@engine/matchFeed'

export const u = loadTestUniverse()
export const sides = sidesFactory(u)
export const getName = (id: string) => u.index[id]?.name

/** A finished full-detail match as a feed. */
export function resultFeed(i: number): MatchFeed {
  return feedFromResult(simulateMatch({ rng: new Rng(`ui-feed-${i}`), ...sides(i), detail: 'full' }), `ui-${i}`, { home: 'HOM', away: 'AWA' })
}

/** A match held to the whistle with the home manager's changes at 30 (instructions and a substitution) and at 75. */
export function changedLive(i: number): { mp: MatchInProgress; feed: MatchFeed; subOn?: string; subOff?: string } {
  const s = sides(i)
  const mp = beginMatch({ rng: new Rng(`ui-live-${i}`), ...s, detail: 'full' })
  const t = mp.home.tactics
  const off = mp.hLive.find((p) => p.position !== 'GK' && p.offAt >= 90 && !p.red)!
  const on = mp.home.bench.find((id) => !mp.hLive.some((p) => p.psId === id))
  const out = changeInPlay(mp, s, { side: 'home', minute: 30, tactics: { ...t, mentality: t.mentality === 'attacking' ? 'defensive' : 'attacking', width: 'wide' }, substitutions: on ? [{ off: off.psId, on }] : [] })
  advanceMatch(mp, s, undefined, 70)
  advanceMatch(mp, s, undefined, 90)
  changeInPlay(mp, s, { side: 'home', minute: 75, tactics: { ...mp.home.tactics, defensiveLine: mp.home.tactics.defensiveLine === 'high' ? 'deep' : 'high' } })
  const made = out.made[0]
  return { mp, feed: feedFromLive(mp, `ui-live-${i}`), subOn: made?.on, subOff: made?.off }
}
