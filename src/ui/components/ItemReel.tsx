import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ItemCard, ItemDeal } from '@game/logic/itemReel'
import { startReelSound, type ReelSound } from '../sound/reel'
import { playLanding } from '../sound/synth'
import { OVERSHOOT, reelKeyframes, reelPosition, type ReelTiming } from '../reelCurve'
import { NeonFlow } from './Art'
import { REDUCED_MS } from './CaseReel'
import { CaseItemIcon, isCaseItemKey } from './icons'
import { caseRowTitle } from '../i18n/engineText'

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function Card({ c, landed }: { c: ItemCard; landed?: boolean }) {
  return (
    <div className={`reel-card item-card${landed ? ' landed' : ''}`} data-tier={c.tier}>
      <span className="code">{isCaseItemKey(c.key) ? <CaseItemIcon item={c.key} size="0.9em" /> : c.face}</span>
      {/* A case item's name in the viewer's language (the logic's card keeps the English); a manager's is his surname */}
      <span className="item-lbl">{isCaseItemKey(c.key) ? caseRowTitle({ item: c.key, title: c.label }) : c.label}</span>
    </div>
  )
}

/**
 * One item reel of the manager spin or the end-of-draft case: the case reel's strip without the season drum, on the
 * same curve, ticks and landing sound (`src/ui/reelCurve.ts`, `src/ui/sound/reel.ts`). The item is already drawn
 * (`deal.target`); this only slides onto it. `stagger` lengthens the slide so side-by-side reels land one after
 * another; a change of `skip` lands at once (the parent's tap-to-skip); `sound` off keeps a second or third reel quiet
 * except for its landing.
 */
export function ItemReel({ deal, timing: runTiming, stagger = 0, sound = true, skip = 0, onSettled, testId }: { deal: ItemDeal; timing: ReelTiming; stagger?: number; sound?: boolean; skip?: number; onSettled?: () => void; testId?: string }) {
  const [reduced] = useState(prefersReducedMotion)
  // Fixed for the run, the strip starting at once (there is no season to show first)
  const [timing] = useState<ReelTiming>(() => ({ ...runTiming, drum: 0, season: 0, spin: runTiming.spin + stagger }))
  const [landed, setLanded] = useState(false)
  const windowRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<() => void>(() => undefined)
  const settledCb = useRef(onSettled)
  useLayoutEffect(() => {
    settledCb.current = onSettled
  })

  useLayoutEffect(() => {
    const win = windowRef.current
    const strip = stripRef.current
    if (!win || !strip) return
    let alive = true
    let done = false
    const landCard = strip.children[deal.land] as HTMLElement | undefined
    const stripOffset = () => {
      const w = landCard?.offsetWidth ?? 0
      return landCard ? landCard.offsetLeft + w / 2 - win.clientWidth / 2 + deal.jitter * w : 0
    }
    const overshoot = () => OVERSHOOT * (landCard?.offsetWidth ?? 0)
    const end = () => `translate3d(${(-stripOffset()).toFixed(1)}px, 0, 0)`
    let snd: ReelSound | null = null
    const soundOf = (anim: Animation | null): ReelSound => {
      const cards = Array.from(strip.children, (el) => el as HTMLElement)
      const gap = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft - cards[0].offsetWidth : 0
      const distance = stripOffset()
      const over = overshoot()
      return startReelSound({
        slide: sound ? anim : null,
        geometry: { boundaries: cards.map((c) => c.offsetLeft - gap / 2), marker: win.clientWidth / 2 },
        timing: { position: (ms) => reelPosition(ms, distance, over, timing), duration: timing.spin, bounce: timing.bounce, delay: 0 },
        popAt: 0,
        reduced: reduced || !sound,
      })
    }
    let slide: Animation | null = null
    let stop = end()
    // A resize (a window dragged, a phone turned, the reel's card size changing at a breakpoint) moves the landing card
    // and the needle, so the stop is measured again, as the case reel does: mid-slide the slide retargets, after it the
    // strip moves (the slide's fill holds its last frame, so its keyframes move too)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const next = end()
      if (next === stop) return
      stop = next
      if (slide?.effect instanceof KeyframeEffect) slide.effect.setKeyframes(reelKeyframes(stripOffset(), overshoot(), timing))
      if (done) strip.style.transform = stop
    }) : null
    observer?.observe(win)
    if (landCard) observer?.observe(landCard)
    const land = () => {
      if (!alive || done) return
      done = true
      strip.style.transform = end()
      snd?.land(deal.target.tier)
      setLanded(true)
      settledCb.current?.()
    }
    if (reduced || typeof strip.animate !== 'function') {
      snd = sound ? soundOf(null) : { land: (tier) => playLanding(tier, true), stop: () => undefined }
      const t = window.setTimeout(land, reduced ? REDUCED_MS : 0)
      skipRef.current = () => {
        window.clearTimeout(t)
        land()
      }
      return () => {
        alive = false
        window.clearTimeout(t)
        snd?.stop()
        observer?.disconnect()
        skipRef.current = () => undefined
      }
    }
    const run = strip.animate(reelKeyframes(stripOffset(), overshoot(), timing), { duration: timing.spin, easing: 'linear', fill: 'both' })
    slide = run
    // A quiet reel still plays its landing; only the first rattles
    snd = sound ? soundOf(run) : { land: (tier) => playLanding(tier, reduced), stop: () => undefined }
    let hold = 0
    let skipped = false
    run.finished.then(() => {
      if (skipped) land()
      else hold = window.setTimeout(land, timing.hold)
    }, () => undefined)
    skipRef.current = () => {
      skipped = true
      window.clearTimeout(hold)
      run.finish()
      if (run.playState === 'finished' && !done) land()
    }
    return () => {
      alive = false
      window.clearTimeout(hold)
      snd?.stop()
      observer?.disconnect()
      run.cancel()
      skipRef.current = () => undefined
    }
    // One run per mount: a new run mounts a new reel
  }, [])

  useEffect(() => {
    if (skip) skipRef.current()
  }, [skip])

  return (
    <div className={`reel-run item-reel${landed ? ' stage-landed' : ''}${reduced ? ' reduced' : ''}`} data-stage={landed ? 'landed' : 'strip'} data-tier={landed ? deal.target.tier : undefined} data-testid={testId}>
      <div className="reel-window" ref={windowRef} aria-hidden="true">
        <NeonFlow className="reel-accent" />
        <div className="reel-marker" />
        <div className="reel-strip" ref={stripRef}>
          {deal.cards.map((c, i) => (
            <Card key={i} c={c} landed={landed && i === deal.land} />
          ))}
        </div>
      </div>
    </div>
  )
}
