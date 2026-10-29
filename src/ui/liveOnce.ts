import { useEffect, useRef, useState } from 'react'

/**
 * A live region's words said once (a11y round 7). A region that shows "the latest moment" re-reads an older one when
 * something in between gives way (the match day's banner went back from the assistant's word to the booking before
 * it, and the booking was read again). `takeFresh` admits a moment's id the first time only; `useSayOnce` keeps the
 * region's text on the last fresh moment, so the region stays mounted and changes only for something new. Pure but
 * for the hook; presentation only.
 */
export function takeFresh(spoken: Set<string>, id: string | null | undefined): boolean {
  if (!id || spoken.has(id)) return false
  spoken.add(id)
  return true
}

/** The text a polite region should hold: `text` once for each new `id`, else what it last said. */
export function useSayOnce(id: string | null | undefined, text: string): string {
  const spoken = useRef(new Set<string>())
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (takeFresh(spoken.current, id)) setSaid(text)
    // The text belongs to its id: a new id brings its own
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return said
}
