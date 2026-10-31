import { useEffect, useRef, useState } from 'react'

/*
 * A screen's fixed bottom bar (the Dugout's calls, Setup's Start, the arena hub's calls) gives way when it would take
 * more than a third of the window: at 200 % text on an iPhone SE the Dugout's bar took 330 of 667 px and left a strip
 * of the tab to read. The page then carries `.bar-static` and the bar sits at the foot of the page instead
 * (styles.css, "Phones, round 12"). Presentation only.
 */

/** The largest share of the window a fixed bottom bar may take */
export const BAR_SHARE_MAX = 1 / 3

/** Whether a fixed bar `barHeight` px tall takes too much of a window `viewHeight` px tall */
export function barTooTall(barHeight: number, viewHeight: number): boolean {
  if (!(barHeight > 0) || !(viewHeight > 0)) return false
  return barHeight > viewHeight * BAR_SHARE_MAX
}

/**
 * `barHeight` is the bar's measured height (each screen's ResizeObserver). Only a height measured while the bar is
 * fixed decides, so the bar moving into the page (a different height) never flips it back; the window's resize
 * (turning the phone) decides again.
 */
export function useTallBar(barHeight: number): boolean {
  const [tall, setTall] = useState(false)
  const fixedHeight = useRef(0)
  useEffect(() => {
    if (!tall && barHeight > 0) fixedHeight.current = barHeight
  }, [barHeight, tall])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const decide = () => setTall(barTooTall(fixedHeight.current, window.innerHeight))
    decide()
    window.addEventListener('resize', decide)
    return () => window.removeEventListener('resize', decide)
  }, [barHeight])
  return tall
}
