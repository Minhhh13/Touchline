import { useEffect, useReducer, useRef } from 'react'
import type { ClubSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { knownWheelChances, wheelChances, type WheelChance } from '@game/logic/exploreDb'
import { runAfterPaint } from './afterPaint'

type WheelCs = Pick<ClubSeason, 'clubId' | 'season' | 'leagueId' | 'classic'>

/**
 * Explore's wheel chances without working a wheel out inside a render (r13): `chanceOf(cs)` gives a club-season's
 * chance when its league's wheel is known, `undefined` while it is being worked out (the engine's `spinOdds`, about 300
 * ms on a 4x-throttled phone), after the screen has painted. Display only.
 */
export function useWheelChances(u: LoadedUniverse | null): (cs: WheelCs) => WheelChance | null | undefined {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const missing = useRef(new Map<string, { leagueId: string; classic: boolean }>())
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // Whatever this render asked for and found unknown: worked out after the paint, one wheel a task
  useEffect(() => {
    if (!u || pending.current || !missing.current.size) return
    const [key, w] = missing.current.entries().next().value!
    pending.current = true
    runAfterPaint(() => {
      pending.current = false
      missing.current.delete(key)
      if (!alive.current) return
      wheelChances(u, w.leagueId, w.classic)
      bump()
    })
  })
  return (cs) => {
    if (!u) return undefined
    const classic = !!cs.classic
    const map = knownWheelChances(u, cs.leagueId, classic)
    if (!map) {
      missing.current.set(`${cs.leagueId}${classic ? '#classic' : ''}`, { leagueId: cs.leagueId, classic })
      return undefined
    }
    return map.get(`${cs.clubId}@${cs.season}`) ?? null
  }
}
