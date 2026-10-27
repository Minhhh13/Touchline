import { useEffect, useRef } from 'react'
import { playSound } from './synth'

/** Seconds after the reel's landing before the turn's two notes, so the landing's chime has rung first. */
export const TURN_AFTER_LANDING = 0.8

/**
 * A head-to-head turn passing (the hot-seat draft and an online room): once the reel has landed on a spin whose pick
 * is a different manager's than the last one heard, two notes, rising when the pick is this screen's to make
 * (`mine`), falling and quieter when it goes to the other side. The first turn seen on a screen only records.
 */
export function useTurnSound(picking: number | null, revealed: boolean, mine: boolean): void {
  const last = useRef<number | null | undefined>(undefined)
  useEffect(() => {
    if (!revealed || picking === null) return
    const before = last.current
    last.current = picking
    if (before !== undefined && before !== picking) playSound({ id: 'turn', mine }, TURN_AFTER_LANDING)
  }, [picking, revealed, mine])
}
