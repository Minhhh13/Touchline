/**
 * Pure series for the match charts, shared by the live and report views and
 * the share card: no React, no DOM.
 */
import { binOf, MOMENTUM_BINS } from '@engine/matchDetail'
import type { Side } from './pitchGeometry'

/**
 * Cumulative expected goals for one side, minute by minute (index 0 is kick-off,
 * index 90 the whistle): the side's match total shared out over the ninety
 * minutes by its share of the pressure in each five-minute bin, so the line
 * climbs faster in the spells the side is on top and ends exactly on the total.
 * Missing bins (a segment not yet played) read as an even share.
 */
export function xgSeries(momentum: number[], total: number, side: Side): number[] {
  const weight = (minute: number) => {
    const m = momentum[binOf(minute)] ?? 0.5
    return Math.max(0, side === 'home' ? m : 1 - m)
  }
  let sum = 0
  for (let minute = 1; minute <= 90; minute++) sum += weight(minute)
  const out: number[] = [0]
  let acc = 0
  for (let minute = 1; minute <= 90; minute++) {
    acc += sum > 0 ? (weight(minute) / sum) * total : total / 90
    out.push(acc)
  }
  out[90] = total
  return out
}

/** The home side's territory in per cent: the mean of the momentum series, or null without one. */
export function territory(momentum: number[]): number | null {
  const bins = momentum.slice(0, MOMENTUM_BINS)
  if (!bins.length) return null
  return Math.round((bins.reduce((a, b) => a + b, 0) / bins.length) * 100)
}
