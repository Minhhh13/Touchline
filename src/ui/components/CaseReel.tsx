import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ClubSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { DRUM_LAND, dealReel, idleCards, type ReelCard, type ReelDeal } from '@game/logic/reel'
import { TIER_INFO, tierName, type Tier } from '@game/logic/rarity'
import { clubName, seasonLabel, textColourFor } from '../format'
import { NeonFlow } from './Art'

/** Stage 1: the season drum rolls for DRUM_MS; the strip starts at SEASON_MS. */
export const DRUM_MS = 850
export const SEASON_MS = 1000
/**
 * Stage 2: the strip slides for STRIP_MS and decelerates the whole way: about 51% of the
 * distance at a quarter of the time, 78% at half, and the last card still crossing the
 * marker in the final half second. Change the curve and the measurements in
 * docs/GAME_DESIGN.md together.
 */
export const STRIP_MS = 4300
const STRIP_EASE = 'cubic-bezier(0.25, 0.75, 0.75, 1)'
const DRUM_EASE = 'cubic-bezier(0.2, 0.7, 0.25, 1)'
/** Reduced motion: no slide; the season shows at once and the landed card this long after. */
export const REDUCED_MS = 500

type Stage = 'season' | 'strip' | 'landed'

export interface CaseReelProps {
  u: LoadedUniverse
  /** The draft's leagues: the strip's clubs and the tier table come from these. */
  leagues: readonly string[]
  /** What the wheel could stop on this spin; those cards are lit, the rest dimmed. */
  pool: readonly ClubSeason[]
  /** The club-season the engine drew, or null between spins. */
  target: { clubId: string; season: number } | null
  /** Changes on every spin and re-spin, so landing on the same club-season twice still runs the reel. */
  spinKey: number
  /** Name of the twist on this spin ("Golden spin"), shown with the season. */
  twist?: string | null
  /** Called once per run, with its spinKey, when the strip lands (or the run is skipped to the landing). */
  onSettled?: (spinKey: number) => void
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** "Gold · Elite" as a chip in its tier colour. */
export function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className="tier-chip" data-tier={tier} data-testid="tier-chip">
      {tierName(tier)}
    </span>
  )
}

/** A dot in the tier colour, for the draft log. */
export function TierDot({ tier }: { tier: Tier }) {
  return <span className="tier-dot" data-tier={tier} role="img" aria-label={tierName(tier)} title={tierName(tier)} />
}

function Card({ c, landed }: { c: ReelCard; landed?: boolean }) {
  return (
    <div className={`reel-card${c.lit ? '' : ' dim'}${landed ? ' landed' : ''}`} data-tier={c.tier} style={{ background: c.colour, color: textColourFor(c.colour), '--secondary': c.secondary } as React.CSSProperties}>
      <span className="code">{c.code}</span>
      {c.league && <span className="lg">{c.league}</span>}
    </div>
  )
}

/**
 * The wheel as a case opening, season first. Each spin is its own run (keyed by
 * the spin), so nothing of the previous spin can show at the start of the next:
 *  1. the season drum rolls through the seasons this wheel could land on and stops on the drawn one;
 *  2. a strip of every club of that season slides under the marker and decelerates onto the drawn club,
 *     the ones the wheel could stop on lit, the rest dimmed;
 *  3. the landed card pops in its rarity colour and the result line shows club, season and tier.
 * A tap on the reel, or Space or Enter, skips to the landing. With reduced motion there is no slide.
 */
export function CaseReel(props: CaseReelProps) {
  const { target, spinKey } = props
  const runKey = target ? `${spinKey}:${target.clubId}@${target.season}` : ''
  // What the live region says, tagged with the run that said it, so a new run never repeats the last one's line
  const [said, setSaid] = useState({ run: '', text: '' })
  const announce = useCallback((text: string) => setSaid((s) => (s.run === runKey && s.text === text ? s : { run: runKey, text })), [runKey])
  return (
    <div className="wheel-wrap reel-wrap" data-testid="case-reel">
      {target ? <ReelRun key={runKey} {...props} target={target} announce={announce} /> : <IdleReel u={props.u} leagues={props.leagues} pool={props.pool} />}
      {/* One live region for every run: the season once, then the club and its tier once, never the passing cards */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="reel-live">
        {target && said.run === runKey ? said.text : ''}
      </div>
    </div>
  )
}

/** Between spins: a still strip of clubs the next spin could land on. */
function IdleReel({ u, leagues, pool }: { u: LoadedUniverse; leagues: readonly string[]; pool: readonly ClubSeason[] }) {
  const cards = useMemo(() => idleCards(u, leagues, pool), [u, leagues, pool])
  return (
    <div className="reel-run idle" data-stage="idle">
      <div className="reel-season out">
        <span className="lbl">Ready</span>
        <div className="reel-drum-window">
          <div className="reel-drum">
            <div className="reel-drum-label">Spin</div>
          </div>
        </div>
      </div>
      <div className="reel-window" aria-hidden="true">
        <NeonFlow className="reel-accent" />
        <div className="reel-marker" />
        <div className="reel-strip">
          {cards.map((c) => (
            <Card key={c.key} c={c} />
          ))}
        </div>
      </div>
      <div className="reel-result" />
    </div>
  )
}

function ReelRun({ u, leagues, pool, target, spinKey, twist, onSettled, announce }: CaseReelProps & { target: { clubId: string; season: number }; announce: (text: string) => void }) {
  // Dealt once per run; Math.random only shuffles cosmetic filler cards and the stop jitter, never the game
  const [deal] = useState<ReelDeal>(() => dealReel(u, { leagues, pool, target }, Math.random))
  const [reduced] = useState(prefersReducedMotion)
  const [stage, setStage] = useState<Stage>('season')
  const rootRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const drumRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<() => void>(() => undefined)
  const settled = useRef(false)
  const settledCb = useRef(onSettled)
  useLayoutEffect(() => {
    settledCb.current = onSettled
  })

  // Start the run before the first paint: the strip and the drum are measured and set off from zero
  useLayoutEffect(() => {
    const win = windowRef.current
    const strip = stripRef.current
    const drum = drumRef.current
    if (!win || !strip || !drum) return
    let alive = true
    const landCard = strip.children[deal.land] as HTMLElement | undefined
    // Where the strip stops, from the current layout: the landing card's centre (plus the jitter) under the marker
    const stripEnd = () => {
      const w = landCard?.offsetWidth ?? 0
      const offset = landCard ? landCard.offsetLeft + w / 2 - win.clientWidth / 2 + deal.jitter * w : 0
      return `translate3d(${(-offset).toFixed(1)}px, 0, 0)`
    }
    const label = drum.children[DRUM_LAND] as HTMLElement | undefined
    const drumTo = `translate3d(0, ${-(label?.offsetTop ?? 0)}px, 0)`
    let stripTo = stripEnd()
    let slide: Animation | null = null
    let done = false
    // A resize (a phone turned, a window dragged, the card size changing at the container breakpoint) moves the
    // landing card and the marker, so the stop is measured again: mid-slide the slide retargets, after it the strip moves.
    // Before the landing without a slide (reduced motion) the strip stays put, so the drawn card never shows early
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const next = stripEnd()
      if (next === stripTo) return
      stripTo = next
      if (slide?.effect instanceof KeyframeEffect) slide.effect.setKeyframes([{ transform: 'translate3d(0, 0, 0)' }, { transform: stripTo }])
      if (done) strip.style.transform = stripTo
    }) : null
    observer?.observe(win)
    if (landCard) observer?.observe(landCard)
    const land = () => {
      if (!alive) return
      done = true
      drum.style.transform = drumTo
      strip.style.transform = stripTo
      setStage('landed')
      if (!settled.current) {
        settled.current = true
        settledCb.current?.(spinKey)
      }
    }
    if (reduced || typeof strip.animate !== 'function') {
      drum.style.transform = drumTo
      const t = window.setTimeout(land, reduced ? REDUCED_MS : 0)
      skipRef.current = () => {
        window.clearTimeout(t)
        land()
      }
      return () => {
        alive = false
        window.clearTimeout(t)
        observer?.disconnect()
        skipRef.current = () => undefined
      }
    }
    const roll = drum.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: drumTo }], { duration: DRUM_MS, easing: DRUM_EASE, fill: 'both' })
    const run = strip.animate([{ transform: 'translate3d(0, 0, 0)' }, { transform: stripTo }], { duration: STRIP_MS, delay: SEASON_MS, easing: STRIP_EASE, fill: 'both' })
    slide = run
    roll.finished.then(() => alive && setStage((s) => (s === 'season' ? 'strip' : s)), () => undefined)
    run.finished.then(land, () => undefined)
    skipRef.current = () => {
      roll.finish()
      run.finish()
    }
    return () => {
      alive = false
      observer?.disconnect()
      roll.cancel()
      run.cancel()
      skipRef.current = () => undefined
    }
    // One run per mount: a new spin mounts a new run, so nothing here needs to re-run
  }, [])

  const seasonOut = reduced || stage !== 'season'
  const club = clubName(u, deal.target.clubId)
  const tier = deal.target.tier
  const seasonText = `Season ${seasonLabel(deal.season)}${twist ? `, ${twist}` : ''}`
  const landedText = `${club} ${seasonLabel(deal.season)}: ${TIER_INFO[tier].colour}, ${TIER_INFO[tier].label}`
  useLayoutEffect(() => {
    announce(stage === 'landed' ? landedText : seasonOut ? seasonText : '')
  }, [announce, stage, seasonOut, seasonText, landedText])

  // Space or Enter skips while the reel runs, unless the key is meant for a field or another live control
  const running = stage !== 'landed'
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      const el = e.target instanceof Element ? e.target : null
      if (el && !rootRef.current?.contains(el) && el.closest('input, textarea, select, [contenteditable="true"], a[href], button:not(:disabled), [role="button"]')) return
      e.preventDefault()
      skipRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running])

  return (
    <div ref={rootRef} className={`reel-run stage-${stage}${reduced ? ' reduced' : ''}`} data-stage={stage} data-tier={stage === 'landed' ? tier : undefined} onClick={() => running && skipRef.current()}>
      <div className={`reel-season${seasonOut ? ' out' : ''}`}>
        <span className={`lbl${twist ? ' twist' : ''}`}>{twist ?? 'Season'}</span>
        <div className="reel-drum-window" aria-hidden="true">
          <div className="reel-drum" ref={drumRef}>
            {deal.drum.map((s, i) => (
              <div key={i} className="reel-drum-label">
                {seasonLabel(s)}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="reel-window" ref={windowRef} aria-hidden="true">
        <NeonFlow className="reel-accent" />
        <div className="reel-marker" />
        <div className="reel-strip" ref={stripRef}>
          {deal.cards.map((c, i) => (
            <Card key={i} c={c} landed={stage === 'landed' && i === deal.land} />
          ))}
        </div>
        <div className="reel-veil" />
      </div>
      <div className="reel-result" data-testid="reel-result">
        {stage === 'landed' ? (
          <>
            <span className="reel-club">{club}</span>
            <span className="reel-club-season">{seasonLabel(deal.season)}</span>
            <TierChip tier={tier} />
          </>
        ) : (
          <button type="button" className="reel-skip" data-testid="reel-skip" onClick={(e) => { e.stopPropagation(); skipRef.current() }}>
            Tap to skip
          </button>
        )}
      </div>
    </div>
  )
}
